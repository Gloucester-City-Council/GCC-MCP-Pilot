/**
 * ResultAssembler
 *
 * Sole authority for computing recommendation.decision_mode and
 * recommendation.confidence. Implements the decision-mode precedence
 * table from plan Section 3.4.
 *
 * Also computes consultation triggers and CIL screening from scope and facts.
 *
 * The assembled result conforms to gloucester-householder-assessment-result.v2.2.schema.json.
 * (Validated by tests/mcp-planning-result-schema-conformance.test.js.)
 */

'use strict';

const { CONSULTATION_MATRIX, CIL_ASSESSMENT } = require('../schema-loader');

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
 * @returns {object}  Result conforming to assessment-result schema v2.2
 */
function assemble(params) {
    const { facts, dataQuality, scope, validation, merits, mode, processingState } = params;
    const app  = facts.application || {};

    const caseRef    = app.application_reference || 'UNREF-' + Date.now();
    const address    = (facts.site && facts.site.address) || app.description || '';
    const assessDate = new Date().toISOString().split('T')[0];

    // ── data_quality block (schema-compliant field names) ───────────────────
    const dataQualityBlock = {
        status: dataQuality.dataQualityStatus,
        issues: (dataQuality.dataQualityIssues || []).map(issue => ({
            issue_code:  issue.code,
            severity:    issue.severity,
            description: issue.message,
            ...(issue.field ? { facts_affected: [issue.field] } : {}),
        })),
    };

    // ── validation block ─────────────────────────────────────────────────────
    const validationBlock = {
        status:               validation.validationStatus,
        requirement_outcomes: (validation.requirements || []).map(toRequirementOutcome),
        blocking_issues:      validation.blockingIssues || [],
    };

    // ── planning_merits block ────────────────────────────────────────────────
    const ruleOutcomes = (merits.ruleOutcomes || []).map(toRuleOutcome);
    const manualFlags  = [
        ...(merits.isAdvisory
            ? ['ADVISORY_ONLY: planning merits assessment is advisory due to data quality issues — see data_quality.issues for the list of blockers.']
            : []),
        ...(merits.manualReviewFlags || []),
    ];
    const meritsBlock = {
        status:              merits.meritsStatus,
        rule_outcomes:       ruleOutcomes,
        manual_review_flags: manualFlags,
    };

    // ── consultations ────────────────────────────────────────────────────────
    const consultations = computeConsultations(facts, scope);

    // ── CIL ──────────────────────────────────────────────────────────────────
    const cil = computeCil(facts, scope, dataQuality);

    // ── recommendation (decision_mode precedence, plan Section 3.4) ─────────
    const recommendation = computeRecommendation({
        processingState,
        dataQuality,
        validation,
        merits,
        mode,
    });

    return {
        case_reference:  caseRef,
        address,
        assessment_date: assessDate,
        scope: {
            application_route:  scope.route,
            modules_considered: scope.modulesConsidered,
            modules_applied:    scope.modulesApplied,
            modules_skipped:    scope.modulesSkipped,
        },
        data_quality:    dataQualityBlock,
        validation:      validationBlock,
        planning_merits: meritsBlock,
        consultations,
        cil,
        recommendation,
    };
}

// ─── Outcome shape mappers (schema v2.2) ──────────────────────────────────────

/**
 * Map an internal validation requirement record to a schema-compliant
 * requirement_outcomes[] entry. Strips internal-only fields.
 */
function toRequirementOutcome(req) {
    const out = {
        requirement_id: req.requirement_id,
        source_module:  req.source_module,
        applicability:  req.applicability || 'applies',
        status:         req.status,
        legal_basis:    req.legal_basis,
        effect_type:    req.effect_type || 'validation',
    };
    if (req.requirement_name) out.requirement_name = req.requirement_name;
    if (req.source_status)    out.source_status    = req.source_status;
    if (req.reason)           out.reason           = req.reason;
    if (req.facts_used && req.facts_used.length)       out.facts_used    = req.facts_used;
    if (req.facts_missing && req.facts_missing.length) out.facts_missing = req.facts_missing;
    return out;
}

/**
 * Map an internal rule outcome record to a schema-compliant
 * rule_outcomes[] entry. Strips internal-only fields like advisory_only,
 * test_name, advisory_caveat which are not in the v2.2 schema.
 */
function toRuleOutcome(r) {
    const out = {
        rule_id:          r.rule_id,
        status:           r.status,
        applicability:    deriveRuleApplicability(r),
        legal_basis:      r.legal_basis      || 'development_plan_policy',
        effect_type:      r.effect_type      || 'planning_merit',
        threshold_status: r.threshold_status || 'not_applicable',
    };
    if (r.rule_name)            out.rule_name            = r.rule_name;
    if (r.test_id)              out.test_id              = r.test_id;
    if (r.severity)             out.severity             = r.severity;
    if (r.policy_source_status) out.policy_source_status = r.policy_source_status;
    if (r.reason)               out.summary              = r.reason;
    if (r.facts_used && r.facts_used.length)       out.facts_used    = r.facts_used;
    if (r.facts_missing && r.facts_missing.length) out.facts_missing = r.facts_missing;
    if (r.officer_judgement_required) out.officer_judgement_required = true;
    return out;
}

