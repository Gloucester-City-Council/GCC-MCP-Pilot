/**
 * Azure Functions v4 HTTP Trigger — Web Get MCP
 *
 * One MCP server, four tools:
 *   fetch_raw_html       — raw HTML source + cleaned readable text
 *   evaluate_page        — jsdom DOM emulation + axe-core WCAG scan of a URL
 *   evaluate_dom_bundle  — same evaluation over caller-supplied HTML/CSS/JS
 *   inspect_dom_selector — selector-level inspection of a stored evaluation
 *
 * Endpoint: GET /api/mcp-raw-html (manifest), POST /api/mcp-raw-html (JSON-RPC)
 *
 * Page fetches (fetch_raw_html, evaluate_page) share one governance policy:
 * robots.txt is respected, a minimum 2-second per-domain rate limit is
 * enforced (or crawl-delay if longer), and private/internal IP ranges are
 * blocked to prevent SSRF. evaluate_page can additionally be restricted to
 * an origin allowlist via the EVALUATE_PAGE_ALLOWED_ORIGINS app setting.
 */

'use strict';

const { app } = require('@azure/functions');
const { checkFetchPolicy } = require('../web-get/fetch-governance');

const USER_AGENT = 'RawHTMLMCP/1.0 (Azure Function MCP; respects robots.txt)';
const ROBOTS_BOT_NAME = 'RawHTMLMCP';
const FETCH_TIMEOUT_MS = 10_000;

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

// ─── Content cleanup helpers ──────────────────────────────────────────────────
function decodeHtmlEntities(text) {
    if (!text) return '';
    return text
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, '\'')
        .replace(/&#x27;/gi, '\'')
        .replace(/&#x2F;/gi, '/');
}

function extractReadableText(html) {
    if (!html || typeof html !== 'string') return '';

    const withoutNonVisible = html
        // Remove script/style/template/noscript/svg blocks entirely
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
        // Remove common non-content sections
        .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        // Remove images and media placeholders
        .replace(/<(img|picture|source|video|audio)\b[^>]*\/?>/gi, ' ')
        // Remove HTML comments
        .replace(/<!--[\s\S]*?-->/g, ' ');

    const withBlockBreaks = withoutNonVisible
        .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)>/gi, '\n')
        .replace(/<(p|div|section|article|li|tr|h[1-6]|br)\b[^>]*>/gi, '\n');

    const withoutTags = withBlockBreaks.replace(/<[^>]+>/g, ' ');
    const decoded = decodeHtmlEntities(withoutTags);

    return decoded
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'fetch_raw_html',
        description: [
            'Fetches the raw HTML source of a URL.',
            'Respects robots.txt (checks * and RawHTMLMCP user-agent rules).',
            'Enforces a minimum 2-second per-domain rate limit (or crawl-delay if longer).',
            'Blocks requests to private/internal IP ranges to prevent SSRF.',
            'Returns: statusCode, contentType, bodyLength, body (raw HTML), and readableText (cleaned visible text).',
            'readableText strips scripts/styles/json-ld/image tags and other non-content noise.',
            'Optionally includes response headers.',
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

    {
        name: 'evaluate_page',
        description: [
            'Fetches a URL, discovers and loads its linked CSS, optionally executes its JavaScript,',
            'then runs axe-core for WCAG violation detection and extracts a compact page model.',
            'No browser required — uses jsdom for DOM emulation, runs entirely in-process.',
            'Applies the same fetch governance as fetch_raw_html: robots.txt, per-domain rate',
            'limiting, and SSRF blocking. Returns structured output ready for the accessibility MCP:',
            'axe violations, page model (headings/landmarks/links/forms/images),',
            'and elements_for_contrast_review with declared CSS colour values.',
            'Use inspect_dom_selector for targeted element inspection from the returned snapshot_id.',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to fetch and evaluate. Must use http or https.' },
                include_js: {
                    type: 'boolean',
                    default: false,
                    description: 'If true, fetches and executes linked JS files. Reveals JS-injected content. Off by default for speed and safety.',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    default: ['wcag2a', 'wcag2aa', 'wcag21aa'],
                    description: 'WCAG rule tags for axe-core (e.g. ["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).',
                },
                max_text_chars: {
                    type: 'integer',
                    default: 8000,
                    description: 'Maximum characters for visible_text_excerpt.',
                },
                return_passes: {
                    type: 'boolean',
                    default: false,
                    description: 'Include passing axe rules in the response.',
                },
            },
            required: ['url'],
        },
    },

    {
        name: 'evaluate_dom_bundle',
        description: [
            'Evaluates HTML, CSS, and optional JavaScript provided directly as strings.',
            'Use this for local files, CI pipelines, component testing, or when you have',
            'already fetched the assets. Same evaluation pipeline as evaluate_page.',
            'No network calls made — all content comes from the provided strings.',
            'Returns the same structured output as evaluate_page for the accessibility MCP.',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                html: { type: 'string', description: 'HTML document string to evaluate.' },
                css: {
                    type: 'array',
                    items: { type: 'string' },
                    default: [],
                    description: 'Array of CSS stylesheet strings to apply, in cascade order.',
                },
                js: {
                    type: 'array',
                    items: { type: 'string' },
                    default: [],
                    description: 'Array of JavaScript strings to execute after CSS is applied.',
                },
                base_url: {
                    type: 'string',
                    default: 'https://example.com',
                    description: 'Base URL for resolving relative links and setting the jsdom window.location.',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    default: ['wcag2a', 'wcag2aa', 'wcag21aa'],
                    description: 'WCAG rule tags for axe-core.',
                },
                max_text_chars: { type: 'integer', default: 8000 },
                return_passes: { type: 'boolean', default: false },
            },
            required: ['html'],
        },
    },

    {
        name: 'inspect_dom_selector',
        description: [
            'Inspects a CSS selector against a previously evaluated snapshot.',
            'Returns accessible names, computed styles, ARIA attributes, and HTML excerpts',
            'for matched nodes — structured for direct handoff to the accessibility MCP.',
            'Use this after evaluate_page or evaluate_dom_bundle to examine a specific',
            'component: nav, main, form, .modal, [role="dialog"], .job-list, etc.',
            'Snapshots expire after 15 minutes.',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                snapshot_id: { type: 'string', description: 'snapshot_id from evaluate_page or evaluate_dom_bundle.' },
                selector: { type: 'string', description: 'CSS selector to inspect (e.g. "nav", "form", ".card", "[role=\'dialog\']").' },
                include: {
                    type: 'array',
                    items: { type: 'string', enum: ['html', 'computed_styles', 'accessible_names', 'states'] },
                    default: ['html', 'computed_styles', 'accessible_names', 'states'],
                    description: 'Node properties to include.',
                },
                max_nodes: { type: 'integer', default: 80, description: 'Maximum nodes to return.' },
                max_html_chars: { type: 'integer', default: 12000, description: 'Maximum HTML excerpt characters per node.' },
            },
            required: ['snapshot_id', 'selector'],
        },
    },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────
