/**
 * MCP Schema HTTP Function - POST /mcp-schema
 * Implements MCP JSON-RPC protocol for Gloucester City Council's
 * Council Tax policy schema.
 *
 * Council Tax schema: v2.5.6 runtime-first four-document pack
 * (facts, rules, taxonomy, results) approved for 2026/27.
 */

const { app } = require('@azure/functions');

const schemaGet = require('../tools/schemaGet');
const schemaSearch = require('../tools/schemaSearch');
const schemaTodos = require('../tools/schemaTodos');
const schemaEvaluate = require('../tools/schemaEvaluate');
const { getSchemaVersion, getSchemaHash, isSchemaLoaded, getFinancialYear } = require('../schema/loader');

const TOOLS = [
    {
        name: 'schema_get',
        description: `Retrieve council tax information by path, including runtime-focused contract sections.

Key paths:
- /discounts, /exemptions, /property_premiums, /charge_outputs
- /runtime_vocabularies, /runtime_case_model, /runtime_resolver_contract
- /runtime_contract, /consumer_contract, /supporting_context
- /executable_rules, /taxonomy, /evidence_requirements`,
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'JSON Pointer path, starting with /' },
                projection: { type: 'array', items: { type: 'string' } },
                maxBytes: { type: 'integer' }
            },
            required: ['path']
        }
    },
    {
        name: 'schema_search',
        description: 'Search council tax policy and runtime contract content using plain language.',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Search query text' },
                scope: { type: 'array', items: { type: 'string' } },
                topK: { type: 'integer' },
                filters: { type: 'object' }
            },
            required: ['text']
        }
    },
    {
        name: 'schema_todos',
        description: 'List publication and assurance gaps that still need confirmation.',
        inputSchema: {
            type: 'object',
            properties: {
                scope: { type: 'array', items: { type: 'string' } }
            },
            required: []
        }
    },
    {
        name: 'schema_evaluate',
        description: `Run runtime-first council tax eligibility resolution.
Returns best outcome, alternatives, facts used/derived, normalised household, missing facts, confidence and trace metadata.`,
        inputSchema: {
            type: 'object',
            properties: {
                rulesetId: {
                    type: 'string',
                    enum: ['discount_eligibility']
                },
                userFacts: {
                    type: 'object'
                },
                projectionMode: {
                    type: 'string',
                    enum: ['runtime', 'trace', 'debug']
                }
            },
            required: ['rulesetId', 'userFacts']
        }
    }
];

const TOOL_HANDLERS = {
    schema_get: schemaGet.execute,
    schema_search: schemaSearch.execute,
    schema_todos: schemaTodos.execute,
    schema_evaluate: schemaEvaluate.execute
};
const AVAILABLE_TOOL_NAMES = Object.keys(TOOL_HANDLERS).join(', ');

const UK_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB');

function getDateContext() {
    const now = new Date();
    return {
        current_date: now.toISOString().split('T')[0],
        current_date_uk: UK_DATE_FORMATTER.format(now),
        timestamp: now.toISOString()
    };
}

async function handleMcpRequest(request, context) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: body must be a JSON object' }, id: null };
    }

    const { jsonrpc, method, params, id } = request;
    const requestId = Object.prototype.hasOwnProperty.call(request, 'id') && id !== undefined ? id : null;

    if (jsonrpc !== '2.0') {
        return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }, id: requestId };
    }

    context.log(`Processing MCP Schema method: ${method}`);

    switch (method) {
        case 'initialize':
            return {
                jsonrpc: '2.0',
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: {
                        name: 'gcc-policy-schema-mcp',
                        version: '2.1.0',
                        description: 'Gloucester City Council Council Tax Policy Schema (runtime-first)',
                        schemas: {
                            councilTax: {
                                version: getSchemaVersion(),
                                hash: getSchemaHash(),
                                loaded: isSchemaLoaded(),
                                financialYear: getFinancialYear(),
                                documentPack: 'v2.5.6 (facts, rules, taxonomy, results)',
                                status: 'council-approved'
                            }
                        },
                        ...getDateContext(),
                        instructions: `COUNCIL TAX RUNTIME-FIRST POLICY SERVER
- Use runtime contract sections for decisioning: /runtime_vocabularies, /runtime_case_model, /runtime_resolver_contract, /runtime_contract.
- Return resolved outcome with alternatives plus facts and trace metadata.
- Always include missing critical facts and confidence context.
- Use /supporting_context for policy narrative and assurance evidence.`
                    }
                },
                id
            };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return { jsonrpc: '2.0', result: { tools: TOOLS }, id };

        case 'tools/call': {
            const { name, arguments: args } = params || {};
            const toolStart = Date.now();

            if (!name) {
                return { jsonrpc: '2.0', error: { code: -32602, message: 'Invalid params: tool name is required' }, id };
            }

            const handler = TOOL_HANDLERS[name];
            if (!handler) {
                return { jsonrpc: '2.0', error: { code: -32602, message: `Unknown tool: ${name}. Available: ${AVAILABLE_TOOL_NAMES}` }, id };
            }

            try {
                context.log(`Executing schema tool: ${name}`);
                const result = await Promise.resolve(handler(args || {}));
                context.log(`Schema tool completed [${name}] in ${Date.now() - toolStart}ms`);

                const wrappedResult = {
                    ...getDateContext(),
                    schemaVersion: getSchemaVersion(),
                    financialYear: getFinancialYear(),
                    data: result
                };

                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(wrappedResult, null, 2) }]
                    },
                    id
                };
            } catch (error) {
                context.log.error(`Schema tool error [${name}]: ${error.message}`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({ error: error.message, tool: name, note: 'An unexpected error occurred executing the schema tool.' }, null, 2)
                        }],
                        isError: true
                    },
                    id
                };
            }
        }

        case 'ping':
            return { jsonrpc: '2.0', result: {}, id };

        default:
            return { jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id };
    }
}

app.http('mcpSchema', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp-schema',
    handler: async (request, context) => {
        const requestStart = Date.now();
        context.log('MCP Schema request received');

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.error('Failed to parse request body:', parseError);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null })
                };
            }

            const response = await handleMcpRequest(body, context);
            if (response === null) {
                context.log(`MCP Schema request completed with 204 in ${Date.now() - requestStart}ms`);
                return { status: 204 };
            }

            context.log(`MCP Schema request completed with 200 in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response)
            };
        } catch (error) {
            context.log.error('MCP Schema handler error:', error.message);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal error' },
                    id: null
                })
            };
        }
    }
});

module.exports = { handleMcpRequest };
