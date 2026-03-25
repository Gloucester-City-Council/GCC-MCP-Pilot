/**
 * ResultAssembler
 *
 * Sole authority for computing recommendation.decision_mode and
 * recommendation.confidence. Implements the decision-mode precedence
 * table from plan Section 3.4.
 *
 * Also computes consultation triggers and CIL screening from scope and facts.
 *
 * Returns: full assessment result object conforming to the result schema.
 */

'use strict';

const { CONSULTATION_MATRIX, CIL_ASSESSMENT, SCHEMA_VERSIONS, MATERIAL_RULES_REGISTER_VERSION } = require('../schema-loader');

/**
 * Assemble the full result object.
 *
 * @param {object} params
 * @param {object} params.facts          Canonical facts
 * @param {object} params.dataQuality    { dataQualityStatus, dataQualityIssues, isLawfulUseRouteBlocked }
 * @param {object} params.scope          Output of scope-engine
 * @param {object} params.validation     Output of validation-engine
 * @param {object} params.merits         Output of policy-engine
 * @param {string} params.mode           strict|advisory|pre_application
 * @param {string} params.processingState
 * @returns {object}  Result conforming to assessment-result schema
 */
function assemble(params) {
    const { facts, dataQuality, scope, validation, merits, mode, processingState } = params;
    const app  = facts.application || {};
    const site = facts.site        || {};

    const caseRef  = app.application_reference || 'UNREF-' + Date.now();
    const address  = (facts.site && facts.site.address) || app.description || '';
    const assessDate = new Date().toISOString().split('T')[0];

    // ── Data quality block ────────────────────────────────────────────────────
    const dataQualityBlock = {
        status: dataQuality.dataQualityStatus,
        issues: (dataQuality.dataQualityIssues || []).map(issue => ({
            code:     issue.code,
            message:  issue.message,
            severity: issue.severity,
            ...(issue.field ? { field: issue.field } : {}),
        })),
    };

    // ── Validation block ──────────────────────────────────────────────────────
    const validationBlock = {
        status:     validation.validationStatus,
        requirements: validation.requirements || [],
        blocking_issues: validation.blockingIssues || [],
    };

    // ── Planning merits block ─────────────────────────────────────────────────
    const meritsBlock = {
        status:             merits.meritsStatus,
        rule_outcomes:      merits.ruleOutcomes || [],
        manual_review_flags: merits.manualReviewFlags || [],
        advisory_only:      merits.isAdvisory,
        ...(merits.isAdvisory ? {
            advisory_caveat: 'Planning merits assessment is advisory only. Data quality issues were detected that limit the authority of these outcomes.',
        } : {}),
    };

    // ── Consultations ─────────────────────────────────────────────────────────
    const consultations = computeConsultations(facts, scope);

    // ── CIL screening ─────────────────────────────────────────────────────────
    const cilScreening = computeCilScreening(facts, scope, dataQuality);

    // ── Recommendation (decision_mode precedence, plan Section 3.4) ──────────
    const recommendation = computeRecommendation({
        processingState,
        dataQuality,
        validation,
        merits,
        mode,
    });

    return {
        case_reference: caseRef,
        address,
        assessment_date: assessDate,
        scope: {
            application_route:   scope.route,
            modules_considered:  scope.modulesConsidered,
            modules_applied:     scope.modulesApplied,
            modules_skipped:     scope.modulesSkipped,
        },
        data_quality:     dataQualityBlock,
        validation:       validationBlock,
        planning_merits:  meritsBlock,
        consultations,
        cil_screening:    cilScreening,
        recommendation,
    };
}

/**
 * Compute decision_mode and confidence using the precedence table (plan Section 3.4).
 * This is the SOLE place where decision_mode is set.
 *
 * Row | Condition                                           | decision_mode            | confidence
 * ────┼─────────────────────────────────────────────────────┼──────────────────────────┼───────────
 * 1  | schema_invalid                                      | invalid                  | high
 * 2  | data_quality.status = insufficient                  | insufficient_information | high
 * 3  | data_quality.status = conflicted + blocking         | insufficient_information | high
 * 4  | validation.status = invalid + strict                | invalid                  | high
 * 5  | merits.status = not_run                             | insufficient_information | medium
 * 6  | merits.status = cannot_assess                       | insufficient_information | low
 * 7  | Any must/must_not rule = fail                       | likely_refusal           | high(full)/medium(partial)
 * 8  | merits.status = concerns (2+ should)                | balanced_judgement       | medium
 * 9  | Any manual_review_flags                             | manual_officer_review    | medium
 * 10 | All pass, no flags                                  | likely_support           | high
 */
