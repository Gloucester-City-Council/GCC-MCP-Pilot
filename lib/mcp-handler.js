/**
 * MCP JSON-RPC Protocol Handler
 * Implements the Model Context Protocol for ModernGov API access
 */

const { listCommittees } = require('./tools/list-committees');
const { getCouncillors } = require('./tools/get-councillors');
const { getCouncillorsByWard } = require('./tools/get-councillors-by-ward');
const { getMeetings } = require('./tools/get-meetings');
const { getMeetingDetails } = require('./tools/get-meeting-details');
const { getAttachment } = require('./tools/get-attachment');

// Tool definitions with full JSON Schema
const TOOLS = [
    {
        name: 'list_committees',
        description: 'Lists all committees and boards at Gloucester City Council with ID, name, category, and expired status.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'get_meetings',
        description: 'Gets meetings for a specific committee within a date range. Dates MUST be in DD/MM/YYYY format (UK style).',
        inputSchema: {
            type: 'object',
            properties: {
                committee_id: {
                    type: 'integer',
                    description: 'Committee ID (use list_committees to find IDs)'
                },
                from_date: {
                    type: 'string',
                    description: 'Start date in DD/MM/YYYY format (e.g., "01/01/2025")'
                },
                to_date: {
                    type: 'string',
                    description: 'End date in DD/MM/YYYY format (e.g., "31/12/2025")'
                }
            },
            required: ['committee_id']
        }
    },
    {
        name: 'get_meeting_details',
        description: 'Gets detailed information about a specific meeting including agenda items, documents, attendees, and decisions.',
        inputSchema: {
            type: 'object',
            properties: {
                meeting_id: {
                    type: 'integer',
                    description: 'Meeting ID (obtained from get_meetings)'
                }
            },
            required: ['meeting_id']
        }
    },
    {
        name: 'get_councillors',
        description: 'Gets all councillors organized by ward. Returns list of all wards with their councillors including names, parties, and contact information.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'get_councillors_by_ward',
        description: 'Gets councillors for a specific ward by ward name.',
        inputSchema: {
            type: 'object',
            properties: {
                ward_name: {
                    type: 'string',
                    description: 'Ward name (e.g., "Kingsholm and Wotton", "Westgate")'
                }
            },
            required: ['ward_name']
        }
    },
    {
        name: 'get_attachment',
        description: 'Gets metadata and URL for a specific document/attachment. Attachment IDs are found in meeting details linkeddocuments.',
        inputSchema: {
            type: 'object',
            properties: {
                attachment_id: {
                    type: 'integer',
                    description: 'Attachment ID (obtained from get_meeting_details in linkeddocuments)'
                }
            },
            required: ['attachment_id']
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

        case 'get_councillors':
            return await getCouncillors();

        case 'get_councillors_by_ward':
            if (!args.ward_name) {
                throw new Error('ward_name is required');
            }
            return await getCouncillorsByWard(args.ward_name);

        case 'get_attachment':
            if (args.attachment_id === undefined) {
                throw new Error('attachment_id is required');
            }
            return await getAttachment(args.attachment_id);

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
                id: id
            };

        case 'notifications/initialized':
            // Client acknowledgement - no response needed for notifications
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
