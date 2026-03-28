/**
 * Azure Functions v4 HTTP Trigger — Raw HTML Fetch MCP
 *
 * Exposes a single MCP tool: fetch_raw_html
 * Endpoint: GET /api/mcp-raw-html (manifest), POST /api/mcp-raw-html (tool execution)
 *
 * Respects robots.txt, enforces per-domain rate limiting, and blocks SSRF
 * attempts against private IP ranges.
 *
 * User-Agent: RawHTMLMCP/1.0 (Azure Function MCP; respects robots.txt)
 */

'use strict';

const { app } = require('@azure/functions');

const USER_AGENT = 'RawHTMLMCP/1.0 (Azure Function MCP; respects robots.txt)';
const FETCH_TIMEOUT_MS = 10_000;
const MIN_CRAWL_DELAY_MS = 2_000;
const ROBOTS_CACHE_TTL_MS = 3_600_000; // 1 hour

// Module-scope caches — reset on cold start, good enough for personal/internal use
/** @type {Map<string, { fetchedAt: number, rules: object }>} */
const robotsCache = new Map();
/** @type {Map<string, number>} domain → last fetch timestamp (ms) */
const rateLimitMap = new Map();

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
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { ok: false, reason: 'Malformed URL — could not parse' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { ok: false, reason: `URL protocol must be http or https, got: ${parsed.protocol}` };
    }
    if (isPrivateHost(parsed.hostname)) {
        return { ok: false, reason: `Requests to private/internal hosts are not permitted (${parsed.hostname})` };
    }
    return { ok: true, parsed };
}

// ─── robots.txt helpers ───────────────────────────────────────────────────────
function parseRobots(text) {
    const rules = { agents: {} };
    let currentAgents = [];

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) {
            currentAgents = [];
            continue;
        }

        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;

        const field = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();

        if (field === 'user-agent') {
            const agent = value.toLowerCase();
            if (!rules.agents[agent]) rules.agents[agent] = { disallow: [], crawlDelay: 0 };
            currentAgents.push(agent);
        } else if (field === 'disallow') {
            for (const agent of currentAgents) {
                if (!rules.agents[agent]) rules.agents[agent] = { disallow: [], crawlDelay: 0 };
                rules.agents[agent].disallow.push(value);
            }
        } else if (field === 'crawl-delay') {
            const delay = parseFloat(value);
            if (!isNaN(delay) && delay > 0) {
                for (const agent of currentAgents) {
                    if (!rules.agents[agent]) rules.agents[agent] = { disallow: [], crawlDelay: 0 };
                    rules.agents[agent].crawlDelay = delay * 1000;
                }
            }
        } else {
            // Any non-agent-block directive resets current agent scope
            currentAgents = [];
        }
    }
    return rules;
}

function isPathDisallowed(path, disallowList) {
    for (const rule of disallowList) {
        if (!rule) continue; // empty Disallow means allow all
        if (path.startsWith(rule)) return true;
    }
    return false;
}

function getRulesForBot(rules) {
    // Prefer specific agent match, fall back to wildcard
    return rules.agents['rawhtmlmcp'] || rules.agents['*'] || { disallow: [], crawlDelay: 0 };
}

async function fetchRobotsRules(origin) {
    const cached = robotsCache.get(origin);
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL_MS) {
        return cached.rules;
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        const res = await fetch(`${origin}/robots.txt`, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) {
            const text = await res.text();
            const rules = parseRobots(text);
            robotsCache.set(origin, { fetchedAt: Date.now(), rules });
            return rules;
        }
    } catch {
        // Unreachable robots.txt → treat as allow-all
    }

    const empty = { agents: {} };
    robotsCache.set(origin, { fetchedAt: Date.now(), rules: empty });
    return empty;
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
async function applyRateLimit(domain, crawlDelayMs) {
    const minDelay = Math.max(MIN_CRAWL_DELAY_MS, crawlDelayMs);
    const last = rateLimitMap.get(domain) || 0;
    const wait = last + minDelay - Date.now();
    if (wait > 0) {
        await new Promise(r => setTimeout(r, wait));
    }
    rateLimitMap.set(domain, Date.now());
}