function computeRecommendation({ processingState, dataQuality, validation, merits, mode }) {
    const dqStatus  = dataQuality.dataQualityStatus;
    const valStatus = validation.validationStatus;
    const mStatus   = merits.meritsStatus;
    const ruleOutcomes = merits.ruleOutcomes || [];
    const manualFlags  = merits.manualReviewFlags || [];

    // Row 1 — schema_invalid
    if (processingState === 'schema_invalid') {
        return recommendation('invalid', 'high', 'Facts object does not conform to the application facts schema.');
    }

    // Row 2 — insufficient data quality
    if (dqStatus === 'insufficient') {
        return recommendation('insufficient_information', 'high', 'Data quality is insufficient to proceed with assessment.');
    }

    // Row 3 — conflicted + blocking issues
    if (dqStatus === 'conflicted') {
        const hasBlocking = (dataQuality.dataQualityIssues || []).some(i => i.severity === 'blocking');
        if (hasBlocking) {
            const note = dataQuality.isLawfulUseRouteBlocked
                ? 'Lawful use as single dwelling is unconfirmed. The submitted route is reported but its correctness cannot be confirmed (plan Section 3.3).'
                : 'Conflicting data with blocking issues prevents reliable assessment.';
            return recommendation('insufficient_information', 'high', note);
        }
    }

    // Row 4 — validation invalid + strict mode
    if (valStatus === 'invalid' && mode === 'strict') {
        return recommendation('invalid', 'high', 'Application fails validation in strict mode. Required documents or information are missing.');
    }

    // Row 5 — merits not run
    if (mStatus === 'not_run') {
        return recommendation('insufficient_information', 'medium', 'Planning merits assessment has not been run.');
    }

    // Row 6 — cannot_assess
    if (mStatus === 'cannot_assess') {
        return recommendation(
            'insufficient_information',
            'low',
            'One or more material rules could not be assessed due to missing facts. Insufficient information to determine a reliable outcome.',
        );
    }

    // Row 7 — must/must_not rule = fail
    const hasMustFail = ruleOutcomes.some(r =>
        r.status === 'fail' && (r.severity === 'must' || r.severity === 'must_not')
    );
    if (hasMustFail) {
        const confidence = processingState === 'full_assessment' ? 'high' : 'medium';
        const failedRules = ruleOutcomes
            .filter(r => r.status === 'fail' && (r.severity === 'must' || r.severity === 'must_not'))
            .map(r => r.rule_id);
        return recommendation(
            'likely_refusal',
            confidence,
            `One or more mandatory policy requirements are not met: ${failedRules.join(', ')}.`,
        );
    }

    // Row 8 — 2+ should/should_not concerns = balanced_judgement (plan Section 3.5)
    const shouldConcerns = ruleOutcomes.filter(r =>
        r.status === 'concern' && (r.severity === 'should' || r.severity === 'should_not')
    );
    if (shouldConcerns.length >= 2) {
        return recommendation(
            'balanced_judgement',
            'medium',
            `${shouldConcerns.length} policy concerns identified (${shouldConcerns.map(r => r.rule_id).join(', ')}). Balanced judgement required.`,
        );
    }

    // Row 9 — manual review flags (includes single concern)
    if (manualFlags.length > 0 || shouldConcerns.length === 1) {
        const note = shouldConcerns.length === 1
            ? `Single policy concern (${shouldConcerns[0].rule_id}) requires officer judgement.`
            : `Manual review flags raised: ${manualFlags.length}.`;
        return recommendation('manual_officer_review', 'medium', note);
    }

    // Row 10 — all pass
    return recommendation('likely_support', 'high', 'All applicable policy rules pass with no material concerns.');
}

function recommendation(decisionMode, confidence, reasonSummary) {
    return {
        decision_mode: decisionMode,
        confidence,
        reason_summary: [reasonSummary],
    };
}

/**
 * Compute consultation triggers from site designations and proposal.
 */
function computeConsultations(facts, scope) {
    const site     = facts.site     || {};
    const proposal = facts.proposal || {};
    const consultees = [];

    const auto = (CONSULTATION_MATRIX && CONSULTATION_MATRIX.automatic_consultations) || [];

    // Map trigger string patterns to site facts
    for (const entry of auto) {
        const trigger = (entry.trigger || '').toLowerCase();
        let triggered = false;

        if (trigger.includes('conservation_area') && site.conservation_area === true) triggered = true;
        if ((trigger.includes('flood_zone_2') || trigger.includes('flood_zone_3')) &&
            (site.flood_zone === '2' || site.flood_zone === '3a' || site.flood_zone === '3b')) triggered = true;
        if (trigger.includes('listed_building') && site.listed_building === true) triggered = true;
        if (trigger.includes('loss_of_parking') && proposal.parking_affected === true) triggered = true;
        if (trigger.includes('within_8m') && site.within_8m_of_watercourse === true) triggered = true;
        if (trigger.includes('aqma') && site.within_aqma === true) triggered = true;
        if (trigger.includes('classified_road') && site.classified_road === true) triggered = true;
        if (trigger.includes('archaeological') && site.known_or_potential_archaeological_interest === true) triggered = true;

        if (triggered) {
            consultees.push({
                consultee:           entry.consultee,
                trigger:             entry.trigger,
                mandatory:           entry.mandatory,
                response_time_days:  entry.response_time_days,
            });
        }
    }

    return { consultees };
}

/**
 * Compute CIL screening outcome.
 * Per plan Section 3.2: advisory only if data_compromised.
 */
function computeCilScreening(facts, scope, dataQuality) {
    if (!CIL_ASSESSMENT) return { status: 'not_assessed', note: 'CIL data not available.' };

    const proposal = facts.proposal || {};
    const isAdvisory = dataQuality.dataQualityStatus === 'conflicted' ||
                       dataQuality.dataQualityStatus === 'insufficient';

    // Check exemptions: extensions < 100sqm GIA
    const gia = proposal.gross_internal_area_sqm;
    const exemptions = CIL_ASSESSMENT.exemptions || [];
    let exempt = false;
    let exemptionReason = null;

    if (gia !== undefined && gia < 100) {
        exempt = true;
        exemptionReason = 'Extension is under 100sqm GIA — exempt from CIL (extensions_less_than_100sqm_GIA).';
    }

    return {
        status: exempt ? 'likely_exempt' : 'requires_assessment',
        advisory_only: isAdvisory,
        exempt,
        exemption_reason: exemptionReason,
        note: isAdvisory
            ? 'CIL screening is advisory only due to data quality issues.'
            : (exempt
                ? exemptionReason
                : 'CIL liability should be assessed against the current GCC charging schedule. Check the Annual CIL Rate Summary Statement.'),
        rates_reference: 'Annual CIL Rate Summary Statement 2026 — verify current indexed rates at gloucester.gov.uk',
    };
}

module.exports = { assemble, computeRecommendation };
