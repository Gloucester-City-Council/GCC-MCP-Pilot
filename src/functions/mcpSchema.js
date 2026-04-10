/**
 * MCP Schema HTTP Function - POST /mcp-schema
 * Implements MCP JSON-RPC protocol for Gloucester City Council's
 * Council Tax and Heritage Assets policy schemas.
 *
 * Council Tax schema: v2.4 four-document pack (facts, rules, taxonomy, results)
 * approved for 2026/27 financial year.
 */

const { app } = require('@azure/functions');

// Council Tax schema tools
const schemaGet = require('../tools/schemaGet');
const schemaSearch = require('../tools/schemaSearch');
const schemaTodos = require('../tools/schemaTodos');
const schemaEvaluate = require('../tools/schemaEvaluate');
const { getSchemaVersion, getSchemaHash, isSchemaLoaded, getFinancialYear } = require('../schema/loader');

// Heritage Assets schema tools
const heritageGet = require('../tools/heritageGet');
const heritageSearch = require('../tools/heritageSearch');
const heritageLoader = require('../heritage/loader');

/**
 * MCP Tool definitions with JSON Schema
 * Customer-focused, authoritative, accountable and accurate.
 */
const TOOLS = [
    {
        name: 'schema_get',
        description: `Retrieve council tax information by path. Use this to look up specific details about your council tax — discounts you may be entitled to, how your bill is calculated, what exemptions exist, payment options, and more.

Paths you can use:
- /discounts — All discounts (single person, students, carers, care leavers, disabled band reduction)
- /discounts/items/0 — A specific discount by index
- /exemptions — All exemption classes (A through W)
- /property_premiums — Empty homes and second homes premiums
- /charge_outputs — 2026/27 council tax amounts by band (council-approved rates)
- /charge_outputs/band_totals — What you pay per band, broken down by precepting authority
- /council_tax_support — Means-tested help with your bill
- /payment — How to pay, instalments, direct debit
- /enforcement — What happens if you don't pay (escalation stages, your rights, debt support)
- /appeals_and_challenges — How to challenge your bill or valuation band
- /liability — Who is liable to pay
- /valuation_and_charging — How your band is determined
- /service_overview — What council tax pays for
- /legal_framework — The law behind council tax
- /executable_rules — Machine-readable rules for eligibility checks
- /taxonomy — Controlled vocabulary and definitions
- /evidence_requirements — What evidence you need for applications

All information is from Gloucester City Council's approved 2026/27 service definition, checked against live public sources.`,
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'JSON Pointer path (e.g., "/discounts", "/charge_outputs/band_totals"). Must start with /'
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
        description: `Search council tax information for answers to your question. Enter what you want to know in plain language — the system searches across all council tax policy, rules, rates, discounts, exemptions, enforcement and more.

Example searches:
- "single person discount" — Find out about the 25% discount for sole occupants
- "care leaver" — Discount for young people leaving local authority care
- "empty property premium" — What happens if your home is left empty
- "how to pay" — Payment methods and instalment options
- "appeal my band" — How to challenge your valuation band
- "bailiff" — Enforcement powers and your rights
- "student exemption" — Full exemption for student-only households

Results are ranked by relevance and include the exact path to the source data, so you can verify the information.

Covers the full 2026/27 approved service definition including 16 discount types, 21 exemption classes, premiums, enforcement stages, and 20 executable rules.`,
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'What you want to find out about (plain language query)'
                },
                scope: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Limit search to specific sections (e.g., ["discounts", "exemptions"]). Leave empty to search everything.'
                },
                topK: {
                    type: 'integer',
                    description: 'Number of results to return (default: 5, max: 50)'
                },
                filters: {
                    type: 'object',
                    description: 'Filter by metadata (e.g., {"section": "discounts"}, {"tag": "eligibility"})'
                }
            },
            required: ['text']
        }
    },
    {
        name: 'schema_todos',
        description: `List items in the council tax service definition that still need confirmation or sign-off before publication.

Returns issues categorised by severity:
- blocking: Must be resolved before any public use (e.g., DPO sign-off)
- needs-confirmation: Operational details awaiting internal verification (e.g., processing times, specific URLs)
- nice-to-have: Minor improvements

This supports accountability — every gap is tracked and visible. The council tax schema is version-controlled and content-checked against live Gloucester City Council and GOV.UK pages.`,
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
        description: `Check what council tax discounts, exemptions or reductions you might be eligible for based on your circumstances.

Tell us about your household and we'll tell you what may apply:

Household facts you can provide:
- adults: Number of adults living at the property
- students: Number of full-time students
- carers: Number of live-in carers providing at least 35 hours/week care
- severely_mentally_impaired: Number of people with SMI certification
- disabled_resident: true/false — does a disabled person live at the property?
- has_disabled_adaptations: true/false — wheelchair room, extra bathroom, etc.
- care_leaver: true/false — person who was in local authority care
- age: Person's age (relevant for care leaver eligibility, 18-24)
- apprentice: true/false — on an approved apprenticeship scheme
- property_empty: true/false
- property_empty_years: How long the property has been empty

Results show each potential discount/exemption with:
- likelihood: likely, unclear, or unlikely
- reasons: Why we think it applies or doesn't
- what to do next: Evidence needed and how to apply
- source: The specific rule or legislation

This is guidance only. Your actual eligibility depends on a full assessment by Gloucester City Council's Revenues team. Uses 20 executable rules from the approved 2026/27 service definition.`,
        inputSchema: {
            type: 'object',
            properties: {
                rulesetId: {
                    type: 'string',
                    description: 'Which check to run. "discount_eligibility" covers all discounts, exemptions and reductions.',
                    enum: ['discount_eligibility']
                },
                userFacts: {
                    type: 'object',
                    description: 'Your household circumstances (adults, students, carers, etc.)'
                }
            },
            required: ['rulesetId', 'userFacts']
        }
    },
    // Heritage Assets schema tools
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
    // Council Tax tools
    'schema_get': schemaGet.execute,
    'schema_search': schemaSearch.execute,
    'schema_todos': schemaTodos.execute,
    'schema_evaluate': schemaEvaluate.execute,
    // Heritage Assets tools
    'heritage_get': heritageGet.execute,
    'heritage_search': heritageSearch.execute
};
const AVAILABLE_TOOL_NAMES = Object.keys(TOOL_HANDLERS).join(', ');

