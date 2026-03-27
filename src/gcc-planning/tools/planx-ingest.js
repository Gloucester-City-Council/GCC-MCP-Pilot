/**
 * Tool: planning_ingest_planx_schema
 *
 * Ingests a PlanX digital planning application JSON and maps it to the
 * Gloucester Householder Application Facts structure, ready for use with
 * the GCC planning assessment tools.
 *
 * PlanX schemas: https://github.com/theopensystemslab/digital-planning-data-schemas
 * Input conforms to: application.json or preApplication.json
 * Output mapped_facts conforms to: gloucester-householder-application-facts.v2.2.schema.json
 *
 * Supported PlanX → GCC routes:
 *   pp.full.householder          → householder_planning_permission
 *   lbc                         → householder_planning_permission_and_listed_building_consent
 *   pa.part1.classA              → prior_notification_larger_home_extension
 *   preApp / preApp.householder  → pre_application_householder
 *
 * Non-householder application types (pp.full.major, enforcement, etc.) return
 * a not_supported response identifying the unsupported type rather than failing silently.
 *
 * The returned mapped_facts is directly usable as the "facts" parameter for:
 *   planning_validate_application_facts
 *   planning_detect_case_route
 *   planning_list_applicable_modules
 *   planning_check_validation_requirements
 *   planning_assess_planning_merits
 *   planning_build_assessment_result
 */

'use strict';

const { mapPlanxToGccFacts } = require('../planx-mapper');
const { SCHEMA_VERSIONS } = require('../schema-loader');

/**
 * Execute the planning_ingest_planx_schema tool.
 *
 * @param {object} args
 * @param {object} args.planx_application   - PlanX application JSON object
 * @param {boolean} [args.include_next_steps] - Include suggested next tool calls (default true)
 * @returns {object} Tool result
 */
function execute(args = {}) {
    const { planx_application, include_next_steps = true } = args;

    // ── Input validation ──────────────────────────────────────────────────────
    if (!planx_application || typeof planx_application !== 'object' || Array.isArray(planx_application)) {
        return {
            success: false,
            mapping_error: 'Missing or invalid "planx_application" parameter — must be a PlanX application JSON object.',
            not_supported: false,
            schema_versions: SCHEMA_VERSIONS,
        };
    }

    // ── Map ───────────────────────────────────────────────────────────────────
    const result = mapPlanxToGccFacts(planx_application);

    // ── Early return for unsupported application types ────────────────────────
    if (result.not_supported) {
        return {
            success: false,
            not_supported: true,
            planx_application_type: result.planx_application_type,
            mapping_error: result.mapping_error,
            note: 'This PlanX application type is not within scope of the GCC householder planning assessment pipeline. The pipeline handles householder planning permission, prior notification (Class A larger home extension), and pre-application advice only.',
            planx_schema_note: result.planx_schema_note,
            schema_versions: SCHEMA_VERSIONS,
        };
    }

    // ── Build next steps hint ─────────────────────────────────────────────────
    let next_steps = undefined;
    if (include_next_steps && result.mapped_facts) {
        next_steps = buildNextSteps(result);
    }

    // ── Compose response ──────────────────────────────────────────────────────
    const response = {
        success: true,
        not_supported: false,
        planx_application_type: result.planx_application_type,
        suggested_route: result.suggested_route,
        mapping_confidence: result.mapping_confidence,
        mapped_facts: result.mapped_facts,
        unmapped_fields: result.unmapped_fields,
        mapping_warnings: result.mapping_warnings,
        planx_schema_note: result.planx_schema_note,
        schema_versions: SCHEMA_VERSIONS,
    };

    if (result.mapping_error) {
        response.mapping_error = result.mapping_error;
    }

    if (next_steps) {
        response.next_steps = next_steps;
    }

    return response;
}

/**
 * Build suggested next-step tool calls based on the mapping result.
 * @param {object} result - mapPlanxToGccFacts result
 * @returns {object}
 */
function buildNextSteps(result) {
    const steps = [];

    if (result.mapping_confidence === 'low') {
        steps.push({
            step: 1,
            tool: 'planning_validate_application_facts',
            note: 'Validate mapped_facts — mapping confidence is low so expect validation issues. Review and correct facts before proceeding.',
            args_hint: { facts: '<use mapped_facts above>', mode: 'advisory' },
        });
    } else {
        steps.push({
            step: 1,
            tool: 'planning_validate_application_facts',
            note: 'Validate mapped_facts against the Gloucester householder facts schema to catch any missing or invalid fields.',
            args_hint: { facts: '<use mapped_facts above>' },
        });
        steps.push({
            step: 2,
            tool: 'planning_detect_case_route',
            note: 'Confirm the detected application route and consent tracks.',
            args_hint: { facts: '<use mapped_facts above>' },
        });
        steps.push({
            step: 3,
            tool: 'planning_build_assessment_result',
            note: 'Run the full planning assessment pipeline to get a recommendation.',
            args_hint: { facts: '<use mapped_facts above>', mode: 'strict' },
        });
    }

    return {
        summary: `Mapped from PlanX "${result.planx_application_type}" → GCC route "${result.suggested_route}". Pass mapped_facts to planning_validate_application_facts first.`,
        tools: steps,
    };
}

module.exports = { execute };