async function handleFetchRawHtml({ url, include_headers = false }, context) {
    // 1. Validate URL
    const validation = validateUrl(url);
    if (!validation.ok) {
        return { blocked: true, reason: validation.reason };
    }
    const { parsed } = validation;

    // 2. robots.txt + per-domain rate limit
    const policy = await checkFetchPolicy(parsed, USER_AGENT, ROBOTS_BOT_NAME);
    const robotsContext = policy.robots;
    if (!policy.allowed) {
        return {
            blocked: true,
            blockedBy: 'robots_txt',
            reason: policy.reason,
            robotsOrigin: robotsContext.origin,
            robots: robotsContext,
        };
    }
    const rateLimit = policy.rateLimit;

    // 3. Fetch the target URL
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
        return { error: true, reason, robots: robotsContext, rateLimit };
    }
    clearTimeout(timer);

    const finalUrl = response.url;
    const redirectedValidation = validateUrl(finalUrl);
    if (!redirectedValidation.ok) {
        return {
            blocked: true,
            blockedBy: 'redirect_target_validation',
            reason: `Redirect target blocked: ${redirectedValidation.reason}`,
            url: finalUrl,
            robots: robotsContext,
            rateLimit,
        };
    }

    const body = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const readableText = extractReadableText(body);

    const result = {
        url: response.url, // may differ from input if redirected
        statusCode: response.status,
        contentType,
        bodyLength: body.length,
        body,
        readableText,
        readableTextLength: readableText.length,
        robots: robotsContext,
        rateLimit,
    };

    if (include_headers) {
        const headers = {};
        response.headers.forEach((value, key) => { headers[key] = value; });
        result.headers = headers;
    }

    context.log(`fetch_raw_html: ${response.status} ${response.url} (${body.length} bytes)`);
    return result;
}

// Rendered DOM handlers load lazily — jsdom is a heavy require and only
// needed when one of the evaluation tools is actually called.
let renderedDomHandlers = null;
function loadRenderedDomHandlers() {
    if (renderedDomHandlers) return renderedDomHandlers;
    try {
        renderedDomHandlers = {
            evaluate_page: require('../rendered-dom/tools/evaluate-page').evaluatePage,
            evaluate_dom_bundle: require('../rendered-dom/tools/evaluate-dom-bundle').evaluateDomBundle,
            inspect_dom_selector: require('../rendered-dom/tools/inspect-dom-selector').inspectDomSelector,
        };
    } catch (err) {
        console.error('mcpRawHtml: rendered DOM handler load failed —', err.message);
        renderedDomHandlers = {};
    }
    return renderedDomHandlers;
}

