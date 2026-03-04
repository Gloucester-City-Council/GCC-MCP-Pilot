/**
 * Azure Functions v4 HTTP Trigger — GCC Procurement MCP
 *
 * Exposes five read-only MCP tools for GCC's procurement constitutional
 * rules engine at POST /api/mcp-procurement.
 *
 * Completely separate from the existing mcp and mcp-schema endpoints.
 * All tool logic is in src/gcc-procurement/.
 */

'use strict';

const { app } = require('@azure/functions');

// Wrap module load so a schema load failure returns a 503 rather than
// crashing the entire Azure Functions worker process (which would take
// down all other endpoints too).
let TOOLS = [], TOOL_HANDLERS = {}, SERVER_INFO = { name: 'gcc-procurement-mcp', version: '1.0.0', schemaVersion: 'unknown' };
let _moduleLoadError = null;

try {
    ({ TOOLS, TOOL_HANDLERS, SERVER_INFO } = require('../gcc-procurement/index'));
} catch (err) {
    _moduleLoadError = err;
    // Log at startup so the error appears in Azure Application Insights / Log Stream
    console.error('GCC Procurement MCP: module load failed —', err.message);
}

// ─── Date context helper (matches mcpSchema.js pattern) ──────────────────────
function getDateContext() {
    const now = new Date();
    return {
        generatedAt: now.toISOString(),
        date: now.toISOString().split('T')[0],
    };
}

// ─── MCP JSON-RPC handler ─────────────────────────────────────────────────────
async function handleMcpRequest(request, context) {
    const { jsonrpc, method, params, id } = request;

    if (jsonrpc !== '2.0') {
        return {
            jsonrpc: '2.0',
            error: {
                code: -32600,
                message: 'Invalid Request: jsonrpc must be "2.0"',
            },
            id: id || null,
        };
    }

    context.log(`Processing MCP Procurement method: ${method}`);

    switch (method) {
        case 'initialize':
            return {
                jsonrpc: '2.0',
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: {
                        ...SERVER_INFO,
                        ...getDateContext(),
                        instructions: `🏛️ GLOUCESTER CITY COUNCIL PROCUREMENT RULES ENGINE MCP

This MCP is a read-only constitutional rules engine for GCC procurement governance.
All rules are derived from ${SERVER_INFO.schemaFile || 'procurement-contracts-schema-v0.9.2.json'} (v${SERVER_INFO.schemaVersion}).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- gcc_procurement_determine_route  — Full procurement decision for a contract value/type
- gcc_procurement_check_supplier   — Supplier compliance checklist
- gcc_procurement_validate_case    — Validate case against risk flags and required assessments
- gcc_procurement_get_notices      — Required UK notice sequence
- gcc_procurement_explain_rule     — Plain English explanation of any rule, threshold, or conflict

⚠️ ADVISORY: This engine reflects the constitutional position as encoded in the schema.
For live procurement decisions always verify with the Head of Procurement and One Legal.`,
                    },
                },
                id,
            };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return {
                jsonrpc: '2.0',
                result: { tools: TOOLS },
                id,
            };

        case 'tools/call': {
            const { name, arguments: args } = params || {};

            if (!name) {
                return {
                    jsonrpc: '2.0',
                    error: {
                        code: -32602,
                        message: 'Invalid params: tool name is required',
                    },
                    id,
                };
            }

            const handler = TOOL_HANDLERS[name];
            if (!handler) {
                return {
                    jsonrpc: '2.0',
                    error: {
                        code: -32602,
                        message: `Unknown tool: ${name}. Available: ${Object.keys(TOOL_HANDLERS).join(', ')}`,
                    },
                    id,
                };
            }

            try {
                context.log(`Executing procurement tool: ${name}`);
                const result = handler(args || {});

                const wrappedResult = {
                    ...getDateContext(),
                    schemaVersion: SERVER_INFO.schemaVersion,
                    tool: name,
                    data: result,
                };

                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(wrappedResult, null, 2),
                            },
                        ],
                    },
                    id,
                };
            } catch (error) {
                context.log.error(`Procurement tool error [${name}]: ${error.message}`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error: error.message,
                                    tool: name,
                                    note: 'An unexpected error occurred executing the procurement tool.',
                                }, null, 2),
                            },
                        ],
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
                error: {
                    code: -32601,
                    message: `Method not found: ${method}`,
                },
                id,
            };
    }
}

// ─── HTTP trigger registration ────────────────────────────────────────────────
app.http('mcpProcurement', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp-procurement',
    handler: async (request, context) => {
        context.log('MCP Procurement request received');

        // Schema failed to load at startup — surface the error rather than crashing
        if (_moduleLoadError) {
            context.log.error('Procurement MCP unavailable — schema load error:', _moduleLoadError.message);
            return {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: `Procurement MCP unavailable: ${_moduleLoadError.message}`,
                    },
                    id: null,
                }),
            };
        }

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.error('Failed to parse request body:', parseError);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        error: {
                            code: -32700,
                            message: 'Parse error: Invalid JSON',
                        },
                        id: null,
                    }),
                };
            }

            const response = await handleMcpRequest(body, context);

            // Notifications return null — respond with 204
            if (response === null) {
                return { status: 204 };
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
            };
        } catch (error) {
            context.log.error('MCP Procurement unhandled error:', error);

            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: error.message,
                    },
                    id: null,
                }),
            };
        }
    },
});
