/**
 * Tool: planning_detect_case_route (Phase 1)
 *
 * Route and consent track detection. No recommendation.
 * Per plan Section 3.3: authoritative for the submitted route.
 * Cannot always confirm the route is correct (lawful use uncertainty).
 * Language: "the submitted route is [X]" — never "the application route is [X]".
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

    const { canonicalFacts, dataQualityIssues, dataQualityStatus, isLawfulUseRouteBlocked } =
        normalise(facts);

    const scope = detectScope(canonicalFacts, { dataQualityStatus, isLawfulUseRouteBlocked });

    // Route authority note (plan Section 3.3)
    const routeAuthorityNote = isLawfulUseRouteBlocked
        ? `The submitted route is "${scope.route}". The system cannot confirm this route is correct because lawful use as a single dwelling is unconfirmed. Route correctness is uncertain.`
        : `The submitted route is "${scope.route}".`;

    const confidence = isLawfulUseRouteBlocked ? 'low' : 'high';

    // Get route description from applicability framework
    const routeInfo = APPLICABILITY_FRAMEWORK &&
        APPLICABILITY_FRAMEWORK.application_routes &&
        APPLICABILITY_FRAMEWORK.application_routes[scope.route];

    return {
        submitted_route: scope.route,
        route_description: routeInfo ? routeInfo.description : null,
        route_authority: routeAuthorityNote,
        confidence,
        consent_tracks: scope.consentTracks,
        modules_normally_applied: routeInfo ? routeInfo.modules_normally_applied : scope.modulesConsidered,
        data_quality: {
            status: dataQualityStatus,
            lawful_use_route_blocked: isLawfulUseRouteBlocked,
            issues: dataQualityIssues.map(i => ({ code: i.code, message: i.message, severity: i.severity })),
        },
        schema_versions: SCHEMA_VERSIONS,
        note: 'Route detection is authoritative for the submitted route only. Use build_assessment_result for a full pipeline assessment including route correctness checks.',
    };
}

module.exports = { execute };