function getToolHandler(name) {
    if (name === 'fetch_raw_html') return handleFetchRawHtml;
    if (TOOLS.some(t => t.name === name)) return loadRenderedDomHandlers()[name] || null;
    return null;
}

// ─── MCP manifest ─────────────────────────────────────────────────────────────
const MANIFEST = {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: {
        name: 'gcc-web-get-mcp',
        version: '2.0.0',
        instructions: `🌐 WEB GET MCP

Fetches and evaluates public web pages — raw HTML retrieval plus
browser-free DOM emulation (jsdom) with axe-core WCAG scanning.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- fetch_raw_html       — Fetch raw HTML source + cleaned readable text
- evaluate_page        — Fetch a URL, load its CSS, run axe, get page model
- evaluate_dom_bundle  — Same evaluation over HTML/CSS/JS strings you supply
- inspect_dom_selector — Examine a specific component from a stored evaluation

TYPICAL ACCESSIBILITY WORKFLOW:
  1. evaluate_page(url)
       → axe violations, page model, elements_for_contrast_review, snapshot_id
  2. inspect_dom_selector(snapshot_id, 'nav')
       → accessible name, computed styles, ARIA attrs for nav nodes
  3. Pass everything to the accessibility MCP for WCAG interpretation

COLOUR CONTRAST:
  axe-core marks colour contrast as 'incomplete' in jsdom (background colour
  stacking is not computed without a layout engine). The elements_for_contrast_review
  payload surfaces those elements with their declared CSS colour values so the
  accessibility MCP can assess them.

TOKEN DISCIPLINE:
  evaluate_page returns a compact page model — not raw HTML.
  Use inspect_dom_selector to retrieve HTML for a specific selector only.
  Snapshots expire after 15 minutes.

⚠️  GOVERNANCE (fetch_raw_html and evaluate_page):
robots.txt is respected. Private/internal IP ranges are blocked (SSRF protection).
Rate limited to one request per domain per 2 seconds (or crawl-delay if longer).
evaluate_page can be restricted to specific origins via the
EVALUATE_PAGE_ALLOWED_ORIGINS app setting (comma-separated; unset = no allowlist).`,
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

    context.log(`Processing Web Get MCP method: ${method}`);

    switch (method) {
        case 'initialize':
            return { jsonrpc: '2.0', result: MANIFEST, id };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return { jsonrpc: '2.0', result: { tools: TOOLS }, id };

        case 'tools/call': {
            const { name, arguments: rawArgs } = params || {};
            const toolStart = Date.now();

            if (!name) {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: 'Invalid params: tool name is required' },
                    id,
                };
            }

            const handler = getToolHandler(name);
            if (!handler) {
                return {
                    jsonrpc: '2.0',
                    error: {
                        code: -32602,
                        message: `Unknown tool: ${name}. Available: ${TOOLS.map(t => t.name).join(', ')}`,
                    },
                    id,
                };
            }

            let args = rawArgs;
            if (typeof rawArgs === 'string') {
                try {
                    args = JSON.parse(rawArgs);
                } catch {
                    return {
                        jsonrpc: '2.0',
                        error: { code: -32602, message: 'Invalid params: arguments must be valid JSON when provided as a string' },
                        id,
                    };
                }
            }
            if (!args || typeof args !== 'object' || Array.isArray(args)) {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: 'Invalid params: arguments must be an object' },
                    id,
                };
            }

            try {
                context.log(`Executing tool: ${name}`);
                const result = await handler(args, context);
                context.log(`Web Get tool completed [${name}] in ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                    },
                    id,
                };
            } catch (error) {
                context.log.error(`Web Get tool error [${name}]: ${error.message}`);
                if (error && error.stack) {
                    context.log.error(`Web Get tool error stack [${name}]: ${error.stack}`);
                }
                context.log.error(`Web Get tool failed [${name}] after ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify({ error: error.message.substring(0, 300) }) }],
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
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'mcp-raw-html',
    handler: async (request, context) => {
        const requestStart = Date.now();
        context.log('Web Get MCP request received');

        try {
            if (request.method === 'GET') {
                context.log(`Web Get MCP manifest served with 200 in ${Date.now() - requestStart}ms`);
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(MANIFEST),
                };
            }

            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.error('Web Get MCP parse error:', parseError);
                if (parseError && parseError.stack) {
                    context.log.error('Web Get MCP parse error stack:', parseError.stack);
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
                context.log(`Web Get MCP request completed with 204 in ${Date.now() - requestStart}ms`);
                return { status: 204 };
            }

            context.log(`Web Get MCP request completed with 200 in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
            };
        } catch (error) {
            context.log.error('Web Get MCP unhandled error:', error);
            if (error && error.stack) {
                context.log.error('Web Get MCP unhandled error stack:', error.stack);
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

module.exports = { handleMcpRequest, TOOLS };
