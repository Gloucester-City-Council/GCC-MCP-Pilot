/**
 * Tool: planning_build_assessment_result (Phases 1–3)
 *
 * Full pipeline. SOLE recommendation authority.
 * Runs all pipeline steps and returns the complete result object + diagnostics.
 *
 * Per plan Section 5:
 * "build_assessment_result: Input: schema_version, ruleset_version, facts (raw or normalised),
 *  mode (strict|advisory|pre_application). Output: full result object + diagnostics.
 *  Modes: strict stops at blockers; advisory continues with caveats;
 *  pre_application runs full pipeline with advisory caveats."
 *
 * Per plan Section 3.4: decision_mode precedence table is implemented in ResultAssembler.
 * Per plan Section 15.2: confidence for likely_refusal is high if full_assessment, medium if partial.
 */

'use strict';

const { run }         = require('../pipeline/pipeline-orchestrator');
const { SCHEMA_VERSIONS, MATERIAL_RULES_REGISTER } = require('../schema-loader');

/**
 * @param {object} args
 * @returns {object}
 */
function execute(args) {
    const {
        facts,
        mode          = 'strict',
        schema_version,
        ruleset_version,
        submission_revision_id,
        rerun_reason,
    } = args;

    if (!facts || typeof facts !== 'object') {
        return {
            error: 'A "facts" object is required.',
            schema_versions: SCHEMA_VERSIONS,
        };
    }

    const validModes = new Set(['strict', 'advisory', 'pre_application']);
    if (!validModes.has(mode)) {
        return {
            error: `Invalid mode "${mode}". Expected: strict, advisory, or pre_application.`,
            schema_versions: SCHEMA_VERSIONS,
        };
    }

    // ── Run full pipeline ─────────────────────────────────────────────────────
    const { result, diagnostics, processingState } = run(facts, mode);

    // ── Augment result with submission/revision context ───────────────────────
    if (submission_revision_id) {
        result.submission_revision_id = submission_revision_id;
    }
    if (rerun_reason) {
        result.rerun_reason = rerun_reason;
    }
    result._schema_versions = SCHEMA_VERSIONS;

    // ── Version mismatch warnings ─────────────────────────────────────────────
    const versionWarnings = [];
    if (schema_version && schema_version !== SCHEMA_VERSIONS.facts) {
        versionWarnings.push(`Requested schema_version "${schema_version}" differs from loaded version "${SCHEMA_VERSIONS.facts}".`);
    }
    if (ruleset_version && ruleset_version !== SCHEMA_VERSIONS.ruleset) {
        versionWarnings.push(`Requested ruleset_version "${ruleset_version}" differs from loaded version "${SCHEMA_VERSIONS.ruleset}".`);
    }

    return {
        processing_state: processingState,
        result,
        diagnostics,
        ...(versionWarnings.length > 0 ? { version_warnings: versionWarnings } : {}),
        schema_versions: SCHEMA_VERSIONS,
    };
}

module.exports = { execute };
