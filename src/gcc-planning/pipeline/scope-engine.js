/**
 * ScopeEngine
 *
 * Determines the application route and the set of modules to consider,
 * apply, and skip. Per plan Section 3.3, the system is authoritative for
 * the submitted route — not always for whether that route is correct.
 *
 * Returns: { route, consentTracks, modulesConsidered, modulesApplied, modulesSkipped }
 */

'use strict';

const { APPLICABILITY_FRAMEWORK } = require('../schema-loader');

// All known modules in canonical order
const ALL_MODULES = [
    'national_validation',
    'local_validation_householder',
    'plans_validation',
    'flood_risk_validation',
    'policy_A1_design_and_amenity',
    'heritage_review',
    'consultations',
    'cil',
    'prior_notification_larger_home_extension',
];

/**
 * Determine which modules apply to this case.
 *
 * @param {object} facts        Canonical facts object
 * @param {object} dataQuality  { dataQualityStatus, isLawfulUseRouteBlocked }
 * @returns {{
 *   route: string,
 *   consentTracks: string[],
 *   modulesConsidered: string[],
 *   modulesApplied: string[],
 *   modulesSkipped: Array<{ module: string, reason: string }>
 * }}
 */
function detectScope(facts, dataQuality) {
    const app      = facts.application || {};
    const site     = facts.site        || {};
    const proposal = facts.proposal    || {};

    // ── Route ─────────────────────────────────────────────────────────────────
    const route = app.application_route || 'householder_planning_permission';

    // ── Consent tracks ────────────────────────────────────────────────────────
    let consentTracks = [];
    if (Array.isArray(app.consent_tracks) && app.consent_tracks.length) {
        consentTracks = app.consent_tracks;
    } else {
        // Infer from route
        if (route === 'householder_planning_permission') {
            consentTracks = ['planning_permission'];
        } else if (route === 'householder_planning_permission_and_listed_building_consent') {
            consentTracks = ['planning_permission', 'listed_building_consent'];
        } else if (route === 'pre_application_householder') {
            consentTracks = ['planning_permission'];
        } else if (route === 'prior_notification_larger_home_extension') {
            consentTracks = ['prior_approval_larger_home_extension'];
        }
    }

    // ── Modules considered (from applicability framework) ─────────────────────
    let modulesConsidered;
    const routeFramework = APPLICABILITY_FRAMEWORK &&
        APPLICABILITY_FRAMEWORK.application_routes &&
        APPLICABILITY_FRAMEWORK.application_routes[route];

    if (routeFramework && routeFramework.modules_normally_applied) {
        modulesConsidered = [...routeFramework.modules_normally_applied];
    } else {
        // Fallback defaults per route
        modulesConsidered = defaultModulesFor(route);
    }

    // ── Gating: decide which modules actually apply ────────────────────────────
    const modulesApplied = [];
    const modulesSkipped = [];

    const isPriorNotification = route === 'prior_notification_larger_home_extension';
    const inConservationArea  = site.conservation_area === true;
    const isListedBuilding    = site.listed_building === true ||
                                 consentTracks.includes('listed_building_consent');
    const inFloodZone23       = site.flood_zone === '2' || site.flood_zone === '3a' || site.flood_zone === '3b';

    for (const mod of modulesConsidered) {
        const skip = shouldSkip(mod, {
            route,
            isPriorNotification,
            inConservationArea,
            isListedBuilding,
            inFloodZone23,
            dataQuality,
        });
        if (skip) {
            modulesSkipped.push({ module: mod, reason: skip });
        } else {
            modulesApplied.push(mod);
        }
    }

    // heritage_review: add if listed building or conservation area but not already included
    if ((inConservationArea || isListedBuilding) &&
        !modulesApplied.includes('heritage_review') &&
        !modulesConsidered.includes('heritage_review')) {
        modulesConsidered.push('heritage_review');
        const skip = shouldSkip('heritage_review', { route, isPriorNotification, inConservationArea, isListedBuilding, inFloodZone23, dataQuality });
        if (skip) {
            modulesSkipped.push({ module: 'heritage_review', reason: skip });
        } else {
            modulesApplied.push('heritage_review');
        }
    }

    return {
        route,
        consentTracks,
        modulesConsidered,
        modulesApplied,
        modulesSkipped,
    };
}

/**
 * Return a skip reason string if the module should be skipped, or null if it applies.
 */
function shouldSkip(mod, ctx) {
    const { route, isPriorNotification, inConservationArea, isListedBuilding, inFloodZone23 } = ctx;

    switch (mod) {
        case 'policy_A1_design_and_amenity':
            if (isPriorNotification) {
                return 'Policy A1 does not apply to prior notification route (separate assessment regime).';
            }
            return null;

        case 'prior_notification_larger_home_extension':
            if (!isPriorNotification) {
                return 'Prior notification module only applies to the prior_notification_larger_home_extension route.';
            }
            return null;

        case 'heritage_review':
            if (!inConservationArea && !isListedBuilding) {
                return 'Heritage review module not triggered: site is not in a conservation area and is not a listed building.';
            }
            return null;

        case 'flood_risk_validation':
            // Always considered but note if not in flood zone
            // Still run it — it will return not_applicable for flood zone 1 sites
            return null;

        default:
            return null;
    }
}

function defaultModulesFor(route) {
    if (route === 'prior_notification_larger_home_extension') {
        return [
            'national_validation',
            'plans_validation',
            'flood_risk_validation',
            'prior_notification_larger_home_extension',
            'consultations',
        ];
    }
    if (route === 'householder_planning_permission_and_listed_building_consent') {
        return [
            'national_validation',
            'local_validation_householder',
            'plans_validation',
            'flood_risk_validation',
            'policy_A1_design_and_amenity',
            'heritage_review',
            'consultations',
            'cil',
        ];
    }
    // householder_planning_permission and pre_application_householder
    return [
        'national_validation',
        'local_validation_householder',
        'plans_validation',
        'flood_risk_validation',
        'policy_A1_design_and_amenity',
        'consultations',
        'cil',
    ];
}

module.exports = { detectScope };
