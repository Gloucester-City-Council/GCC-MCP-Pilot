/**
 * Tool: planning_list_applicable_modules (Phase 2)
 *
 * Returns the modules considered, applied, and skipped for this case.
 * No recommendation. Read-only.
 * Per plan Section 5.
 */

'use strict';

const { normalise }   = require('../pipeline/facts-normaliser');
const { detectScope } = require('../pipeline/scope-engine');
const { SCHEMA_VERSIONS, APPLICABILITY_FRAMEWORK } = require('../schema-loader');

/**
 * @param {object} args
 * @returns {object}
 */
function execute(args) {
    const { facts } = args;

    if (!facts || typeof facts !== 'object') {
        return { error: 'A "facts" object is required.', schema_versions: SCHEMA_VERSIONS };
    }

    const { canonicalFacts, dataQualityStatus, isLawfulUseRouteBlocked } = normalise(facts);
    const scope = detectScope(canonicalFacts, { dataQualityStatus, isLawfulUseRouteBlocked });

    // Enrich each module with its purpose from the applicability framework
    const modulePurposes = (APPLICABILITY_FRAMEWORK && APPLICABILITY_FRAMEWORK.module_purposes) || {};

    const modulesConsidered = scope.modulesConsidered.map(m => ({
        module: m,
        purpose: modulePurposes[m] || null,
        applied: scope.modulesApplied.includes(m),
    }));

    return {
        route: scope.route,
        modules_considered: modulesConsidered,
        modules_applied: scope.modulesApplied,
        modules_skipped: scope.modulesSkipped,
        consent_tracks: scope.consentTracks,
        schema_versions: SCHEMA_VERSIONS,
        note: 'modules_applied is the subset of modules_considered that will actually run. modules_skipped lists each skipped module with the skip reason.',
    };
}

module.exports = { execute };
