/**
 * Azure Functions v4 HTTP Trigger — Raw HTML Fetch MCP
 *
 * Exposes a single MCP tool: fetch_raw_html
 * Endpoint: POST /api/mcp-raw-html
 *
 * Respects robots.txt, enforces per-domain rate limiting, and blocks SSRF
 * attempts against private IP ranges.
 *
 * User-Agent: RawHTMLMCP/1.0 (Azure Function MCP; respects robots.txt)
 */

'use strict';

const { app } = require('@azure/functions');

const USER_AGENT = 'RawHTMLMCP/1.0 (Azure Function MCP; respects robots.txt)';
const FETCH_TIMEOUT_MS = 10000;
const MIN_CRAWL_DELAY_MS = 2000;
const ROBOTS_CACHE_TTL_MS = 3600000; // 1 hour

// Module-scope caches — reset on cold start, good enough for personal/internal use
const robotsCache = new Map();  // origin → { fetchedAt, rules }
const rateLimitMap = new Map(); // domain → last fetch timestamp (ms)

// ─── SSRF guard ───────────────────────────────────────────────────────────────
const PRIVATE_HOSTNAME_RE = /^(localhost|.*\.local)$/i;
const PRIVATE_IP_RE = /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|127\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+|::1|0\.0\.0\.0)$/;

function isPrivateHost(hostname) {
    if (PRIVATE_HOSTNAME_RE.test(hostname)) return true;
    if (PRIVATE_IP_RE.test(hostname)) return true;
    return false;
}

// ─── URL validation ───────────────────────────────────────────────────────────
function validateUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { ok: false, reason: 'url is required and must be a string' };
    }
    var parsed;
    try {
        parsed = new URL(rawUrl);
    } catch (err) {
        return { ok: false, reason: 'Malformed URL — could not parse' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { ok: false, reason: 'URL protocol must be http or https, got: ' + parsed.protocol };
    }
    if (isPrivateHost(parsed.hostname)) {
        return { ok: false, reason: 'Requests to private/internal hosts are not permitted (' + parsed.hostname + ')' };
    }
    return { ok: true, parsed: parsed };
}

// ─── robots.txt helpers ───────────────────────────────────────────────────────
function parseRobots(text) {
    var rules = { agents: {} };
    var currentAgents = [];

    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/#.*$/, '').trim();
        if (!line) {
            currentAgents = [];
            continue;
        }

        var colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;

        var field = line.slice(0, colonIdx).trim().toLowerCase();
        var value = line.slice(colonIdx + 1).trim();

        if (field === 'user-agent') {
            var agent = value.toLowerCase();
            if (!rules.agents[agent]) rules.agents[agent] = { disallow: [], crawlDelay: 0 };
            currentAgents.push(agent);
        } else if (field === 'disallow') {
            for (var j = 0; j < currentAgents.length; j++) {
                var a = currentAgents[j];
                if (!rules.agents[a]) rules.agents[a] = { disallow: [], crawlDelay: 0 };
                rules.agents[a].disallow.push(value);
            }
        } else if (field === 'crawl-delay') {
            var delay = parseFloat(value);
            if (!isNaN(delay) && delay > 0) {
                for (var k = 0; k < currentAgents.length; k++) {
                    var b = currentAgents[k];
                    if (!rules.agents[b]) rules.agents[b] = { disallow: [], crawlDelay: 0 };
                    rules.agents[b].crawlDelay = delay * 1000;
                }
            }
        } else {
            currentAgents = [];
        }
    }
    return rules;
}

function isPathDisallowed(path, disallowList) {
    for (var i = 0; i < disallowList.length; i++) {
        var rule = disallowList[i];
        if (!rule) continue; // empty Disallow means allow all
        if (path.startsWith(rule)) return true;
    }
    return false;
}

function getRulesForBot(rules) {
    return rules.agents['rawhtmlmcp'] || rules.agents['*'] || { disallow: [], crawlDelay: 0 };
}

async function fetchRobotsRules(origin) {
    var cached = robotsCache.get(origin);
    if (cached && (Date.now() - cached.fetchedAt) < ROBOTS_CACHE_TTL_MS) {
        return cached.rules;
    }

    try {
        var controller = new AbortController();
        var timer = setTimeout(function() { controller.abort(); }, 5000);
        var res = await fetch(origin + '/robots.txt', {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) {
            var text = await res.text();
            var rules = parseRobots(text);
            robotsCache.set(origin, { fetchedAt: Date.now(), rules: rules });
            return rules;
        }
    } catch (err) {
        // Unreachable robots.txt — treat as allow-all
    }

    var empty = { agents: {} };
    robotsCache.set(origin, { fetchedAt: Date.now(), rules: empty });
    return empty;
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
async function applyRateLimit(domain, crawlDelayMs) {
    var minDelay = Math.max(MIN_CRAWL_DELAY_MS, crawlDelayMs || 0);
    var last = rateLimitMap.get(domain) || 0;
    var wait = last + minDelay - Date.now();
    if (wait > 0) {
        await new Promise(function(resolve) { setTimeout(resolve, wait); });
    }
    rateLimitMap.set(domain, Date.now());
}

// ─── Tool definition ──────────────────────────────────────────────────────────
var TOOLS = [
    {
        name: 'fetch_raw_html',
        description: 'Fetches the raw HTML source of a URL. Respects robots.txt (checks * and RawHTMLMCP user-agent rules). Enforces a minimum 2-second per-domain rate limit (or crawl-delay if longer). Blocks requests to private/internal IP ranges to prevent SSRF. Returns: statusCode, contentType, bodyLength, body, and optionally response headers.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL to fetch. Must use http or https.',
                },
                include_headers: {
                    type: 'boolean',
                    description: 'If true, include response headers in the result. Default: false.',
                    default: false,
                },
            },
            required: ['url'],
        },
    },
];

