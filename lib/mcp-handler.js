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
const { analyzeMeetingDocument } = require('./tools/analyze-meeting-document');
const councilConfig = require('./council-config');

/**
 * Get current date context for AI assistants
 * Helps prevent date drift when discussing democratic records
 */
function getDateContext() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return {
        current_date: now.toISOString().split('T')[0], // YYYY-MM-DD
        current_date_uk: now.toLocaleDateString('en-GB'), // DD/MM/YYYY
        current_date_readable: now.toLocaleDateString('en-GB', options),
        timestamp: now.toISOString(),
        note: 'Use this date context when discussing meetings - do not assume or guess dates.'
    };
}

// Tool definitions with full JSON Schema
const TOOLS = [
    {
        name: 'list_committees',
        description: 'Lists all committees and boards for Gloucestershire councils. Returns committees for all councils if council_name is not specified, or for a specific council if provided.',
        inputSchema: {
            type: 'object',
            properties: {
                council_name: {
                    type: 'string',
                    description: `Council name (optional). Available councils: ${councilConfig.getCouncilNames().join(', ')}. If not specified, returns committees for all councils.`
                }
            },
            required: []
        }
    },
    {
        name: 'get_meetings',
        description: `Gets meetings for a specific committee within a date range for a Gloucestershire council. Dates MUST be in DD/MM/YYYY format (UK style).

Returns official meeting schedule data. Meeting dates, times, and venues are part of the democratic record and should be presented accurately. Always include meeting web_page links when referencing specific meetings.`,
        inputSchema: {
            type: 'object',
            properties: {
                council_name: {
                    type: 'string',
                    description: `Council name. Available councils: ${councilConfig.getCouncilNames().join(', ')}`
                },
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
            required: ['council_name', 'committee_id']
        }
    },
    {
        name: 'get_meeting_details',
        description: `Gets complete meeting details including agenda, attendees, and linked documents for a Gloucestershire council.

⚠️ CRITICAL: This returns official democratic record. When presenting:
- Quote recommendations/decisions verbatim (never paraphrase)
- Always include source URLs in your response
- Clearly separate official record from your interpretation
- Use format: Official Record → Plain English → Source Link

Response includes data_classification and is_official_record fields to help identify statutory content.`,
        inputSchema: {
            type: 'object',
            properties: {
                council_name: {
                    type: 'string',
                    description: `Council name. Available councils: ${councilConfig.getCouncilNames().join(', ')}`
                },
                meeting_id: {
                    type: 'integer',
                    description: 'Meeting ID (obtained from get_meetings)'
                }
            },
            required: ['council_name', 'meeting_id']
        }
    },
    {
        name: 'get_councillors',
        description: 'Gets all councillors organized by ward for a Gloucestershire council. Returns list of all wards with their councillors including names, parties, and contact information.',
        inputSchema: {
            type: 'object',
            properties: {
                council_name: {
                    type: 'string',
                    description: `Council name. Available councils: ${councilConfig.getCouncilNames().join(', ')}`
                }
            },
            required: ['council_name']
        }
    },
    {
        name: 'get_councillors_by_ward',
        description: 'Gets councillors for a specific ward by ward name in a Gloucestershire council.',
        inputSchema: {
            type: 'object',
            properties: {
                council_name: {
                    type: 'string',
                    description: `Council name. Available councils: ${councilConfig.getCouncilNames().join(', ')}`
                },
                ward_name: {
                    type: 'string',
                    description: 'Ward name (e.g., "Kingsholm and Wotton", "Westgate")'
                }
            },
            required: ['council_name', 'ward_name']
        }
    },
    {
        name: 'get_attachment',
        description: `Gets metadata and URL for a specific document/attachment for a Gloucestershire council. Attachment IDs are found in meeting details linkeddocuments.

Returns official document metadata. The document URL should always be included when referencing the document content. Use analyze_meeting_document to extract the full content, then quote official sections verbatim.`,
        inputSchema: {
            type: 'object',
            properties: {
                council_name: {
                    type: 'string',
                    description: `Council name. Available councils: ${councilConfig.getCouncilNames().join(', ')}`
                },
                attachment_id: {
                    type: 'integer',
                    description: 'Attachment ID (obtained from get_meeting_details in linkeddocuments)'
                }
            },
            required: ['council_name', 'attachment_id']
        }
    },
    {
        name: 'analyze_meeting_document',
        description: `Extracts structured content from committee papers and reports.

⚠️ CRITICAL: Extracted sections marked as 'recommendations', 'decisions', or 'legal_implications' are official statutory text and MUST be quoted verbatim when presented to users. Background and context sections may be summarized. Always include source_url in your response.

Response includes:
- data_classification: "official_record" for formal committee documents
- official_sections: Array of section names that must be quoted verbatim
- source_url: Link to original document (always include in your response)

When responding with this data:
1. Quote recommendations/decisions exactly as extracted
2. Use blockquote formatting for official text
3. Provide plain English explanation separately
4. Always link to source document`,
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'Document URL from get_attachment (format: https://democracy.Gloucester.gov.uk/mgConvert2PDF.aspx?ID={attachmentid})'
                },
                extract_sections: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Which sections to extract. Options: "all", "reasons", "recommendations", "questions", "motion", "financial", "legal". Default: ["all"]'
                },
                max_items: {
                    type: 'integer',
                    description: 'Maximum items to return for lists (recommendations, questions). Default: 20'
                }
            },
            required: ['url']
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
            return await listCommittees(args.council_name);

        case 'get_meetings':
            if (!args.council_name) {
                throw new Error('council_name is required');
            }
            if (args.committee_id === undefined) {
                throw new Error('committee_id is required');
            }
            return await getMeetings(args.council_name, args.committee_id, args.from_date, args.to_date);

        case 'get_meeting_details':
            if (!args.council_name) {
                throw new Error('council_name is required');
            }
            if (args.meeting_id === undefined) {
                throw new Error('meeting_id is required');
            }
            return await getMeetingDetails(args.council_name, args.meeting_id);

        case 'get_councillors':
            if (!args.council_name) {
                throw new Error('council_name is required');
            }
            return await getCouncillors(args.council_name);

        case 'get_councillors_by_ward':
            if (!args.council_name) {
                throw new Error('council_name is required');
            }
            if (!args.ward_name) {
                throw new Error('ward_name is required');
            }
            return await getCouncillorsByWard(args.council_name, args.ward_name);

        case 'get_attachment':
            if (!args.council_name) {
                throw new Error('council_name is required');
            }
            if (args.attachment_id === undefined) {
                throw new Error('attachment_id is required');
            }
            return await getAttachment(args.council_name, args.attachment_id);

        case 'analyze_meeting_document':
            if (!args.url) {
                throw new Error('url is required');
            }
            return await analyzeMeetingDocument(
                args.url,
                args.extract_sections || ['all'],
                args.max_items || 20
            );

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
                        name: 'gloucestershire-moderngov-mcp',
                        version: '2.0.0',
                        description: 'Gloucestershire Councils ModernGov API - Official Democratic Records',
                        councils: councilConfig.getCouncilNames(),
                        total_councils: councilConfig.getCouncilNames().length,
                        ...getDateContext(),
                        instructions: `IMPORTANT: This MCP server provides official statutory records of democratic decision-making for all Gloucestershire councils.

Available councils: ${councilConfig.getCouncilNames().join(', ')}

When using data from these tools:
1. SPECIFY COUNCIL: Most tools require a council_name parameter. Use list_committees without a council_name to see all available councils.
2. QUOTE VERBATIM: Committee recommendations, decisions, resolutions, and motions must be quoted exactly - never paraphrase
3. ALWAYS LINK SOURCES: Include source_url or web_page links from responses
4. SEPARATE INTERPRETATION: Clearly distinguish official record from your explanations
5. USE CORRECT DATES: Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Do not assume or guess meeting dates.

Response format: Official Record (blockquote) → Plain English Explanation → Source Link`
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

                // Wrap result with date context to prevent AI date drift
                const wrappedResult = {
                    ...getDateContext(),
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
