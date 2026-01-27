/**
 * MCP Schema HTTP Function - POST /mcp-schema
 * Implements MCP JSON-RPC protocol for schema-driven tools
 */

const { app } = require('@azure/functions');
const schemaGet = require('../tools/schemaGet');
const schemaSearch = require('../tools/schemaSearch');
const schemaTodos = require('../tools/schemaTodos');
const schemaEvaluate = require('../tools/schemaEvaluate');
const { getSchemaVersion, getSchemaHash, isSchemaLoaded } = require('../schema/loader');

/**
 * MCP Tool definitions with JSON Schema
 */
const TOOLS = [
    {
        name: 'schema_get',
        description: `Retrieve data from the Council Tax schema by JSON Pointer path.

Usage: schema_get(path='/discounts/person_based_discounts/0')

Supports:
- JSON Pointer (RFC 6901) paths like "/discounts", "/legal_framework/primary_legislation"
- Optional projection to select specific fields
- maxBytes limit to prevent oversized responses

Returns schema data with version and hash for cache validation.`,
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'JSON Pointer path (e.g., "/discounts", "/schema_metadata"). Must start with /'
                },
                projection: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional list of fields to include in response'
                },
                maxBytes: {
                    type: 'integer',
                    description: 'Maximum response size in bytes (default: 200000)'
                }
            },
            required: ['path']
        }
    },
    {
        name: 'schema_search',
        description: `Search the Council Tax schema for relevant content.

Usage: schema_search(text='single person discount', topK=5)

Features:
- Hybrid search using BM25 + keyword boosting
- Scope filtering by section (discounts, appeals, enforcement, etc.)
- Returns ranked snippets with JSON paths

Good for finding specific discounts, exemptions, or policy details.`,
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'Search query text'
                },
                scope: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Sections to search (e.g., ["discounts", "exemptions"]). Empty = all sections.'
                },
                topK: {
                    type: 'integer',
                    description: 'Number of results to return (default: 5)'
                },
                filters: {
                    type: 'object',
                    description: 'Additional filters (e.g., {"section": "discounts"})'
                }
            },
            required: ['text']
        }
    },
    {
        name: 'schema_todos',
        description: `Extract TODO and validation items from the schema.

Usage: schema_todos(scope=['data_privacy', 'governance'])

Returns items needing attention with severity:
- blocking: Legal/DPO sign-off required
- needs-confirmation: URLs, timescales, policy links
- nice-to-have: Minor improvements

Useful for identifying incomplete sections before publication.`,
        inputSchema: {
            type: 'object',
            properties: {
                scope: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Sections to check (e.g., ["data_privacy", "enforcement"]). Empty = all sections.'
                }
            },
            required: []
        }
    },
    {
        name: 'schema_evaluate',
        description: `Evaluate discount eligibility based on user facts.

Usage: schema_evaluate(rulesetId='discount_eligibility', userFacts={adults: 1, students: 0})

Currently supports: discount_eligibility ruleset

User facts can include:
- adults: Number of adults in household
- students: Number of full-time students
- carers: Number of live-in carers
- severely_mentally_impaired: Count of SMI persons
- disabled_resident: true/false
- has_disabled_adaptations: true/false
- care_leaver: true/false
- age: Person's age

Returns advisory candidates with likelihood (likely/unclear/unlikely).`,
        inputSchema: {
            type: 'object',
            properties: {
                rulesetId: {
                    type: 'string',
                    description: 'Ruleset to evaluate. Currently only "discount_eligibility" is supported.',
                    enum: ['discount_eligibility']
                },
                userFacts: {
                    type: 'object',
                    description: 'Facts about the user/household for evaluation'
                }
            },
            required: ['rulesetId', 'userFacts']
        }
    }
];

/**
 * Tool name to handler mapping
 */
const TOOL_HANDLERS = {
    'schema_get': schemaGet.execute,
    'schema_search': schemaSearch.execute,
    'schema_todos': schemaTodos.execute,
    'schema_evaluate': schemaEvaluate.execute
};

/**
 * Get current date context
 */
function getDateContext() {
    const now = new Date();
    return {
        current_date: now.toISOString().split('T')[0],
        current_date_uk: now.toLocaleDateString('en-GB'),
        timestamp: now.toISOString()
    };
}

/**
 * Handle MCP JSON-RPC requests
 */
