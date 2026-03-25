/**
 * GCC Planning MCP Module
 *
 * Exports TOOLS (MCP tool definitions), TOOL_HANDLERS (execute functions),
 * and SERVER_INFO for use by the mcpPlanning Azure Function.
 *
 * Implements 8 tools across 4 phases (plan Section 5 and Section 14):
 *   Phase 1: validate_application_facts, detect_case_route
 *   Phase 2: list_applicable_modules, check_validation_requirements, explain_rule
 *   Phase 3: assess_planning_merits, build_assessment_result
 *   Phase 4: build_report_payload
 *
 * All tool logic is derived from:
 *   - gloucester-householder-application-facts.v2.2.schema.json
 *   - gloucester-householder-assessment-result.v2.2.schema.json
 *   - gloucester-householder-policy-ruleset.v4.3.json
 *   - gloucester-planning-enums.v1.schema.json
 */

'use strict';

const { SCHEMA_VERSIONS } = require('./schema-loader');

const validateFacts         = require('./tools/validate-application-facts');
const detectRoute           = require('./tools/detect-case-route');
const listModules           = require('./tools/list-applicable-modules');
const checkValidation       = require('./tools/check-validation-requirements');
const explainRule           = require('./tools/explain-rule');
const assessMeritsTool      = require('./tools/assess-planning-merits');
const buildAssessmentResult = require('./tools/build-assessment-result');
const buildReportPayload    = require('./tools/build-report-payload');

// ─── Tool annotations (all tools are read-only) ───────────────────────────────
const READ_ONLY_ANNOTATIONS = {
    readOnlyHint:    true,
    destructiveHint: false,
    openWorldHint:   false,
    idempotentHint:  true,
};

// ─── Shared: mode parameter ───────────────────────────────────────────────────
const MODE_PARAM = {
    mode: {
        type: 'string',
        enum: ['strict', 'advisory', 'pre_application'],
        description: 'Processing mode. "strict" (default): stops at blockers; validation invalid halts merits. "advisory": continues with caveats even through blockers. "pre_application": full pipeline with advisory caveats throughout.',
        default: 'strict',
    },
};

// ─── Shared: facts parameter ──────────────────────────────────────────────────
const FACTS_PARAM = {
    facts: {
        type: 'object',
        description: 'Canonical planning case facts object. Must have "application", "site", and "proposal" sections. Conforms to gloucester-householder-application-facts.v2.2.schema.json.',
    },
};

