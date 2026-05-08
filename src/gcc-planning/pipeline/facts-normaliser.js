/**
 * FactsNormaliser
 *
 * Converts raw extracted facts into a canonical facts object, applying the
 * evidence-precedence rules defined in the enums file (plan Section 4).
 *
 * Key rules:
 *   4.1 — Missing vs Unknown: omit if not provided; "unknown" if indeterminate
 *   4.2 — Evidence precedence: GIS > drawings > form > document text > AI inference
 *   4.3 — Lawful use route-blocking rule
 *   4.4 — Confidence levels tracked at extraction level only
 */

'use strict';

/**
 * Normalise raw facts input from an MCP tool call.
 *
 * @param {object} rawFacts  Raw facts object (may be partially filled)
 * @returns {{
 *   canonicalFacts: object,
 *   dataQualityIssues: Array<{ code, message, severity, field? }>,
 *   dataQualityStatus: string,   // clean|warnings|conflicted|insufficient
 *   isLawfulUseRouteBlocked: boolean
 * }}
 */
function normalise(rawFacts) {
    const issues = [];
    const facts  = deepClone(rawFacts || {});

    // ── Site integrity checks ─────────────────────────────────────────────────
    // Plan 4.2 special case: address on form vs documents
    const app = facts.application || {};
    if (app.site_address_matches_documents === 'no') {
        issues.push({
            code: 'address_mismatch',
            message: 'The address on the application form does not match the address in supporting documents.',
            severity: 'blocking',
            field: 'application.site_address_matches_documents',
        });
    }

    // ── Lawful use route-blocking rule (plan Section 4.3) ────────────────────
    const lawfulUse = app.lawful_use_as_single_dwelling_confirmed;
    let isLawfulUseRouteBlocked = false;
    if (lawfulUse === 'no' || lawfulUse === 'unknown') {
        isLawfulUseRouteBlocked = true;
        issues.push({
            code: 'lawful_use_unconfirmed',
            message: `Lawful use as a single dwelling is "${lawfulUse}". The property may not qualify for the householder route. Route detection is authoritative for the submitted route only; route correctness cannot be confirmed.`,
            severity: 'blocking',
            field: 'application.lawful_use_as_single_dwelling_confirmed',
        });
    }

    // ── Site designation cross-checks ─────────────────────────────────────────
    const site = facts.site || {};

    // If conservation_area is true and no_conservation_area context is missing, no issue
    // If flood_zone is present and not in the valid set, warn
    const validFloodZones = new Set(['1', '2', '3a', '3b', 'unknown']);
    if (site.flood_zone && !validFloodZones.has(site.flood_zone)) {
        issues.push({
            code: 'invalid_flood_zone',
            message: `Flood zone value "${site.flood_zone}" is not a recognised value. Expected: 1, 2, 3a, 3b, or unknown.`,
            severity: 'warning',
            field: 'site.flood_zone',
        });
    }

    // ── Proposal type checks ──────────────────────────────────────────────────
    const proposal = facts.proposal || {};
    if (proposal.proposal_type && !Array.isArray(proposal.proposal_type)) {
        // Coerce string to array if needed
        facts.proposal.proposal_type = [proposal.proposal_type];
        issues.push({
            code: 'proposal_type_coerced',
            message: 'proposal_type was provided as a string and has been coerced to an array.',
            severity: 'warning',
            field: 'proposal.proposal_type',
        });
    }

    // ── Route context ─────────────────────────────────────────────────────────
    const route = app.application_route;
    if (!route) {
        issues.push({
            code: 'route_missing',
            message: 'application_route is not set. Route detection will use defaults.',
            severity: 'warning',
            field: 'application.application_route',
        });
    }

    // ── Determine data quality status ─────────────────────────────────────────
    // Enum (data_quality_status): clean | warnings | conflicted | insufficient
    //   insufficient → there is not enough core context to proceed at all.
    //                  Triggered when site.address is missing AND no
    //                  proposal_type is set — i.e. the input is essentially empty.
    //   conflicted   → some context is present but a blocking issue prevents
    //                  reliable assessment (e.g. lawful use unconfirmed,
    //                  address mismatch).
    //   warnings     → only warning-severity issues raised.
    //   clean        → no issues raised.
    const hasBlocking = issues.some(i => i.severity === 'blocking');
    const hasWarnings = issues.some(i => i.severity === 'warning');
    const hasAddress  = Boolean(site && typeof site.address === 'string' && site.address.trim().length > 0);
    const hasProposal = Boolean(proposal && Array.isArray(proposal.proposal_type) && proposal.proposal_type.length > 0)
                        || Boolean(proposal && typeof proposal.proposal_type === 'string' && proposal.proposal_type.trim().length > 0);
    const isInsufficient = !hasAddress && !hasProposal;

    let dataQualityStatus;
    if (isInsufficient) {
        dataQualityStatus = 'insufficient';
        issues.push({
            code: 'insufficient_context',
            message: 'Neither site.address nor proposal.proposal_type is set — cannot proceed with a meaningful assessment.',
            severity: 'blocking',
        });
    } else if (hasBlocking) {
        dataQualityStatus = 'conflicted';
    } else if (hasWarnings) {
        dataQualityStatus = 'warnings';
    } else {
        dataQualityStatus = 'clean';
    }

    return {
        canonicalFacts: facts,
        dataQualityIssues: issues,
        dataQualityStatus,
        isLawfulUseRouteBlocked,
    };
}

function deepClone(obj) {
    if (typeof globalThis.structuredClone === 'function') {
        return globalThis.structuredClone(obj);
    }

    return JSON.parse(JSON.stringify(obj));
}

module.exports = { normalise };