// ─── Tool handler ─────────────────────────────────────────────────────────────
async function handleFetchRawHtml(args, context) {
    var url = args.url;
    var include_headers = args.include_headers === true;

    // 1. Validate URL
    var validation = validateUrl(url);
    if (!validation.ok) {
        return { blocked: true, reason: validation.reason };
    }
    var parsed = validation.parsed;
    var origin = parsed.protocol + '//' + parsed.host;

    // 2. Fetch and parse robots.txt
    var rules = await fetchRobotsRules(origin);
    var agentRules = getRulesForBot(rules);

    // 3. Check path against disallow rules
    var path = parsed.pathname || '/';
    if (isPathDisallowed(path, agentRules.disallow)) {
        return {
            blocked: true,
            reason: 'Path "' + path + '" is disallowed by robots.txt',
            robotsOrigin: origin,
        };
    }

    // 4. Apply rate limit
    await applyRateLimit(parsed.hostname, agentRules.crawlDelay);

    // 5. Fetch the target URL
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, FETCH_TIMEOUT_MS);

    var response;
    try {
        response = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
            redirect: 'follow',
        });
    } catch (err) {
        clearTimeout(timer);
        var reason = err.name === 'AbortError'
            ? 'Request timed out after 10 seconds'
            : 'Fetch failed: ' + err.message;
        return { error: true, reason: reason };
    }
    clearTimeout(timer);

    var body = await response.text();
    var contentType = response.headers.get('content-type') || '';

    var result = {
        url: response.url,
        statusCode: response.status,
        contentType: contentType,
        bodyLength: body.length,
        body: body,
    };

    if (include_headers) {
        var headers = {};
        response.headers.forEach(function(value, key) { headers[key] = value; });
        result.headers = headers;
    }

    context.log('fetch_raw_html: ' + response.status + ' ' + response.url + ' (' + body.length + ' bytes)');
    return result;
}

// ─── MCP manifest ─────────────────────────────────────────────────────────────
var MANIFEST = {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: {
        name: 'gcc-raw-html-mcp',
        version: '1.0.0',
        instructions: '🌐 RAW HTML FETCH MCP\n\nFetches the raw HTML source of any public URL.\n\n- fetch_raw_html — Fetch raw HTML source from a URL\n\nRespects robots.txt. Private/internal IP ranges are blocked (SSRF protection). Rate limited to one request per domain per 2 seconds.',
    },
};

// ─── MCP JSON-RPC handler ─────────────────────────────────────────────────────
async function handleMcpRequest(request, context) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return {
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request: body must be a JSON object' },
            id: null,
        };
    }

    var jsonrpc = request.jsonrpc;
    var method = request.method;
    var params = request.params;
    var id = request.id;
    var requestId = Object.prototype.hasOwnProperty.call(request, 'id') && id !== undefined ? id : null;

    if (jsonrpc !== '2.0') {
        return {
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
            id: requestId,
        };
    }

    context.log('Processing MCP Raw HTML method: ' + method);

    switch (method) {
        case 'initialize':
            return { jsonrpc: '2.0', result: MANIFEST, id: id };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return { jsonrpc: '2.0', result: { tools: TOOLS }, id: id };

        case 'tools/call': {
            var name = params && params.name;
            var args = (params && params.arguments) || {};

            if (!name) {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: 'Invalid params: tool name is required' },
                    id: id,
                };
            }

            if (name !== 'fetch_raw_html') {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: 'Unknown tool: ' + name + '. Available: fetch_raw_html' },
                    id: id,
                };
            }

            try {
                context.log('Executing tool: ' + name + ' url=' + args.url);
                var result = await handleFetchRawHtml(args, context);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                    },
                    id: id,
                };
            } catch (error) {
                context.log.error('Raw HTML tool error: ' + error.message);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
                        isError: true,
                    },
                    id: id,
                };
            }
        }

        case 'ping':
            return { jsonrpc: '2.0', result: {}, id: id };

        default:
            return {
                jsonrpc: '2.0',
                error: { code: -32601, message: 'Method not found: ' + method },
                id: id,
            };
    }
}

// ─── HTTP trigger registration ────────────────────────────────────────────────
app.http('mcpRawHtml', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp-raw-html',
    handler: async function(request, context) {
        context.log('MCP Raw HTML request received');

        try {
            var body;
            try {
                body = await request.json();
            } catch (parseError) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        error: { code: -32700, message: 'Parse error: Invalid JSON' },
                        id: null,
                    }),
                };
            }

            var response = await handleMcpRequest(body, context);

            if (response === null) {
                return { status: 204 };
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
            };
        } catch (error) {
            context.log.error('MCP Raw HTML unhandled error:', error);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: error.message },
                    id: null,
                }),
            };
        }
    },
});
