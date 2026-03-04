/**
 * GCC Procurement MCP Module
 *
 * Exports TOOLS (MCP tool definitions), TOOL_HANDLERS (execute functions),
 * and SERVER_INFO for use by the mcpProcurement Azure Function.
 *
 * All five tools are read-only constitutional rules engines derived from
 * procurement-contracts-schema-v0.9.2.json. No external calls are made.
 */

'use strict';

const { SCHEMA_VERSION, SCHEMA_FILE } = require('./schema-loader');

const determineRoute = require('./tools/determine-route');
const checkSupplier  = require('./tools/check-supplier');
const validateCase   = require('./tools/validate-case');
const getNotices     = require('./tools/get-notices');
const explainRule    = require('./tools/explain-rule');

// ─── Tool annotations (applied to all tools) ─────────────────────────────────
const READ_ONLY_ANNOTATIONS = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
};

// ─── Response format parameter (shared across all tools) ─────────────────────
const RESPONSE_FORMAT_PARAM = {
    response_format: {
        type: 'string',
        enum: ['markdown', 'json'],
        description: 'Output format. "markdown" (default) returns formatted text with ✅ ⚠️ ❌ status. "json" returns the raw result object.',
        default: 'markdown',
    },
};

// ─── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'gcc_procurement_determine_route',
        description: `Determine the full procurement route and constitutional authority for a GCC contract.

Given a whole-life contract value (inc. VAT) and type, returns:
- Procurement tier (1–6) with award authority
- Key decision status (KD1–KD4 triggers)
- Forward Plan requirement (3E.11 check)
- PA2023 threshold status
- Required UK notices
- Deed and One Legal contract requirements
- Live compliance warnings (C3 if tier 4)
- Lex specialis delegation note (tier 5)

All rules sourced from GCC Constitution, Contract Rules, and PA2023.
Source: procurement-contracts-schema-v0.9.2.json`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                value_gbp: {
                    type: 'number',
                    description: 'Whole-life contract value inclusive of VAT (£). Must be > 0.',
                },
                contract_type: {
                    type: 'string',
                    enum: ['goods', 'services', 'works', 'light_touch', 'concession', 'mixed'],
                    description: 'Contract type. Use "light_touch" for social/health services, "concession" for concession contracts.',
                },
                service_area: {
                    type: 'string',
                    description: 'Optional service area or department (for context only, does not affect routing).',
                },
                has_ward_impact: {
                    type: 'boolean',
                    description: 'KD2 qualitative assessment: does this contract likely impact two or more wards?',
                },
                budget_significant: {
                    type: 'boolean',
                    description: 'KD1 qualitative assessment: is this expenditure significant relative to the service budget?',
                },
                ...RESPONSE_FORMAT_PARAM,
            },
            required: ['value_gbp', 'contract_type'],
        },
    },

    {
        name: 'gcc_procurement_check_supplier',
        description: `Return the supplier compliance checklist for a GCC contract.

Provides a schema-derived checklist of required supplier checks including:
- Financial standing check (CONTRACT-RULES Rule 15.5)
- Debarment register check (CONTRACT-RULES Rule 10.8)
- Exclusion grounds assessment (PA2023 Schedule 6)
- SME status identification
- Parent Company Guarantee (works > £1m, CONTRACT-RULES Rule 20.1)
- Beneficial ownership check (Subsidy Control Act 2022)

Note: Companies House live lookup is not yet implemented.
All rules sourced from procurement-contracts-schema-v0.9.2.json.`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                contract_value_gbp: {
                    type: 'number',
                    description: 'Contract value inclusive of VAT (£). Must be > 0.',
                },
                contract_type: {
                    type: 'string',
                    enum: ['goods', 'services', 'works', 'light_touch', 'concession', 'mixed'],
                    description: 'Contract type.',
                },
                company_name: {
                    type: 'string',
                    description: 'Optional supplier/company name for context.',
                },
                ...RESPONSE_FORMAT_PARAM,
            },
            required: ['contract_value_gbp', 'contract_type'],
        },
    },

    {
        name: 'gcc_procurement_validate_case',
        description: `Validate a GCC procurement case against constitutional rules.

Evaluates the case against risk flags from the schema and checks for missing required assessments. Returns:
- Overall status: PASS / WARNINGS / FAIL
- Triggered risk flags (R11 Forward Plan, R12 Cabinet Member, R13 Full Cabinet, R06 Direct Award, etc.)
- Missing required assessments (social value, TUPE, conflicts, lots, framework check)
- Recommended next actions in priority order

All rules sourced from procurement-contracts-schema-v0.9.2.json.`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                value_estimated_gbp: {
                    type: 'number',
                    description: 'Estimated whole-life contract value inclusive of VAT (£). Must be > 0.',
                },
                contract_type: {
                    type: 'string',
                    enum: ['goods', 'services', 'works', 'light_touch', 'concession', 'mixed'],
                    description: 'Contract type.',
                },
                procurement_route: {
                    type: 'string',
                    description: 'Procurement route (e.g. open_procedure, competitive_flexible, direct_award, framework_calloff, waiver).',
                },
                forward_plan_reference: {
                    type: 'string',
                    description: 'Forward Plan entry reference number, if obtained.',
                },
                cabinet_member_decision_reference: {
                    type: 'string',
                    description: 'Cabinet Member decision reference, if applicable (value > £250,000).',
                },
                cabinet_decision_reference: {
                    type: 'string',
                    description: 'Full Cabinet decision reference, if applicable (value > £500,000).',
                },
                tupe_assessed: {
                    type: 'boolean',
                    description: 'Has a TUPE assessment been completed?',
                },
                social_value_assessed: {
                    type: 'boolean',
                    description: 'Has a social value assessment been completed?',
                },
                conflicts_assessment_completed: {
                    type: 'boolean',
                    description: 'Has a conflicts of interest assessment been completed for all evaluation team members?',
                },
                lots_considered: {
                    type: 'boolean',
                    description: 'Has the suitability for division into lots been assessed and documented?',
                },
                existing_framework_checked: {
                    type: 'boolean',
                    description: 'Has the availability of existing frameworks been checked before launching new competition?',
                },
                direct_award_justification_reference: {
                    type: 'string',
                    description: 'Reference to documented direct award justification (required for direct_award route).',
                },
                waiver_reference: {
                    type: 'string',
                    description: 'Reference to waiver approval (required for waiver route).',
                },
                status: {
                    type: 'string',
                    description: 'Procurement lifecycle status (pipeline, in_procurement, tender_open, needs_definition, market_engagement, awarded, live, etc.).',
                },
                ...RESPONSE_FORMAT_PARAM,
            },
            required: ['value_estimated_gbp', 'contract_type'],
        },
    },

    {
        name: 'gcc_procurement_get_notices',
        description: `Return the required notice sequence for a GCC procurement.

Derives the ordered list of UK procurement notices required under PA2023 based on:
- Contract value and type (threshold determination)
- Procurement route (competitive vs direct award)
- Framework establishment flag

Returns each notice with: code, name, timing, mandatory status, publication platform, and legal basis.

Source: derived_fields.fields.required_notices.logic — procurement-contracts-schema-v0.9.2.json`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                value_gbp: {
                    type: 'number',
                    description: 'Contract value inclusive of VAT (£). Must be > 0.',
                },
                contract_type: {
                    type: 'string',
                    enum: ['goods', 'services', 'works', 'light_touch', 'concession', 'mixed'],
                    description: 'Contract type.',
                },
                procurement_route: {
                    type: 'string',
                    description: 'Procurement route (open_procedure, competitive_flexible, direct_award, framework_calloff, dynamic_market_calloff, waiver, etc.).',
                },
                is_framework_establishment: {
                    type: 'boolean',
                    description: 'Is this procurement establishing a new framework agreement? (adds optional UK3 Planned Procurement Notice)',
                    default: false,
                },
                ...RESPONSE_FORMAT_PARAM,
            },
            required: ['value_gbp', 'contract_type', 'procurement_route'],
        },
    },

    {
        name: 'gcc_procurement_explain_rule',
        description: `Explain a GCC constitutional procurement rule, threshold, or known conflict in plain English.

Supports queries about:
- Decision matrix tiers 1–6 (e.g. "tier 4", "tier 3")
- Key decision triggers KD1–KD4 (e.g. "KD3")
- Known constitutional conflicts C1–C4 (e.g. "conflict C3", "C4")
- Forward Plan obligation and 3E.11 officer restriction
- Deed requirements (ART13)
- Waiver approval authority
- Lex specialis (Cabinet Member authority above £250,000)
- Officer authority / scheme of sub-delegation
- PA2023 thresholds
- UK procurement notices UK1–UK17
- Risk flags R01–R13

Every explanation includes source doc_id citations.
Source: procurement-contracts-schema-v0.9.2.json`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    minLength: 2,
                    description: 'Topic to explain. Examples: "KD3", "conflict C3", "tier 4", "forward plan", "deed requirements", "lex specialis", "UK5", "R11", "waiver approval", "officer authority".',
                },
                ...RESPONSE_FORMAT_PARAM,
            },
            required: ['topic'],
        },
    },
];

// ─── Tool handler map ─────────────────────────────────────────────────────────
const TOOL_HANDLERS = {
    gcc_procurement_determine_route: determineRoute.execute,
    gcc_procurement_check_supplier:  checkSupplier.execute,
    gcc_procurement_validate_case:   validateCase.execute,
    gcc_procurement_get_notices:     getNotices.execute,
    gcc_procurement_explain_rule:    explainRule.execute,
};

// ─── Server info ──────────────────────────────────────────────────────────────
const SERVER_INFO = {
    name: 'gcc-procurement-mcp',
    version: '1.0.0',
    description: 'Gloucester City Council Procurement Rules Engine — constitutional authority matrix, risk flags, and notice obligations derived from procurement-contracts-schema-v0.9.2.json',
    schemaVersion: SCHEMA_VERSION,
    schemaFile: SCHEMA_FILE,
    readOnly: true,
};

module.exports = { TOOLS, TOOL_HANDLERS, SERVER_INFO };
