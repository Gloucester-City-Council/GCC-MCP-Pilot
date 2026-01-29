/**
 * MCP Heritage HTTP Function - POST /mcp-heritage
 * Implements MCP JSON-RPC protocol for heritage assets schema-driven tools
 */

const { app } = require('@azure/functions');
const heritageGet = require('../tools/heritageGet');
const heritageSearch = require('../tools/heritageSearch');
const { getSchemaVersion, getSchemaHash, isSchemaLoaded } = require('../heritage/loader');

/**
 * MCP Tool definitions with JSON Schema for Heritage Assets
 */
const TOOLS = [
    {
        name: 'heritage_get',
        description: `Retrieve data from the Heritage Assets schema by JSON Pointer path.

Usage: heritage_get(path='/legislativeFramework/primaryLegislation/0')

Supports:
- JSON Pointer (RFC 6901) paths like "/serviceProcesses", "/heritageAssetTypes/designatedAssets"
- Optional projection to select specific fields
- maxBytes limit to prevent oversized responses

Returns heritage policy data with version and hash for cache validation.

Key paths:
- /legislativeFramework - Planning (Listed Buildings and Conservation Areas) Act 1990 and NPPF Chapter 16
- /heritageAssetTypes - Listed buildings, conservation areas, scheduled monuments, etc.
- /serviceProcesses - Listed building consent, conservation area consent, heritage at risk
- /userJourneys - Owner, developer, and officer journeys
- /keyDefinitions - Significance, setting, substantial harm, public benefits`,
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'JSON Pointer path (e.g., "/serviceProcesses", "/heritageAssetTypes"). Must start with /'
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
        name: 'heritage_search',
        description: `Search the Heritage Assets schema for relevant content.

Usage: heritage_search(text='listed building consent', topK=5)

Features:
- Hybrid search using BM25 + keyword boosting
- Scope filtering by section (legislativeFramework, serviceProcesses, heritageAssetTypes, etc.)
- Heritage-specific term boosting for statutory concepts
- Returns ranked snippets with JSON paths

Good for finding:
- Statutory duties (Section 66, Section 72)
- NPPF policies (paragraphs 202-219)
- Consent requirements and processes
- Heritage asset types and grades
- Harm assessment frameworks
- Public benefits tests`,
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
                    description: 'Sections to search (e.g., ["serviceProcesses", "legislativeFramework"]). Empty = all sections.'
                },
                topK: {
                    type: 'integer',
                    description: 'Number of results to return (default: 5)'
                },
                filters: {
                    type: 'object',
                    description: 'Additional filters (e.g., {"tag": "consent"}, {"section": "serviceProcesses"})'
                }
            },
            required: ['text']
        }
    }
];

/**
 * Tool name to handler mapping
 */
const TOOL_HANDLERS = {
    'heritage_get': heritageGet.execute,
    'heritage_search': heritageSearch.execute
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
 * Handle MCP JSON-RPC requests for Heritage Assets
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

    context.log(`Processing MCP Heritage method: ${method}`);

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
                        name: 'heritage-assets-schema-mcp',
                        version: '1.0.0',
                        description: 'Gloucester City Council Heritage Assets Schema - Designated Heritage Assets Policy and Consent Information',
                        schemaVersion: getSchemaVersion(),
                        schemaHash: getSchemaHash(),
                        schemaLoaded: isSchemaLoaded(),
                        ...getDateContext(),
                        instructions: `🏛️ HERITAGE ASSETS SCHEMA MCP SERVER

This MCP provides access to Gloucester City Council's Heritage Assets schema, containing comprehensive information about:
- Listed Building Consent requirements and processes
- Conservation Area controls
- NPPF Chapter 16 policy framework
- Statutory duties (Sections 16, 66, 72 of the 1990 Act)
- Harm assessment frameworks (substantial harm, less than substantial harm)
- Public benefits tests
- Heritage at Risk procedures

🔧 AVAILABLE TOOLS:

1. heritage_get - Retrieve specific sections by path
   Example: heritage_get(path='/serviceProcesses/listedBuildingConsent')

2. heritage_search - Search for relevant content
   Example: heritage_search(text='substantial harm test')

📍 KEY PATHS:
- /legislativeFramework - Primary legislation, NPPF policies, Historic England guidance
- /heritageAssetTypes - Listed buildings, conservation areas, scheduled monuments
- /serviceProcesses - LBC process, conservation area consent, heritage at risk
- /userJourneys - Owner, developer, and officer decision paths
- /keyDefinitions - Significance, setting, substantial harm, public benefits
- /contactInformation - Gloucester City Council and external organisation contacts

⚖️ STATUTORY FRAMEWORK:
- Planning (Listed Buildings and Conservation Areas) Act 1990
- NPPF Chapter 16: Conserving and enhancing the historic environment
- Historic England Advice Notes (HEAN 2, 10, 12, 16)

⚠️ ADVISORY: Information provided is for guidance. Actual consent requirements depend on specific circumstances and professional assessment.`
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

                context.log(`Executing heritage tool: ${name}`);
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
                context.log.error(`Heritage tool error: ${error.message}`);
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
 * Handle POST /mcp-heritage requests
 */
app.http('mcpHeritage', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp-heritage',
    handler: async (request, context) => {
        context.log('MCP Heritage request received');

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
            context.log.error('MCP Heritage error:', error);

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
