/**
 * MCP Schema V2 HTTP Function - POST /mcp-schema-v2
 * Implements MCP JSON-RPC protocol for Gloucester City Council's
 * Council Tax policy — revised five-document schema pack.
 *
 * Schema: ct_facts / ct_rules / ct_vocabulary / ct_channel_overlay / ct_chatbot_overlay
 * Financial year: 2026/27
 */

const { app } = require('@azure/functions');

const ctGet = require('../tools/ctGet');
const ctSearch = require('../tools/ctSearch');
const ctTodos = require('../tools/ctTodos');
const ctEvaluate = require('../tools/ctEvaluate');
const { getSchemaVersion, getSchemaHash, isSchemaLoaded, getFinancialYear } = require('../schema/revisedLoader');

const TOOLS = [
    {
        name: 'ct_get',
        description: `Retrieve council tax information from the revised schema by JSON Pointer path.

Key paths:
- /discounts             — flat array of all discount types
- /exemptions            — flat array of all exemption classes
- /premiums              — empty_homes and second_homes premium objects
- /council_tax_support   — Council Tax Support scheme details
- /liability             — liability hierarchy rules
- /enforcement           — recovery stages and powers
- /appeals               — grounds and process for challenges
- /valuation             — band definitions and 2026/27 charge rates
- /calculation_sequence  — ordered rule stages
- /conflict_resolution   — precedence rules
- /human_review_gates    — publication blockers and sign-off requirements
- /executable_rules      — machine-readable rule array
- /vocabulary            — controlled vocabulary (mechanisms, statuses, etc.)
- /channel_overlay       — application URLs and contact details by discount/exemption ID
- /chatbot_overlay       — AI interpreter framing, intake trees, topic guides`,
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
        name: 'ct_search',
        description: 'Search the revised council tax schema using plain language.',
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
        name: 'ct_todos',
        description: 'List publication blockers and assurance gaps from the revised schema.',
        inputSchema: {
            type: 'object',
            properties: {
                scope: { type: 'array', items: { type: 'string' } }
            },
            required: []
        }
    },
    {
        name: 'ct_evaluate',
        description: `Run council tax eligibility resolution for discounts, exemptions and premiums using the revised schema.

Use this tool when a user asks about council tax discounts, exemptions, eligibility or what they owe.

Collect as many of these userFacts as you know before calling (ask the user if unclear):
- adults (integer): number of adults aged 18+ living at the property
- students (integer): how many of those adults are full-time students
- carers (integer): how many are live-in carers for someone who is not their spouse/partner/child under 18
- severely_mentally_impaired (integer): how many hold a medical certificate for severe mental impairment
- apprentice (boolean): is any adult an apprentice on a government scheme earning below NLW?
- care_leaver (boolean): is the user a care leaver?
- age (integer): the user's age (required when care_leaver is true — discount covers ages 18-24)
- has_disabled_adaptations (boolean): does the property have qualifying disabled adaptations?
- disabled_resident (boolean): does a disabled person live there as their main home?
- property_empty (boolean): is the property unoccupied and substantially unfurnished?
- property_empty_years (number): how many years has it been empty?
- second_home (boolean): is it a furnished second home?
- receiving_pension_credit (boolean): is the user receiving Pension Credit Guarantee?
- on_qualifying_benefit (boolean): is the user receiving UC, JSA, ESA, Income Support or Housing Benefit?
- savings (number): total savings in pounds (CTS unavailable if over £16,000, unless on Pension Credit)

Returns: best_outcome, alternative options, council_tax_support_options, derived household facts, missing_critical_facts, confidence score and trace metadata.

Always surface council_tax_support_options to the user alongside the statutory best_outcome.`,
        inputSchema: {
            type: 'object',
            properties: {
                rulesetId: {
                    type: 'string',
                    enum: ['discount_eligibility'],
                    description: 'Use "discount_eligibility" to evaluate discounts, exemptions and premiums'
                },
                userFacts: {
                    type: 'object',
                    description: 'Household facts collected from the user'
                },
                projectionMode: {
                    type: 'string',
                    enum: ['runtime', 'trace', 'debug'],
                    description: 'Use "runtime" (default) for user-facing responses; "trace" for debugging'
                }
            },
            required: ['rulesetId', 'userFacts']
        }
    }
];

const TOOL_HANDLERS = {
    ct_get: ctGet.execute,
    ct_search: ctSearch.execute,
    ct_todos: ctTodos.execute,
    ct_evaluate: ctEvaluate.execute,
};
const TOOL_ALIASES = {
    '/ct_get': 'ct_get',
    '/ct_search': 'ct_search',
    '/ct_todos': 'ct_todos',
    '/ct_evaluate': 'ct_evaluate',
};
const AVAILABLE_TOOL_NAMES = Object.keys(TOOL_HANDLERS).join(', ');

const UK_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB');

function getDateContext() {
    const now = new Date();
    return {
        current_date: now.toISOString().split('T')[0],
        current_date_uk: UK_DATE_FORMATTER.format(now),
        timestamp: now.toISOString(),
    };
}

