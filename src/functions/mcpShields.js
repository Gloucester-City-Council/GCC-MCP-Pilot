/**
 * Azure Functions v4 HTTP Triggers — GCC Shields MCP
 *
 * Two routes:
 *
 *   POST /api/mcp-shields              MCP JSON-RPC endpoint (function key required)
 *   GET  /api/mcp-shields/badge/{key}  Public JSON that Shields.io reads to draw a live badge
 *
 * The MCP route can create and change badge values, so it needs a function
 * key (?code=... or the x-functions-key header), like mcpAzureEstate. The
 * badge route is anonymous and read-only because Shields.io has to fetch it.
 * It returns label, message and colour only.
 *
 * All tool logic lives in src/gcc-shields/. This file implements the MCP
 * JSON-RPC envelope and the public badge response.
 */

'use strict';

const { app } = require('@azure/functions');

// context.log.error isn't guaranteed to exist across Azure Functions runtime
// versions (same guard as mcpNotes.js and mcpAzureEstate.js).
function logError(context, ...args) {
    try {
        if (typeof context.log.error === 'function') {
            context.log.error(...args);
        } else if (typeof context.error === 'function') {
            context.error(...args);
        } else {
            console.error(...args);
        }
    } catch (_) {
        console.error(...args);
    }
}

// Wrap module load so a dependency failure returns a 503 rather than
// crashing the whole Azure Functions worker (same pattern as mcpProcurement.js).
let shields = { TOOLS: [], TOOL_HANDLERS: {}, SERVER_INFO: { name: 'gcc-shields-mcp', version: '1.0.0' } };
let _moduleLoadError = null;

try {
    shields = require('../gcc-shields/index');
} catch (err) {
    _moduleLoadError = err;
    console.error('Shields MCP: module load failed —', err.message);
}

const INSTRUCTIONS = `GCC SHIELDS MCP

Builds Shields.io badges. Two kinds:

Static badges (badge_static, badge_threshold, badge_review_stamp, badge_wall) return a URL plus Markdown and HTML embeds. Nothing is stored.

Live badges (badge_set, badge_list, badge_delete) store a label, message and colour under a key. The embed URL stays the same while the stored value changes, so a badge on a council page or README updates without anyone editing the page. A live badge can store its own look (logo, logoColor, labelColor, style), so every embed of it matches. Setting a key again replaces the whole badge, so repeat the look when you update the value. Shields caches live badges for a few minutes, so a change is not instant.

Review stamps write dates out in full (for example 16 Apr 2027) and turn orange inside warnDays of the due date, then red once it has passed.

Every embed uses "label: message" as alt text.`;

async function handleMcpRequest(request, context, mod = shields) {
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

    context.log(`Processing Shields MCP method: ${method}`);

    switch (method) {
        case 'initialize':
            return {
                jsonrpc: '2.0',
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: { ...mod.SERVER_INFO, instructions: INSTRUCTIONS },
                },
                id,
            };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return { jsonrpc: '2.0', result: { tools: mod.TOOLS }, id };

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

            const handler = Object.prototype.hasOwnProperty.call(mod.TOOL_HANDLERS, name) ? mod.TOOL_HANDLERS[name] : null;
            if (!handler) {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: `Unknown tool: ${name}. Available: ${Object.keys(mod.TOOL_HANDLERS).join(', ')}` },
                    id,
                };
            }

            try {
                const result = await handler(args && typeof args === 'object' ? args : {});
                context.log(`Shields tool completed [${name}] in ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
                    id,
                };
            } catch (error) {
                const code = error && error.code === 'INVALID_ARGUMENT' ? 'INVALID_ARGUMENT' : 'INTERNAL_ERROR';
                logError(context, `Shields tool error [${name}] (${code}): ${error.message}`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({ error: error.message, code, tool: name }, null, 2),
                        }],
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

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function badgeError(status, message) {
    return {
        status,
        headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
        body: JSON.stringify({ schemaVersion: 1, label: 'badge', message, color: 'lightgrey', isError: true }),
    };
}

/** Public read: returns the Shields endpoint JSON for one stored badge. */
async function handleBadgeRequest(key, context, mod = shields) {
    let normalised;
    try {
        normalised = mod.normaliseKey
            ? mod.normaliseKey(String(key || '').replace(/\.json$/i, ''))
            : String(key || '').replace(/\.json$/i, '').toLowerCase();
    } catch (_) {
        return badgeError(404, 'not found');
    }

    try {
        const entry = await mod.store.get(normalised);
        if (!entry) return badgeError(404, 'not found');
        return {
            status: 200,
            headers: { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=60' },
            body: JSON.stringify(mod.endpointJson(entry)),
        };
    } catch (error) {
        logError(context, `Shields badge read failed [${normalised}]: ${error.message}`);
        return badgeError(503, 'unavailable');
    }
}

app.http('mcpShields', {
    methods: ['POST'],
    // The other endpoints in this app are 'anonymous', but this one can
    // change what live badges say on council pages. It requires a function
    // key (?code=... or the x-functions-key header). Get the key from Portal:
    // Function App -> Functions -> mcpShields -> Function Keys.
    authLevel: 'function',
    route: 'mcp-shields',
    handler: async (request, context) => {
        const requestStart = Date.now();
        context.log('MCP Shields request received');

        if (_moduleLoadError) {
            console.error('Shields MCP unavailable — module load error:', _moduleLoadError.message);
            return {
                status: 503,
                headers: JSON_HEADERS,
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: `Shields MCP unavailable: ${_moduleLoadError.message}` },
                    id: null,
                }),
            };
        }

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                console.error('Failed to parse request body:', parseError.message);
                return {
                    status: 400,
                    headers: JSON_HEADERS,
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        error: { code: -32700, message: 'Parse error: Invalid JSON' },
                        id: null,
                    }),
                };
            }

            const response = await handleMcpRequest(body, context);

            if (response === null) {
                context.log(`MCP Shields request completed with 204 in ${Date.now() - requestStart}ms`);
                return { status: 204 };
            }

            context.log(`MCP Shields request completed with 200 in ${Date.now() - requestStart}ms`);
            return { status: 200, headers: JSON_HEADERS, body: JSON.stringify(response) };
        } catch (error) {
            console.error('MCP Shields unhandled error:', error.message);
            return {
                status: 500,
                headers: JSON_HEADERS,
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: error.message },
                    id: null,
                }),
            };
        }
    },
});

app.http('shieldsBadge', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'mcp-shields/badge/{key}',
    handler: async (request, context) => {
        if (_moduleLoadError) return badgeError(503, 'unavailable');
        return handleBadgeRequest(request.params && request.params.key, context);
    },
});

module.exports = { handleMcpRequest, handleBadgeRequest };
