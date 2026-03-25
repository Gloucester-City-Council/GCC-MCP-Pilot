/**
 * ValidationEngine
 *
 * Runs validation modules against the canonical facts and returns
 * the set of validation requirements with their status.
 *
 * Per plan Section 3.2: validation is authoritative even in the
 * data_compromised state — it checks document submission, not site
 * fact correctness.
 *
 * Returns:
 *   { validationStatus, requirements, blockingIssues }
 */

'use strict';

const { VALIDATION_MODULES, RULESET } = require('../schema-loader');

/**
 * Run validation checks.
 *
 * @param {object} facts           Canonical facts
 * @param {object} scope           Output of scope-engine.detectScope()
 * @param {string} mode            strict|advisory|pre_application
 * @returns {{
 *   validationStatus: string,       // valid|invalid|incomplete|manual_review_required|not_run
 *   requirements: Array<object>,
 *   blockingIssues: Array<string>
 * }}
 */
function runValidation(facts, scope, mode) {
    const app      = facts.application || {};
    const site     = facts.site        || {};
    const proposal = facts.proposal    || {};

    const inCA           = site.conservation_area === true;
    const isListed       = site.listed_building === true ||
                           (scope.consentTracks || []).includes('listed_building_consent');
    const inFloodZone23  = site.flood_zone === '2' || site.flood_zone === '3a' || site.flood_zone === '3b';
    const proposalTypes  = Array.isArray(proposal.proposal_type) ? proposal.proposal_type : [];
    const isAnnexe       = proposalTypes.includes('annexe');
    const submittedDocs  = Array.isArray(app.submitted_documents) ? app.submitted_documents : [];
    const isPriorNotif   = scope.route === 'prior_notification_larger_home_extension';

    const requirements = [];
    const blockingIssues = [];

    // ── National validation ───────────────────────────────────────────────────
    if (scope.modulesApplied.includes('national_validation')) {
        const natReqs = VALIDATION_MODULES.national_requirements || {};

        // A1 — Application form
        requirements.push(checkDocPresence('A1', 'Completed Application Form',
            true, 'statutory', submittedDocs,
            ['application form', '1app', 'application_form'],
            'Application form must be completed (DMPO 2015 Art. 7).',
            natReqs.A1_completed_application_form));

        // A2 — Ownership certificate
        requirements.push(checkDocPresence('A2', 'Ownership Certificate and Agricultural Land Declaration',
            true, 'statutory', submittedDocs,
            ['ownership certificate', 'certificate a', 'certificate b', 'certificate c', 'certificate d', 'agricultural land'],
            'Ownership certificate required (DMPO 2015 Art. 13).',
            natReqs.A2_ownership_certificate));

        // A3 — Fee
        requirements.push(checkDocPresence('A3', 'Planning Application Fee',
            true, 'statutory', submittedDocs,
            ['planning fee', 'fee receipt', 'fee payment', 'application fee', 'payment'],
            'Fee required (DMPO 2015 Art. 11; Fees Regs 2023).',
            natReqs.A3_planning_application_fee));

        // A4 — BNG — householder exempt
        requirements.push({
            requirement_id: 'A4',
            name: 'Biodiversity Net Gain Strategy',
            status: 'not_checked',
            applicable: false,
            reason: 'Householder applications are exempt from mandatory BNG (TCPA 1990 Sch 7A). Do not treat as a required document.',
            legal_basis: 'statutory',
            effect_type: 'validation',
            source_status: 'adopted',
        });

        // A7 — D&A statement (conditional: CA or LBC)
        const a7Required = inCA || isListed;
        requirements.push({
            requirement_id: 'A7',
            name: 'Design and Access Statement',
            status: a7Required
                ? (docPresent(submittedDocs, ['design and access', 'DAS', 'd&a', 'design & access'])
                    ? 'met' : 'missing')
                : 'not_checked',
            applicable: a7Required,
            reason: a7Required
                ? (inCA ? 'Required: site is in a conservation area (DMPO 2015 Art. 9).' : 'Required: listed building consent in scope (Planning Regs 1990).')
                : 'Not required for standard householder applications outside conservation area or LBC scope.',
            legal_basis: 'statutory',
            effect_type: 'validation',
            source_status: 'adopted',
        });

        // A8 — Site location plan
        requirements.push(checkDocPresence('A8', 'Site Location Plan',
            true, 'statutory', submittedDocs,
            ['location plan', 'site location', 'OS plan', 'OS map', 'site plan'],
            'Site location plan required (DMPO 2015 Art. 7).',
            natReqs.A8_site_location_plan));
    }

    // ── Local validation ──────────────────────────────────────────────────────
    if (scope.modulesApplied.includes('local_validation_householder')) {
        const localReqs = VALIDATION_MODULES.local_requirements_householder || {};

        // B8 — Annexe statement (triggered by annexe proposal type)
        if (isAnnexe) {
            requirements.push({
                requirement_id: 'B8',
                name: 'Annexe Statement',
                status: docPresent(submittedDocs, ['annexe statement', 'annexe functional link'])
                    ? 'met' : 'missing',
                applicable: true,
                reason: 'Required for annexe proposals (GCP A10, JCS SD4). Must address 5 policy tests and include functional link table.',
                legal_basis: 'local_validation',
                effect_type: 'validation',
                source_status: 'live_checklist',
            });
        }

        // B11 — Biodiversity small sites statement (triggered for all householder)
        requirements.push({
            requirement_id: 'B11',
            name: 'Biodiversity Small Sites Statement',
            status: docPresent(submittedDocs, ['biodiversity', 'bio diversity', 'BNG statement', 'ecology'])
                ? 'met' : 'missing',
            applicable: true,
            reason: 'Local validation requirement for all householder applications (GCP A1, E1–E3). Not the statutory BNG regime.',
            legal_basis: 'local_validation',
            effect_type: 'validation',
            source_status: 'live_checklist',
        });

        // B28 — Historic impact statement (triggered by designated heritage)
        if (inCA || isListed) {
            requirements.push({
                requirement_id: 'B28',
                name: 'Historic Impact Statement',
                status: docPresent(submittedDocs, ['historic impact', 'heritage statement', 'heritage impact', 'historic impact'])
                    ? 'met' : 'missing',
                applicable: true,
                reason: 'Required when a listed building or conservation area is affected (NPPF; JCS SD8; GCP).',
                legal_basis: 'local_validation',
                effect_type: 'validation',
                source_status: 'live_checklist',
            });
        }
    }

    // ── Plans validation ──────────────────────────────────────────────────────
    if (scope.modulesApplied.includes('plans_validation')) {
        requirements.push({
            requirement_id: 'PLANS-EXISTING',
            name: 'Existing Elevations and Floor Plans',
            status: docPresent(submittedDocs, ['existing elevation', 'existing plan', 'existing floor', 'as existing'])
                ? 'met' : 'missing',
            applicable: true,
            reason: 'Existing elevations and floor plans are required to assess scale, character and impact.',
            legal_basis: 'local_validation',
            effect_type: 'validation',
            source_status: 'live_checklist',
        });

        requirements.push({
            requirement_id: 'PLANS-PROPOSED',
            name: 'Proposed Elevations and Floor Plans',
            status: docPresent(submittedDocs, ['proposed elevation', 'proposed plan', 'proposed floor', 'as proposed'])
                ? 'met' : 'missing',
            applicable: true,
            reason: 'Proposed elevations and floor plans are required to assess the proposal.',
            legal_basis: 'local_validation',
            effect_type: 'validation',
            source_status: 'live_checklist',
        });
    }

    // ── Flood risk validation ─────────────────────────────────────────────────
    if (scope.modulesApplied.includes('flood_risk_validation') && inFloodZone23) {
        requirements.push({
            requirement_id: 'B25',
            name: 'Flood Risk Assessment',
            status: docPresent(submittedDocs, ['flood risk assessment', 'FRA', 'flood risk & drainage', 'flood risk and drainage'])
                ? 'met' : 'missing',
            applicable: true,
            reason: `Site is in Flood Zone ${site.flood_zone}. FRA required (NPPF; JCS INF2–INF7; GCP E4). Sequential test exemption may apply for householder minor development.`,
            legal_basis: 'local_validation',
            effect_type: 'validation',
            source_status: 'adopted',
        });
    }

    // ── Identify blocking requirements ────────────────────────────────────────
    for (const req of requirements) {
        if (req.status === 'missing' && req.applicable) {
            blockingIssues.push(`${req.requirement_id}: ${req.name} — required document or information missing.`);
        }
    }

    // ── Determine overall validation status ───────────────────────────────────
    let validationStatus;
    const hasMissing = requirements.some(r => r.status === 'missing' && r.applicable);
    const hasManualReview = requirements.some(r => r.status === 'cannot_assess');

    if (!scope.modulesApplied.includes('national_validation') &&
        !scope.modulesApplied.includes('local_validation_householder')) {
        validationStatus = 'not_run';
    } else if (hasMissing && mode === 'strict') {
        validationStatus = 'invalid';
    } else if (hasMissing) {
        validationStatus = 'incomplete';
    } else if (hasManualReview) {
        validationStatus = 'manual_review_required';
    } else {
        validationStatus = 'valid';
    }

    return {
        validationStatus,
        requirements,
        blockingIssues,
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function checkDocPresence(reqId, name, required, legalBasis, submittedDocs, aliases, reason, rulesetDef) {
    const searchTerms = aliases || [name.toLowerCase()];
    const present = required
        ? (submittedDocs.length > 0 ? docPresent(submittedDocs, searchTerms) : null)
        : true;

    // If no documents listed at all, treat as cannot_assess (not 'missing')
    if (required && submittedDocs.length === 0) {
        return {
            requirement_id: reqId,
            name,
            status: 'cannot_assess',
            applicable: required,
            reason: 'No submitted_documents list provided — cannot determine if requirement is met.',
            legal_basis: legalBasis,
            effect_type: 'validation',
            source_status: 'adopted',
        };
    }

    return {
        requirement_id: reqId,
        name,
        status: present ? 'met' : 'missing',
        applicable: required,
        reason,
        legal_basis: legalBasis,
        effect_type: 'validation',
        source_status: 'adopted',
    };
}

/**
 * Fuzzy-match: check if any submitted document identifier contains any of the given terms.
 */
function docPresent(submittedDocs, terms) {
    const docs = submittedDocs.map(d => d.toLowerCase());
    return terms.some(term =>
        docs.some(d => d.includes(term.toLowerCase()))
    );
}

module.exports = { runValidation };