async function handleMcpRequest(request, context) {
    const { jsonrpc, method, params, id } = request;

    // Validate JSON-RPC version
    if (jsonrpc !== '2.0') {
        return {
            jsonrpc: '2.0',
            error: {
                code: -32600,
                message: 'Invalid Request: jsonrpc must be "2.0"'
            },
            id: id || null
        };
    }

    context.log(`Processing MCP Schema method: ${method}`);

    switch (method) {
        case 'initialize':
            return {
                jsonrpc: '2.0',
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {}
                    },
                    serverInfo: {
                        name: 'council-tax-schema-mcp',
                        version: '1.0.0',
                        description: 'Gloucester City Council Tax Schema - Policy and Discount Information',
                        schemaVersion: getSchemaVersion(),
                        schemaHash: getSchemaHash(),
                        schemaLoaded: isSchemaLoaded(),
                        ...getDateContext(),
                        instructions: `📋 COUNCIL TAX SCHEMA MCP SERVER

This MCP provides access to Gloucester City Council's Council Tax schema, containing comprehensive information about:
- Discounts (single person, students, carers, care leavers, disabled)
- Exemptions (property and person-based)
- Premiums (empty homes, second homes)
- Payment and enforcement processes
- Appeals and challenges
- Holiday lets and self-catering rules

🔧 AVAILABLE TOOLS:

1. schema_get - Retrieve specific sections by path
   Example: schema_get(path='/discounts/person_based_discounts')

2. schema_search - Search for relevant content
   Example: schema_search(text='single person discount')

3. schema_todos - Find incomplete/validation items
   Example: schema_todos(scope=['data_privacy'])

4. schema_evaluate - Check discount eligibility
   Example: schema_evaluate(rulesetId='discount_eligibility', userFacts={adults: 1})

📍 KEY PATHS:
- /schema_metadata - Version and validation status
- /discounts - All discount types
- /exemptions - Property exemptions
- /property_premiums - Empty homes and second homes premiums
- /council_tax_support - Financial assistance scheme
- /enforcement - Recovery process stages
- /appeals_and_challenges - How to dispute
- /holiday_lets_and_self_catering - Business rates vs Council Tax

⚠️ ADVISORY ONLY: Eligibility evaluations are advisory. Actual eligibility requires formal assessment with evidence.`
                    }
                },
                id
            };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return {
                jsonrpc: '2.0',
                result: {
                    tools: TOOLS
                },
                id
            };

        case 'tools/call':
            try {
                const { name, arguments: args } = params || {};

                if (!name) {
                    return {
                        jsonrpc: '2.0',
                        error: {
                            code: -32602,
                            message: 'Invalid params: tool name is required'
                        },
                        id
                    };
                }

                const handler = TOOL_HANDLERS[name];
                if (!handler) {
                    return {
                        jsonrpc: '2.0',
                        error: {
                            code: -32602,
                            message: `Unknown tool: ${name}. Available: ${Object.keys(TOOL_HANDLERS).join(', ')}`
                        },
                        id
                    };
                }

                context.log(`Executing schema tool: ${name}`);
                const result = handler(args || {});

                const wrappedResult = {
                    ...getDateContext(),
                    schemaVersion: getSchemaVersion(),
                    data: result
                };

                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(wrappedResult, null, 2)
                            }
                        ]
                    },
                    id
                };
            } catch (error) {
                context.log.error(`Schema tool error: ${error.message}`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error: error.message
                                }, null, 2)
                            }
                        ],
                        isError: true
                    },
                    id
                };
            }

        case 'ping':
            return {
                jsonrpc: '2.0',
                result: {},
                id
            };

        default:
            return {
                jsonrpc: '2.0',
                error: {
                    code: -32601,
                    message: `Method not found: ${method}`
                },
                id
            };
    }
}

/**
 * Handle POST /mcp-schema requests
 */
app.http('mcpSchema', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp-schema',
    handler: async (request, context) => {
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
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        error: {
                            code: -32700,
                            message: 'Parse error: Invalid JSON'
                        },
                        id: null
                    })
                };
            }

            const response = await handleMcpRequest(body, context);

            // Notifications return null - respond with 204
            if (response === null) {
                return {
                    status: 204
                };
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response)
            };
        } catch (error) {
            context.log.error('MCP Schema error:', error);

            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: error.message
                    },
                    id: null
                })
            };
        }
    }
});