// ─── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [

    // ── Phase 1 ──────────────────────────────────────────────────────────────

    {
        name: 'planning_validate_application_facts',
        description: `Validate a planning case facts object against the Gloucester Householder Application Facts schema (v2.2).

Phase 1 tool — schema validation only. No planning recommendation is made.

Checks:
- Required top-level sections (application, site, proposal)
- Enum field values (application_route, flood_zone, dwelling_type)
- Data quality issues (address mismatch, lawful use uncertainty, missing required context)

Returns: valid flag, list of issues with severity (blocking/warning), data_quality_status.

Source schemas: gloucester-householder-application-facts.v2.2.schema.json, gloucester-planning-enums.v1.schema.json`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            required: ['facts'],
            properties: {
                ...FACTS_PARAM,
                ...MODE_PARAM,
            },
        },
    },

    {
        name: 'planning_detect_case_route',
        description: `Detect the application route and consent tracks for a Gloucester householder planning case.

Phase 1 tool — route detection only. No planning recommendation is made.

Returns:
- submitted_route: the route the applicant submitted (authoritative)
- route_authority: language per plan Section 3.3 ("the submitted route is [X]")
- confidence: high or low (low if lawful use is uncertain)
- consent_tracks: planning_permission, listed_building_consent, or prior_approval_larger_home_extension
- modules_normally_applied: list of assessment modules for this route

⚠️ The system is authoritative for the submitted route. It cannot always confirm the route is correct where lawful_use_as_single_dwelling_confirmed is "unknown" or "no".`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            required: ['facts'],
            properties: {
                ...FACTS_PARAM,
            },
        },
    },

    // ── Phase 2 ──────────────────────────────────────────────────────────────

    {
        name: 'planning_list_applicable_modules',
        description: `List the assessment modules considered, applied, and skipped for a Gloucester householder planning case.

Phase 2 tool — module scoping only. No planning recommendation is made.

Modules:
- national_validation: Statutory national requirements (DMPO 2015)
- local_validation_householder: Local validation requirements (GCC checklist)
- plans_validation: Existing and proposed plans check
- flood_risk_validation: Flood zone documents
- policy_A1_design_and_amenity: Planning merits (householder routes only)
- heritage_review: Conservation area / listed building assessment
- consultations: Statutory and discretionary consultee triggers
- cil: Community Infrastructure Levy screening
- prior_notification_larger_home_extension: Prior approval route module

Returns: modules_considered, modules_applied, modules_skipped (with skip reasons).`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            required: ['facts'],
            properties: {
                ...FACTS_PARAM,
            },
        },
    },

    {
        name: 'planning_check_validation_requirements',
        description: `Check validation requirements for a Gloucester householder planning application.

Phase 2 tool — validation outcomes only. No planning recommendation is made.
Authoritative even in data_compromised state (checks document submission, not site fact correctness).

Evaluates:
- National statutory requirements: application form (A1), ownership certificate (A2), fee (A3), BNG exemption note (A4), DAS (A7 — conditional), site location plan (A8)
- Local requirements: annexe statement (B8), biodiversity small sites statement (B11), historic impact statement (B28)
- Plans: existing and proposed elevations/floor plans
- Flood risk: FRA (B25) when site in Flood Zone 2 or 3

Returns: validation_status, per-requirement outcomes (met/missing/not_checked/cannot_assess), blocking_issues.`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            required: ['facts'],
            properties: {
                ...FACTS_PARAM,
                ...MODE_PARAM,
            },
        },
    },

    {
        name: 'planning_explain_rule',
        description: `Explain a Gloucester householder planning rule, validation requirement, or concept in plain English.

Phase 2 tool — read-only, no facts required.

Supports:
- Assessment rule IDs: A1.1.1, A1.2.1, A1.2.7, A1.7.2, A1.8.1, etc. (all 30 rules across A1.1–A1.8)
- Assessment test IDs: A1.1, A1.2, A1.3, A1.4, A1.5, A1.6, A1.7, A1.8
- Validation requirement IDs: A1, A2, A7, A8, B8, B11, B28, B25, PLANS-EXISTING, PLANS-PROPOSED
- Enum types: decision_mode, processing_state, planning_merits_status, module, evidence_source, etc.
- Concepts: "45-degree rule", "garden depth", "conservation area", "prior notification", "BNG", "material rule", "decision mode", "data_compromised"
- Keyword search: returns matching rules and requirements

Every explanation includes severity, legal_basis, threshold_status, and policy source.`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            required: ['topic'],
            properties: {
                topic: {
                    type: 'string',
                    minLength: 2,
                    description: 'The rule, requirement, enum type, or concept to explain. Examples: "A1.2.1", "B28", "45-degree rule", "decision_mode", "conservation area", "BNG", "A1.7".',
                },
            },
        },
    },

    // ── Phase 3 ──────────────────────────────────────────────────────────────

    {
        name: 'planning_assess_planning_merits',
        description: `Run Policy A1 planning merits assessment for a Gloucester householder application.

Phase 3 tool — merits outcomes only. No planning recommendation is made.
Use planning_build_assessment_result if you need a recommendation.

Evaluates all applicable rules across 8 assessment tests:
- A1.1: Design Subordination (5 rules — side extension setback, ridge height, etc.)
- A1.2: Neighbour Amenity Protection (7 rules — 45-degree, daylight, overshadowing, overlooking, garden depth, etc.) ⚠️ includes material rules
- A1.3: Materials and Design Quality (3 rules)
- A1.4: Street Scene and Character (3 rules)
- A1.5: Parking and Access (3 rules)
- A1.6: Environmental Considerations (3 rules)
- A1.7: Heritage Impact (3 rules) ⚠️ A1.7.2 is a material rule
- A1.8: Flood Risk and Drainage (3 rules) ⚠️ A1.8.1 is a material rule

Returns: merits_status (pass/concerns/fail/cannot_assess/not_run), rule_outcomes, missing_facts.
Advisory only in data_compromised state.`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            required: ['facts'],
            properties: {
                ...FACTS_PARAM,
                ...MODE_PARAM,
            },
        },
    },

    {
        name: 'planning_build_assessment_result',
        description: `Run the full Gloucester householder planning assessment pipeline and return the complete result.

Phases 1–3. SOLE recommendation authority — this is the only tool that computes decision_mode and confidence.

Pipeline steps:
1. Schema validation → processing_state: schema_invalid if invalid
2. Facts normalisation and data quality
3. Route/scope detection
4. Validation (authoritative in all states)
5. Policy merits (advisory if data_compromised)
6. Result assembly with decision_mode precedence (plan Section 3.4)
7. Diagnostics

Decision modes (in precedence order):
  invalid | insufficient_information | manual_officer_review |
  likely_support | balanced_judgement | likely_refusal |
  prior_approval_not_required | prior_approval_granted | prior_approval_refused

Returns: result (full assessment result conforming to result v2.2 schema) + diagnostics block.

Modes:
- strict: stops at blockers; validation invalid gates merits
- advisory: continues with caveats; all advisory outcomes clearly flagged
- pre_application: full pipeline with advisory caveats throughout`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            required: ['facts'],
            properties: {
                ...FACTS_PARAM,
                ...MODE_PARAM,
                schema_version: {
                    type: 'string',
                    description: 'Expected schema version (optional). A warning is returned if this differs from the loaded schema version.',
                },
                ruleset_version: {
                    type: 'string',
                    description: 'Expected ruleset version (optional). A warning is returned if this differs from the loaded ruleset version.',
                },
                submission_revision_id: {
                    type: 'string',
                    description: 'Submission revision identifier for result versioning (plan Section 13). Records which document set this assessment is based on.',
                },
                rerun_reason: {
                    type: 'string',
                    enum: ['revised_documents', 'corrected_facts', 'ruleset_update', 'officer_requested', 'schema_update'],
                    description: 'Reason for re-running an assessment (if this is a re-run). Used for audit trail.',
                },
            },
        },
    },

    // ── Phase 4 ──────────────────────────────────────────────────────────────

    {
        name: 'planning_build_report_payload',
        description: `Build a structured narrative payload from a completed Gloucester planning assessment result.

Phase 4 tool. Takes the output of planning_build_assessment_result and produces a client-agnostic payload for AI-rendered reports.

Report styles:
- officer_determination: Formal delegated officer report (all sections, rule citations)
- preapp_advice: Pre-application advice letter (constructive, forward-looking)
- validation_request: Invalid application letter (validation section only, no merits)
- officer_note: Internal officer note (merits focus, manual review items)
- committee_summary: Committee report summary (concise, bullet points)

Payload includes:
- system_instruction: Constant grounding instruction for the AI client
- style_template: Report sections and language register for the chosen style
- assessment_data: Grounded in the result object (no AI inference)
- formatting_rules: Style-specific formatting guidance
- grounding_rules: 8 grounding rules (plan Section 8.3) including advisory anti-patterns

⚠️ The AI client must not alter decision_mode, confidence, or any outcome field.`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            required: ['result'],
            properties: {
                result: {
                    type: 'object',
                    description: 'Complete assessment result object from planning_build_assessment_result.',
                },
                report_style: {
                    type: 'string',
                    enum: ['officer_determination', 'preapp_advice', 'validation_request', 'officer_note', 'committee_summary'],
                    description: 'Report style (plan Section 8.1). Default: officer_determination.',
                    default: 'officer_determination',
                },
                overrides: {
                    type: 'object',
                    description: 'Optional overrides: { include_rule_citations: boolean, language_register: string }.',
                    properties: {
                        include_rule_citations: { type: 'boolean' },
                        language_register: { type: 'string' },
                    },
                },
            },
        },
    },
];

// ─── Tool handler map ─────────────────────────────────────────────────────────
const TOOL_HANDLERS = {
    planning_validate_application_facts: validateFacts.execute,
    planning_detect_case_route:          detectRoute.execute,
    planning_list_applicable_modules:    listModules.execute,
    planning_check_validation_requirements: checkValidation.execute,
    planning_explain_rule:               explainRule.execute,
    planning_assess_planning_merits:     assessMeritsTool.execute,
    planning_build_assessment_result:    buildAssessmentResult.execute,
    planning_build_report_payload:       buildReportPayload.execute,
};

// ─── Server info ──────────────────────────────────────────────────────────────
const SERVER_INFO = {
    name:        'gcc-planning-mcp',
    version:     '1.0.0',
    description: 'Gloucester City Council Planning Assist MCP — householder planning assessment pipeline. Implements the Gloucester Householder Planning schemas (facts v2.2, result v2.2, ruleset v4.3) per Implementation Plan v1.5.1.',
    schemaVersions: SCHEMA_VERSIONS,
    planVersion: '1.5.1',
    readOnly: true,
};

module.exports = { TOOLS, TOOL_HANDLERS, SERVER_INFO };
