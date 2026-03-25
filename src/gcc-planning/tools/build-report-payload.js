/**
 * Tool: planning_build_report_payload (Phase 4)
 *
 * Builds a structured narrative payload from a completed assessment result.
 * The payload is consumed by an AI client to render a grounded report.
 * Client-agnostic.
 *
 * Per plan Section 5:
 * "build_report_payload: Input: complete result object, report_style, optional overrides.
 *  Output: system_instruction, style_template, assessment_data, formatting_rules, grounding_rules."
 *
 * Per plan Section 8.3: grounding rules (8 rules) are embedded in the payload.
 * The AI client must not alter states or draw conclusions beyond what the result records.
 */

'use strict';

const { build }     = require('../pipeline/report-payload-builder');
const { SCHEMA_VERSIONS } = require('../schema-loader');

const VALID_STYLES = new Set([
    'officer_determination',
    'preapp_advice',
    'validation_request',
    'officer_note',
    'committee_summary',
]);

/**
 * @param {object} args  { result, report_style, overrides }
 * @returns {object}
 */
function execute(args) {
    const { result, report_style = 'officer_determination', overrides } = args;

    if (!result || typeof result !== 'object') {
        return {
            error: 'A "result" object is required. Pass the output of planning_build_assessment_result.',
            schema_versions: SCHEMA_VERSIONS,
        };
    }

    // Validate result has the required top-level sections
    const requiredSections = ['scope', 'data_quality', 'validation', 'planning_merits', 'recommendation'];
    const missingSections = requiredSections.filter(s => !result[s]);
    if (missingSections.length > 0) {
        return {
            error: `Result object is missing required sections: ${missingSections.join(', ')}. Pass the complete output of planning_build_assessment_result.`,
            schema_versions: SCHEMA_VERSIONS,
        };
    }

    if (!VALID_STYLES.has(report_style)) {
        return {
            error: `Invalid report_style "${report_style}". Expected: ${[...VALID_STYLES].join(', ')}.`,
            schema_versions: SCHEMA_VERSIONS,
        };
    }

    const payload = build(result, report_style, overrides || {});

    return {
        ...payload,
        schema_versions: SCHEMA_VERSIONS,
        usage_note: 'Pass this payload to an AI client to render a grounded report. The AI must apply grounding_rules exactly and must not alter decision_mode, confidence, or any outcome field.',
    };
}

module.exports = { execute };
