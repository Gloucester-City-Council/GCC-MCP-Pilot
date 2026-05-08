/**
 * Tool: planning_check_validation_requirements (Phase 2)
 *
 * Returns validation outcomes for the application.
 * No recommendation. Read-only.
 * Per plan Section 5. Authoritative even if data_compromised (plan Section 3.2).
 */

'use strict';

const { normalise }     = require('../pipeline/facts-normaliser');
const { detectScope }   = require('../pipeline/scope-engine');
const { runValidation } = require('../pipeline/validation-engine');
const { SCHEMA_VERSIONS } = require('../schema-loader');

/**
 * @param {object} args
 * @returns {object}
 */
function execute(args) {
    const { facts, mode = 'strict' } = args;

    if (!facts || typeof facts !== 'object') {
        return { error: 'A "facts" object is required.', schema_versions: SCHEMA_VERSIONS };
    }

    const { canonicalFacts, dataQualityIssues, dataQualityStatus, isLawfulUseRouteBlocked } =
        normalise(facts);

    const scope      = detectScope(canonicalFacts, { dataQualityStatus, isLawfulUseRouteBlocked });
    const validation = runValidation(canonicalFacts, scope, mode);

    // Group requirements by status for easier consumption
    const requirements = validation.requirements;
    const byStatus = {
        met:           requirements.filter(r => r.status === 'met'),
        missing:       requirements.filter(r => r.status === 'missing'),
        not_checked:   requirements.filter(r => r.status === 'not_checked'),
        cannot_assess: requirements.filter(r => r.status === 'cannot_assess'),
    };

    const summary = {
        total:         requirements.length,
        met:           byStatus.met.length,
        missing:       byStatus.missing.length,
        cannot_assess: byStatus.cannot_assess.length,
    };

    return {
        validation_status: validation.validationStatus,
        mode_applied: mode,
        summary,
        // Schema-aligned key name so this matches result.validation.requirement_outcomes.
        requirement_outcomes: requirements,
        blocking_issues: validation.blockingIssues,
        data_quality: {
            status: dataQualityStatus,
            issues: dataQualityIssues.map(i => ({
                issue_code:  i.code,
                severity:    i.severity,
                description: i.message,
                ...(i.field ? { facts_affected: [i.field] } : {}),
            })),
        },
        schema_versions: SCHEMA_VERSIONS,
        note: 'Validation is authoritative regardless of data quality status (plan Section 3.2). It checks document submission, not site fact correctness.',
    };
}

module.exports = { execute };
