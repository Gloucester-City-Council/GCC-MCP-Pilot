/**
 * Tool: planning_assess_planning_merits (Phase 3)
 *
 * Runs Policy A1 assessment rules against the provided facts.
 * Returns rule outcomes and merits status. No recommendation.
 * Per plan Section 5.
 *
 * Advisory only if data_compromised (plan Section 3.2).
 */

'use strict';

const { normalise }   = require('../pipeline/facts-normaliser');
const { detectScope } = require('../pipeline/scope-engine');
const { assessMerits } = require('../pipeline/policy-engine');
const { SCHEMA_VERSIONS } = require('../schema-loader');

/**
 * @param {object} args  { facts, mode }
 * @returns {object}
 */
function execute(args) {
    const { facts, mode = 'strict' } = args;

    if (!facts || typeof facts !== 'object') {
        return { error: 'A "facts" object is required.', schema_versions: SCHEMA_VERSIONS };
    }

    const { canonicalFacts, dataQualityIssues, dataQualityStatus, isLawfulUseRouteBlocked } =
        normalise(facts);

    const scope  = detectScope(canonicalFacts, { dataQualityStatus, isLawfulUseRouteBlocked });
    const merits = assessMerits(canonicalFacts, scope, { dataQualityStatus, isLawfulUseRouteBlocked }, mode);

    // Group outcomes by status for clarity
    const byStatus = {
        pass:                 merits.ruleOutcomes.filter(r => r.status === 'pass'),
        concern:              merits.ruleOutcomes.filter(r => r.status === 'concern'),
        fail:                 merits.ruleOutcomes.filter(r => r.status === 'fail'),
        cannot_assess:        merits.ruleOutcomes.filter(r => r.status === 'cannot_assess'),
        not_applicable:       merits.ruleOutcomes.filter(r => r.status === 'not_applicable'),
        manual_review_required: merits.ruleOutcomes.filter(r => r.status === 'manual_review_required'),
    };

    const summary = {
        total_rules_evaluated: merits.ruleOutcomes.filter(r => r.status !== 'not_applicable').length,
        pass:   byStatus.pass.length,
        concern: byStatus.concern.length,
        fail:   byStatus.fail.length,
        cannot_assess: byStatus.cannot_assess.length,
        manual_review: byStatus.manual_review_required.length,
    };

    // Identify missing facts across cannot_assess rules
    const missingFacts = [...new Set(
        merits.ruleOutcomes
            .filter(r => r.status === 'cannot_assess')
            .flatMap(r => r.facts_missing || [])
    )];

    return {
        merits_status: merits.meritsStatus,
        advisory_only: merits.isAdvisory,
        ...(merits.isAdvisory ? {
            advisory_caveat: 'Planning merits assessment is advisory only. Data quality issues were detected (data_compromised state). Every rule outcome carries a caveat.',
        } : {}),
        mode_applied: mode,
        summary,
        rule_outcomes: merits.ruleOutcomes,
        manual_review_flags: merits.manualReviewFlags,
        missing_facts: missingFacts,
        data_quality: {
            status: dataQualityStatus,
            issues: dataQualityIssues.map(i => ({ code: i.code, message: i.message, severity: i.severity })),
        },
        schema_versions: SCHEMA_VERSIONS,
        note: 'This tool returns policy merits only. No recommendation is computed here. Use build_assessment_result for the full pipeline with a recommendation.',
    };
}

module.exports = { execute };