/**
 * Get current date context
 */
const UK_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB');

function getDateContext() {
    const now = new Date();
    return {
        current_date: now.toISOString().split('T')[0],
        current_date_uk: UK_DATE_FORMATTER.format(now),
        timestamp: now.toISOString()
    };
}

/**
 * Handle MCP JSON-RPC requests
 */
async function handleMcpRequest(request, context) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return {
            jsonrpc: '2.0',
            error: {
                code: -32600,
                message: 'Invalid Request: body must be a JSON object'
            },
            id: null
        };
    }

    const { jsonrpc, method, params, id } = request;
    const requestId = Object.prototype.hasOwnProperty.call(request, 'id') && id !== undefined ? id : null;

    // Validate JSON-RPC version
    if (jsonrpc !== '2.0') {
        return {
            jsonrpc: '2.0',
            error: {
                code: -32600,
                message: 'Invalid Request: jsonrpc must be "2.0"'
            },
            id: requestId
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
                        name: 'gcc-policy-schema-mcp',
                        version: '2.0.0',
                        description: 'Gloucester City Council Policy Schemas — Council Tax (2026/27) and Heritage Assets',
                        schemas: {
                            councilTax: {
                                version: getSchemaVersion(),
                                hash: getSchemaHash(),
                                loaded: isSchemaLoaded(),
                                financialYear: getFinancialYear(),
                                documentPack: 'v2.4 (facts, rules, taxonomy, results)',
                                status: 'council-approved'
                            },
                            heritage: {
                                version: heritageLoader.getSchemaVersion(),
                                hash: heritageLoader.getSchemaHash(),
                                loaded: heritageLoader.isSchemaLoaded()
                            }
                        },
                        ...getDateContext(),
                        instructions: `GLOUCESTER CITY COUNCIL — COUNCIL TAX & HERITAGE POLICY SERVER

You are providing information from Gloucester City Council's official, council-approved policy schemas. Your role is to help residents, staff and advisers get accurate, clear answers about council tax and heritage matters.

PRINCIPLES — apply these to every response:

1. CUSTOMER FOCUSED: Write for the person asking. Use "you" and "your". Anticipate follow-up questions. If someone asks about a discount, also mention how to apply, what evidence they need, and where to go for help. Never make the customer do unnecessary work.

2. AUTHORITATIVE: This data comes from Gloucester City Council's approved 2026/27 service definition (schema v${getSchemaVersion() || '2.4.0'}), checked against live council web pages and GOV.UK as of April 2026. Cite the source — legislation references, council policy documents, or specific schema paths. When stating rates or amounts, these are the council-approved figures.

3. ACCOUNTABLE: Be transparent about what is confirmed and what is still under review. The schema tracks open issues and publication status per section. If a section is blocked (service_standards, data_privacy, channels), say so. Never present unconfirmed operational detail as fact. Use schema_todos to check for gaps.

4. ACCURATE: Use the exact figures, rules, and eligibility criteria from the schema. Do not round, approximate, or generalise. Council tax is a statutory service — precision matters. The 2026/27 Band D total is £2,238.77. There are 16 discount types, 21 exemption classes, and 2 premium categories. 20 executable rules are available for eligibility assessment.

COUNCIL TAX SCHEMA (2026/27)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Four-document pack: facts, rules, taxonomy, results
Financial year: ${getFinancialYear() || '2026/27'}
Content checked: April 2026 against live Gloucester and GOV.UK pages
Approved by: Full Council (rates), Cabinet (care leavers scheme)

Tools:
- schema_get(path) — Look up specific council tax information
- schema_search(text) — Search across all council tax content
- schema_todos(scope) — See what needs confirmation before publication
- schema_evaluate(rulesetId, userFacts) — Check discount/exemption eligibility

Key paths:
  /discounts — 16 discounts (single person 25%, care leavers 100%, SMI, students, carers, disabled band reduction, annexe, job-related)
  /exemptions — 21 statutory exemption classes (B through W)
  /property_premiums — Empty homes premium (100-300%) and second homes premium (100%)
  /charge_outputs/band_totals — 2026/27 rates by band
  /enforcement — Escalation stages, your rights, debt support
  /council_tax_support — Means-tested help with your bill
  /executable_rules — 20 machine-readable rules for eligibility decisions
  /evidence_requirements — What you need to provide for applications

HERITAGE ASSETS SCHEMA
━━━━━━━━━━━━━━━━━━━━━━
Tools:
- heritage_get(path) — Retrieve heritage policy sections
- heritage_search(text) — Search heritage content

Key paths: /legislativeFramework, /heritageAssetTypes, /serviceProcesses, /userJourneys, /keyDefinitions

RESPONSE GUIDELINES:
- Always state the financial year when quoting rates or amounts
- Include "how to apply" and evidence requirements when discussing discounts/exemptions
- Link to the source: legislation reference, council policy, or schema path
- If eligibility is unclear, say what additional information would help determine it
- Flag any section that is not yet confirmed for publication
- Advisory notice: "This is guidance based on Gloucester City Council's approved 2026/27 council tax policy. Your actual entitlement depends on your individual circumstances and a formal assessment by the council's Revenues team."`
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

        case 'tools/call': {
            const { name, arguments: args } = params || {};
            const toolStart = Date.now();

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
                        message: `Unknown tool: ${name}. Available: ${AVAILABLE_TOOL_NAMES}`
                    },
                    id
                };
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
                context.log.error(`Schema tool error [${name}]: ${error.message}`);
                if (error && error.stack) {
                    context.log.error(`Schema tool error stack [${name}]: ${error.stack}`);
                }
                context.log.error(`Schema tool failed [${name}] after ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error: error.message,
                                    tool: name,
                                    note: 'An unexpected error occurred executing the schema tool.'
                                }, null, 2)
                            }
                        ],
                        isError: true
                    },
                    id
                };
            }
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
        const requestStart = Date.now();
        context.log('MCP Schema request received');

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.error('Failed to parse request body:', parseError);
                if (parseError && parseError.stack) {
                    context.log.error('MCP Schema parse error stack:', parseError.stack);
                }
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
                context.log(`MCP Schema request completed with 204 in ${Date.now() - requestStart}ms`);
                return {
                    status: 204
                };
            }

            context.log(`MCP Schema request completed with 200 in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response)
            };
        } catch (error) {
            context.log.error('MCP Schema error:', error);
            if (error && error.stack) {
                context.log.error('MCP Schema unhandled error stack:', error.stack);
            }

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