function deriveRuleApplicability(r) {
    if (r.status === 'not_applicable') return 'does_not_apply';
    if (r.officer_judgement_required && r.status === 'cannot_assess') return 'uncertain_manual_review';
    return 'applies';
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
    const dqStatus    = dataQuality.dataQualityStatus;
    const valStatus   = validation.validationStatus;
    const mStatus     = merits.meritsStatus;
    const ruleOutcomes = merits.ruleOutcomes || [];
    const manualFlags  = merits.manualReviewFlags || [];

    // Row 1 — schema_invalid
    if (processingState === 'schema_invalid') {
        return rec('invalid', 'high', 'Facts object does not conform to the application facts schema.');
    }

    // Row 2 — insufficient data quality
    if (dqStatus === 'insufficient') {
        return rec('insufficient_information', 'high', 'Data quality is insufficient to proceed with assessment.');
    }

    // Row 3 — conflicted + blocking issues
    if (dqStatus === 'conflicted') {
        const hasBlocking = (dataQuality.dataQualityIssues || []).some(i => i.severity === 'blocking');
        if (hasBlocking) {
            const note = dataQuality.isLawfulUseRouteBlocked
                ? 'Lawful use as single dwelling is unconfirmed. The submitted route is reported but its correctness cannot be confirmed (plan Section 3.3).'
                : 'Conflicting data with blocking issues prevents reliable assessment.';
            return rec('insufficient_information', 'high', note);
        }
    }

    // Row 4 — validation invalid + strict mode
    if (valStatus === 'invalid' && mode === 'strict') {
        return rec('invalid', 'high', 'Application fails validation in strict mode. Required documents or information are missing.');
    }

    // Row 5 — merits not run
    if (mStatus === 'not_run') {
        return rec('insufficient_information', 'medium', 'Planning merits assessment has not been run.');
    }

    // Row 6 — cannot_assess
    if (mStatus === 'cannot_assess') {
        return rec(
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
        return rec(
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
        return rec(
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
        return rec('manual_officer_review', 'medium', note);
    }

    // Row 10 — all pass
    return rec('likely_support', 'high', 'All applicable policy rules pass with no material concerns.');
}

function rec(decisionMode, confidence, reasonSummary) {
    return {
        decision_mode:  decisionMode,
        reason_summary: [reasonSummary],
        confidence,
    };
}

/**
 * Compute consultation triggers from site designations and proposal.
 * Returns { status, items } per result schema v2.2.
 */
function computeConsultations(facts, scope) {
    const site     = facts.site     || {};
    const proposal = facts.proposal || {};
    const route    = scope && scope.route;

    // Prior notification route uses its own neighbour-consultation regime,
    // not this matrix (plan / consultation_matrix._module_scope).
    if (route === 'prior_notification_larger_home_extension') {
        return {
            status: 'not_run',
            items: [],
        };
    }

    const auto  = (CONSULTATION_MATRIX && CONSULTATION_MATRIX.automatic_consultations) || [];
    const items = [];

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
            items.push({
                consultee:     entry.consultee,
                applicability: 'applies',
                ...(entry.mandatory !== undefined ? { mandatory: entry.mandatory } : {}),
                ...(entry.trigger ? { trigger: entry.trigger } : {}),
                ...(entry.response_time_days !== undefined ? { reason: `Response time: ${entry.response_time_days} days.` } : {}),
            });
        }
    }

    return {
        status: items.length > 0 ? 'required' : 'not_required',
        items,
    };
}

/**
 * Compute CIL screening outcome. Returns the result schema's `cil` block.
 * Per plan Section 3.2: advisory only if data_compromised — note that the
 * v2.2 schema does not have an `advisory_only` field on cil, so we surface
 * the caveat in `notes`.
 */
function computeCil(facts, scope, dataQuality) {
    const proposal   = facts.proposal || {};
    const route      = scope && scope.route;
    const isAdvisory = dataQuality.dataQualityStatus === 'conflicted' ||
                       dataQuality.dataQualityStatus === 'insufficient';

    // Module scope from ruleset: prior notification is excluded from CIL
    if (route === 'prior_notification_larger_home_extension') {
        return {
            applicability: 'not_run',
            notes: ['CIL screening does not apply to the prior notification route per ruleset cil_assessment._module_scope.'],
        };
    }

    if (!CIL_ASSESSMENT) {
        return { applicability: 'uncertain_manual_review', notes: ['CIL data not available in ruleset.'] };
    }

    const gia = proposal.gross_internal_area_sqm;
    const exemptThresholdSqm = 100;
    const notes = [];
    if (isAdvisory) {
        notes.push('Advisory only: CIL screening cannot be relied on while data quality issues remain.');
    }

    let applicability;
    let exemption_reason;

    if (typeof gia === 'number') {
        if (gia < exemptThresholdSqm) {
            applicability    = 'exempt';
            exemption_reason = `Extension is under ${exemptThresholdSqm}sqm GIA — exempt from CIL (extensions_less_than_${exemptThresholdSqm}sqm_GIA).`;
        } else {
            applicability = 'applies';
            notes.push('CIL liability should be assessed against the current GCC charging schedule.');
        }
    } else {
        applicability = 'uncertain_manual_review';
        notes.push('proposal.gross_internal_area_sqm not provided — cannot determine if the 100sqm GIA exemption applies. Extract GIA from the proposed plans.');
    }

    notes.push('Annual CIL Rate Summary Statement 2026 — verify current indexed rates at gloucester.gov.uk.');

    const out = {
        applicability,
        notes,
    };
    if (exemption_reason) out.exemption_reason = exemption_reason;
    if (typeof gia === 'number') out.chargeable_area_sqm = gia;
    return out;
}

module.exports = { assemble, computeRecommendation };
