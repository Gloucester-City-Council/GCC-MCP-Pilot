/**
 * Azure Functions v4 HTTP Trigger — GCC Azure Estate MCP
 *
 * Exposes the Azure estate administration tools (resource groups,
 * Function Apps, Static Web Apps, Storage/Blob, Cosmos DB, and
 * cross-resource stack orchestration) at POST /api/mcp-azure-estate.
 *
 * All tool logic lives in src/gcc-azure-estate/. This trigger only
 * implements the MCP JSON-RPC envelope, centralized secret redaction,
 * and error-code mapping (AzureEstateError -> isError response).
 */

'use strict';

const { app } = require('@azure/functions');
const { AzureEstateError, ERROR_CODES } = require('../gcc-azure-estate/lib/errors');
const { wrapToolResult } = require('../gcc-azure-estate/lib/response');

// context.log.error isn't guaranteed to exist across Azure Functions
// runtime versions (see src/functions/mcpNotes.js's identical guard) — an
// unhandled "context.log.error is not a function" here would crash out of
// the tools/call try/catch entirely, turning a normal tool error into an
// opaque 500 with no useful message. Every tool failure in this MCP was
// silently hitting exactly that until this was added.
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

// Wrap module load so a config/dependency failure returns a 503 rather
// than crashing the entire Azure Functions worker process (which would
// take down all other endpoints too) — same defensive pattern as
// mcpProcurement.js.
let TOOLS = [], TOOL_HANDLERS = {}, SERVER_INFO = { name: 'gcc-azure-estate-mcp', version: '1.0.0' };
let _moduleLoadError = null;

try {
    ({ TOOLS, TOOL_HANDLERS, SERVER_INFO } = require('../gcc-azure-estate/index'));
} catch (err) {
    _moduleLoadError = err;
    console.error('Azure Estate MCP: module load failed —', err.message);
}

const AVAILABLE_TOOL_NAMES = () => Object.keys(TOOL_HANDLERS).join(', ');

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

    context.log(`Processing Azure Estate MCP method: ${method}`);

    switch (method) {
        case 'initialize':
            return {
                jsonrpc: '2.0',
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: {
                        ...SERVER_INFO,
                        instructions: `🏛️ GCC AZURE ESTATE ADMINISTRATOR MCP

A governed MCP for inspecting, diagnosing, and provisioning the Azure resources GCC's AI-assisted services run on: resource groups, Function Apps, Static Web Apps, Storage/Blob, and Cosmos DB.

A resource group is an operational boundary, not merely a filter — azure_resource_group_inventory summarises resources by type, region, tags, managed identities, public exposure, diagnostic coverage, and configuration findings.

🔑 START HERE: azure_ping, then azure_instances_list to find the exact \`instance\` name required by every other tool.

Every tool follows predictable verbs where meaningful: list, inspect, diagnose, compare, plan, create, apply. "_plan" tools compute a dry-run plan and never call a write API. Write-capable tools are gated per-instance by config/azure-instances.yaml — a FORBIDDEN error means the target instance hasn't been granted that operation class, not that the tool is broken.

Resource-group deletion and blob content read/write are permanently out of scope — no such tool exists.`,
                    },
                },
                id,
            };

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

            const handler = TOOL_HANDLERS[name];
            if (!handler) {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: `Unknown tool: ${name}. Available: ${AVAILABLE_TOOL_NAMES()}` },
                    id,
                };
            }

            try {
                context.log(`Executing Azure Estate tool: ${name}`);
                const result = await Promise.resolve(handler(args || {}));
                context.log(`Azure Estate tool completed [${name}] in ${Date.now() - toolStart}ms`);

                const wrapped = wrapToolResult(name, (args && args.instance) || null, result);

                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(wrapped, null, 2) }],
                    },
                    id,
                };
            } catch (error) {
                const isEstateError = error instanceof AzureEstateError;
                const code = isEstateError ? error.code : ERROR_CODES.INTERNAL_ERROR;

                logError(context, `Azure Estate tool error [${name}] (${code}): ${error.message}`);
                if (error && error.stack) logError(context, `Azure Estate tool error stack [${name}]: ${error.stack}`);
                logError(context, `Azure Estate tool failed [${name}] after ${Date.now() - toolStart}ms`);

                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                error: error.message,
                                code,
                                tool: name,
                                details: isEstateError ? error.details : undefined,
                                hint: code === ERROR_CODES.FORBIDDEN
                                    ? 'Call azure_instances_list to see which operation classes are granted to this instance.'
                                    : 'Call azure_ping to confirm the Estate MCP is healthy, then retry with corrected parameters.',
                            }, null, 2),
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

app.http('mcpAzureEstate', {
    methods: ['POST'],
    // Every other endpoint in this app is 'anonymous', but this one can
    // actually create/modify real Azure resources under the Function App's
    // Managed Identity — it requires a function key (?code=... or the
    // x-functions-key header). Get the key from Portal: Function App ->
    // Functions -> mcpAzureEstate -> Function Keys, or
    // `az functionapp function keys list --name func-mpc-poc --function-name mcpAzureEstate`.
    authLevel: 'function',
    route: 'mcp-azure-estate',
    handler: async (request, context) => {
        const requestStart = Date.now();
        context.log('MCP Azure Estate request received');

        if (_moduleLoadError) {
            console.error('Azure Estate MCP unavailable — module load error:', _moduleLoadError.message);
            return {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: `Azure Estate MCP unavailable: ${_moduleLoadError.message}` },
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
                context.log(`MCP Azure Estate request completed with 204 in ${Date.now() - requestStart}ms`);
                return { status: 204 };
            }

            context.log(`MCP Azure Estate request completed with 200 in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
            };
        } catch (error) {
            console.error('MCP Azure Estate unhandled error:', error.message);
            if (error && error.stack) console.error('MCP Azure Estate unhandled stack:', error.stack);
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

module.exports = { handleMcpRequest };
