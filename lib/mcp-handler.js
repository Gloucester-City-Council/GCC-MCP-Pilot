/**
 * MCP JSON-RPC Protocol Handler
 * Implements the Model Context Protocol for ModernGov API access
 */

const { listCommittees } = require('./tools/list-committees');
const { getCouncillors } = require('./tools/get-councillors');
const { getMeetings } = require('./tools/get-meetings');
const { getMeetingDetails } = require('./tools/get-meeting-details');

// Tool definitions with full JSON Schema
const TOOLS = [
    {
        name: 'list_committees',
        description: 'List all committees at Gloucester City Council. Returns committee names, IDs, descriptions, and typical topics they handle.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'get_councillors',
        description: 'Get councillors for a given postcode. Returns ward councillors who represent the area.',
        inputSchema: {
            type: 'object',
            properties: {
                postcode: {
                    type: 'string',
                    description: 'UK postcode to look up (e.g., "GL1 1AA")'
                }
            },
            required: ['postcode']
        }
    },
    {
        name: 'get_meetings',
        description: 'Get scheduled meetings for a committee. Can filter by date range.',
        inputSchema: {
            type: 'object',
            properties: {
                committee_id: {
                    type: 'integer',
                    description: 'The ModernGov committee ID'
                },
                from_date: {
                    type: 'string',
                    description: 'Start date in YYYY-MM-DD format (optional)'
                },
                to_date: {
                    type: 'string',
                    description: 'End date in YYYY-MM-DD format (optional)'
                }
            },
            required: ['committee_id']
        }
    },
    {
        name: 'get_meeting_details',
        description: 'Get detailed information about a specific meeting including agenda items, documents, and decisions.',
        inputSchema: {
            type: 'object',
            properties: {
                meeting_id: {
                    type: 'integer',
                    description: 'The ModernGov meeting ID'
                }
            },
            required: ['meeting_id']
        }
    }
];

/**
 * Route tool calls to appropriate implementations
 */
async function callTool(name, args, context) {
    context.log(`Calling tool: ${name} with args:`, args);

    switch (name) {
        case 'list_committees':
            return await listCommittees();

        case 'get_councillors':
            if (!args.postcode) {
                throw new Error('postcode is required');
            }
            return await getCouncillors(args.postcode);

        case 'get_meetings':
            if (args.committee_id === undefined) {
                throw new Error('committee_id is required');
            }
            return await getMeetings(args.committee_id, args.from_date, args.to_date);

        case 'get_meeting_details':
            if (args.meeting_id === undefined) {
                throw new Error('meeting_id is required');
            }
            return await getMeetingDetails(args.meeting_id);

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
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

    context.log(`Processing MCP method: ${method}`);

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
                        name: 'moderngov-mcp',
                        version: '1.0.0'
                    }
                },
                id
            };

        case 'notifications/initialized':
            // Client acknowledgement - no response needed for notifications
            return {
                jsonrpc: '2.0',
                result: {},
                id
            };

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

                // Check if tool exists
                const tool = TOOLS.find(t => t.name === name);
                if (!tool) {
                    return {
                        jsonrpc: '2.0',
                        error: {
                            code: -32602,
                            message: `Unknown tool: ${name}`
                        },
                        id
                    };
                }

                const result = await callTool(name, args || {}, context);

                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    },
                    id
                };
            } catch (error) {
                context.log.error(`Tool call error: ${error.message}`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error: error.message,
                                    note: 'This may be due to stub implementation - SOAP integration pending'
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

module.exports = { handleMcpRequest, TOOLS };