function resolveToolName(rawName) {
    if (!rawName) return null;
    if (TOOL_HANDLERS[rawName]) return rawName;
    return TOOL_ALIASES[rawName] || null;
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

    context.log(`Processing MCP Schema V2 method: ${method}`);

    switch (method) {
        case 'initialize':
            return {
                jsonrpc: '2.0',
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: {
                        name: 'gcc-council-tax-v2-mcp',
                        version: '1.0.0',
                        description: 'Gloucester City Council Council Tax Policy Schema — Revised Five-Document Pack',
                        schemas: {
                            councilTax: {
                                version: getSchemaVersion(),
                                hash: getSchemaHash(),
                                loaded: isSchemaLoaded(),
                                financialYear: getFinancialYear(),
                                documentPack: 'ct_facts / ct_rules / ct_vocabulary / ct_channel_overlay / ct_chatbot_overlay',
                                status: 'council-approved',
                            }
                        },
                        ...getDateContext(),
                        instructions: `GLOUCESTER CITY COUNCIL — COUNCIL TAX POLICY MCP SERVER V2 (2026/27)

## Purpose
You answer council tax questions for residents and property owners in Gloucester. This server holds the approved 2026/27 policy pack for Gloucester City Council only — do not apply it to other councils.

## Tools
- ct_evaluate  — eligibility resolver for discounts, exemptions and premiums (use this first for eligibility questions)
- ct_search    — plain-language search across the full policy pack (use for appeals, enforcement, payment, liability)
- ct_get       — retrieve a specific section by JSON Pointer path
- ct_todos     — list publication blockers and assurance gaps (for internal/governance use)

## How to handle common user questions

### "Am I eligible for a discount / reduction?"
1. Collect household facts: ask how many adults (18+) live at the property.
2. Ask follow-up questions: are any full-time students, live-in carers, severely mentally impaired, apprentices? Is the user a care leaver (if so, age)? Savings over £16,000?
3. Call ct_evaluate with rulesetId="discount_eligibility" and the facts gathered.
4. Present the best_outcome clearly: name, amount, likelihood, reasons, howToApply, evidence required.
5. If missing_critical_facts is non-empty, ask the user those questions and re-evaluate.
6. Always show alternatives (options.alternative_outcomes) so the user sees their full picture.
7. Always show options.council_tax_support_options — CTS is assessed alongside discounts.
8. Include the disclaimer from trace.note verbatim.

### "How do I pay / appeal / challenge my band?"
Use ct_search with the relevant query. Summarise the result for the user.

### "What is my council tax band / charge?"
Use ct_get path="/valuation" for approved 2026/27 band rates.

### "I can't afford to pay"
Use ct_search with "council tax support" or "hardship". Mention CTS and direct the user to apply via gloucester.gov.uk.

## Response guidelines
- Always state the confidence level (likely / unclear / unlikely) and what it depends on.
- Never give a definitive "yes you qualify" — the final decision rests with the Revenues team.
- If likelihood is "unclear", list the missing facts and ask the user for them.
- Quote howToApply and applyUrl so the user knows exactly what to do next.
- For premium outcomes (empty property, second home), make clear this increases the bill.

## Scope limitations
- Gloucester City Council properties only.
- Financial year 2026/27. Rates change each April.
- Council Tax Support requires a formal application — ct_evaluate does not assess CTS amounts.`
                    }
                },
                id,
            };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return {
                jsonrpc: '2.0',
                result: {
                    tools: TOOLS.map(tool => ({ ...tool, logicalId: tool.name })),
                    registry: {
                        version: 'ct-tools-v2',
                        stableIdentifiers: true,
                        note: 'Use tool.name/logicalId for calls.',
                    }
                },
                id,
            };

        case 'tools/call': {
            const { name, arguments: args } = params || {};
            const toolStart = Date.now();

            if (!name) {
                return { jsonrpc: '2.0', error: { code: -32602, message: 'Invalid params: tool name is required' }, id };
            }

            const resolvedName = resolveToolName(name);
            const handler = resolvedName ? TOOL_HANDLERS[resolvedName] : null;
            if (!handler) {
                return {
                    jsonrpc: '2.0',
                    error: {
                        code: -32602,
                        message: `Unknown tool: ${name}. Available: ${AVAILABLE_TOOL_NAMES}`,
                        data: {
                            code: 'TOOL_REDISCOVER_REQUIRED',
                            reason: 'tool re-registered or stale tool reference',
                            action: 'Call tools/list and rebind to logicalId/name',
                            registryVersion: 'ct-tools-v2',
                        }
                    },
                    id,
                };
            }

            try {
                context.log(`Executing CT v2 tool: ${resolvedName}`);
                const result = await Promise.resolve(handler(args || {}));
                context.log(`CT v2 tool completed [${resolvedName}] in ${Date.now() - toolStart}ms`);

                const wrappedResult = {
                    ...getDateContext(),
                    schemaVersion: getSchemaVersion(),
                    financialYear: getFinancialYear(),
                    data: result,
                };

                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(wrappedResult, null, 2) }]
                    },
                    id,
                };
            } catch (error) {
                context.log.error(`CT v2 tool error [${name}]: ${error.message}`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({ error: error.message, tool: name, note: 'An unexpected error occurred executing the tool.' }, null, 2)
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
            return { jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id };
    }
}

app.http('mcpSchemaV2', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp-schema-v2',
    handler: async (request, context) => {
        const requestStart = Date.now();
        context.log('MCP Schema V2 request received');

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
                context.log(`MCP Schema V2 request completed with 204 in ${Date.now() - requestStart}ms`);
                return { status: 204 };
            }

            context.log(`MCP Schema V2 request completed with 200 in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response)
            };
        } catch (error) {
            context.log.error('MCP Schema V2 handler error:', error.message);
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