// ─── Tool definition ──────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'fetch_raw_html',
        description: [
            'Fetches the raw HTML source of a URL.',
            'Respects robots.txt (checks * and RawHTMLMCP user-agent rules).',
            'Enforces a minimum 2-second per-domain rate limit (or crawl-delay if longer).',
            'Blocks requests to private/internal IP ranges to prevent SSRF.',
            'Returns: statusCode, contentType, bodyLength, body, and optionally response headers.',
        ].join(' '),
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
async function handleFetchRawHtml({ url, include_headers = false }, context) {
    // 1. Validate URL
    const validation = validateUrl(url);
    if (!validation.ok) {
        return { blocked: true, reason: validation.reason };
    }
    const { parsed } = validation;
    const origin = `${parsed.protocol}//${parsed.host}`;

    // 2. Fetch and parse robots.txt
    const rules = await fetchRobotsRules(origin);
    const agentRules = getRulesForBot(rules);

    // 3. Check path against disallow rules
    const path = parsed.pathname || '/';
    if (isPathDisallowed(path, agentRules.disallow)) {
        return {
            blocked: true,
            reason: `Path "${path}" is disallowed by robots.txt`,
            robotsOrigin: origin,
        };
    }

    // 4. Apply rate limit
    await applyRateLimit(parsed.hostname, agentRules.crawlDelay);

    // 5. Fetch the target URL
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
            redirect: 'follow',
        });
    } catch (err) {
        clearTimeout(timer);
        const reason = err.name === 'AbortError'
            ? 'Request timed out after 10 seconds'
            : `Fetch failed: ${err.message}`;
        return { error: true, reason };
    }
    clearTimeout(timer);

    const body = await response.text();
    const contentType = response.headers.get('content-type') || '';

    const result = {
        url: response.url, // may differ from input if redirected
        statusCode: response.status,
        contentType,
        bodyLength: body.length,
        body,
    };

    if (include_headers) {
        const headers = {};
        response.headers.forEach((value, key) => { headers[key] = value; });
        result.headers = headers;
    }

    context.log(`fetch_raw_html: ${response.status} ${response.url} (${body.length} bytes)`);
    return result;
}

// ─── MCP manifest ─────────────────────────────────────────────────────────────
const MANIFEST = {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: {
        name: 'gcc-raw-html-mcp',
        version: '1.0.0',
        instructions: `🌐 RAW HTML FETCH MCP

Fetches the raw HTML source of any public URL.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- fetch_raw_html — Fetch raw HTML source from a URL

⚠️  Respects robots.txt. Private/internal IP ranges are blocked (SSRF protection).
Rate limited to one request per domain per 2 seconds (or crawl-delay if longer).`,
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

    const { jsonrpc, method, params, id } = request;
    const requestId = Object.prototype.hasOwnProperty.call(request, 'id') && id !== undefined ? id : null;

    if (jsonrpc !== '2.0') {
        return {
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
            id: requestId,
        };
    }

    context.log(`Processing MCP Raw HTML method: ${method}`);

    switch (method) {
        case 'initialize':
            return { jsonrpc: '2.0', result: MANIFEST, id };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return { jsonrpc: '2.0', result: { tools: TOOLS }, id };

        case 'tools/call': {
            const { name, arguments: args } = params || {};
            const toolStart = Date.now();

            if (!name) {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: 'Invalid params: tool name is required' },
                    id,
                };
            }

            if (name !== 'fetch_raw_html') {
                return {
                    jsonrpc: '2.0',
                    error: {
                        code: -32602,
                        message: `Unknown tool: ${name}. Available: fetch_raw_html`,
                    },
                    id,
                };
            }

            try {
                context.log(`Executing tool: ${name} url=${args?.url}`);
                const result = await handleFetchRawHtml(args || {}, context);
                context.log(`Raw HTML tool completed [${name}] in ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                    },
                    id,
                };
            } catch (error) {
                context.log.error(`Raw HTML tool error: ${error.message}`);
                if (error && error.stack) {
                    context.log.error(`Raw HTML tool error stack [${name}]: ${error.stack}`);
                }
                context.log.error(`Raw HTML tool failed [${name}] after ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
                        isError: true,
                    },
                    id,
                };
            }
        }

        case 'ping':
            return { jsonrpc: '2.0', result: {}, id };

        default:
            return {
                jsonrpc: '2.0',
                error: { code: -32601, message: `Method not found: ${method}` },
                id,
            };
    }
}

// ─── HTTP trigger registration ────────────────────────────────────────────────
app.http('mcpRawHtml', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp-raw-html',
    handler: async (request, context) => {
        const requestStart = Date.now();
        context.log('MCP Raw HTML request received');

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.error('MCP Raw HTML parse error:', parseError);
                if (parseError && parseError.stack) {
                    context.log.error('MCP Raw HTML parse error stack:', parseError.stack);
                }
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

            const response = await handleMcpRequest(body, context);

            if (response === null) {
                context.log(`MCP Raw HTML request completed with 204 in ${Date.now() - requestStart}ms`);
                return { status: 204 };
            }

            context.log(`MCP Raw HTML request completed with 200 in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
            };
        } catch (error) {
            context.log.error('MCP Raw HTML unhandled error:', error);
            if (error && error.stack) {
                context.log.error('MCP Raw HTML unhandled error stack:', error.stack);
            }
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
