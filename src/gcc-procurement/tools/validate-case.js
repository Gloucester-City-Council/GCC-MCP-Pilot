/**
 * Tool: gcc_procurement_validate_case
 *
 * Validates a procurement case against GCC's constitutional rules.
 * Returns triggered risk flags, missing required assessments, and recommended
 * next actions. All rules derived from procurement-contracts-schema-v0.9.1.json.
 *
 * No external calls. Read-only.
 */

'use strict';

const { createError, createSuccess, validateRequired, ERROR_CODES } = require('../../util/errors');
const {
    SCHEMA_VERSION,
    isAboveThreshold,
    findRiskFlag,
} = require('../schema-loader');

const VALID_TYPES = ['goods', 'services', 'works', 'light_touch', 'concession', 'mixed'];

// Status values that count as "active" for the R11 forward-plan check.
// The schema defines [pipeline, in_procurement]; the build spec extends this to
// also cover tender_open, needs_definition, and market_engagement.
const R11_ACTIVE_STATUSES = [
    'pipeline',
    'in_procurement',
    'tender_open',
    'needs_definition',
    'market_engagement',
];

/**
 * Evaluate risk flags for a procurement case.
 * Returns an array of triggered flag objects (schema flag + triggered condition).
 */
function evaluateFlags(input, value, contractType, isAbove) {
    const triggered = [];
    const route = (input.procurement_route || '').toLowerCase();
    const status = (input.status || '').toLowerCase();

    // ── R11: KD3 key decision — no Forward Plan reference ───────────────────
    // Source: Article 12.03(b)(iii) and (iv), PART3E 3E.11
    if (
        value > 100000 &&
        !input.forward_plan_reference &&
        (R11_ACTIVE_STATUSES.includes(status) || status === '')
    ) {
        const flag = findRiskFlag('R11');
        if (flag) {
            triggered.push({
                ...flag,
                triggered_condition: `value £${value.toLocaleString()} > £100,000 (KD3) and no forward_plan_reference recorded`,
                severity: 'red',
                constitutional_source: 'ART12 12.03(b)(iii) and (iv); PART3E 3E.11',
            });
        }
    }

    // ── R12: Tier 5 — Cabinet Member decision reference missing
    // Scoped to tier 5 (£250,001–£500,000) only. For tier 6 (above £500,000), R13 applies.
    // Source: SUB-DELEGATION; PART3E Table 4; risk_flags.R12 (v0.9.2)
    if (value > 250000 && value <= 500000 && !input.cabinet_member_decision_reference) {
        const flag = findRiskFlag('R12');
        if (flag) {
            triggered.push({
                ...flag,
                triggered_condition: `value £${value.toLocaleString()} > £250,000; cabinet_member_decision_reference not provided`,
                severity: 'red',
                constitutional_source: 'SUB-DELEGATION; PART3E Table 4',
            });
        }
    }

    // ── R13: Full Cabinet key decision — Cabinet minute not confirmed ─────────
    // Source: ART12 KD4
    if (value > 500000 && !input.cabinet_decision_reference) {
        const flag = findRiskFlag('R13');
        if (flag) {
            triggered.push({
                ...flag,
                triggered_condition: `value £${value.toLocaleString()} > £500,000 (KD4); cabinet_decision_reference not provided`,
                severity: 'red',
                constitutional_source: 'ART12 KD4; PART3E Table 4',
            });
        }
    }

    // ── R06: Direct award without documented justification ──────────────────
    // Source: CONTRACT-RULES Rule 10.8 (debarment/justification); schema R06
    if (
        (route === 'direct_award' || route === 'below_threshold_direct') &&
        !input.direct_award_justification_reference
    ) {
        const flag = findRiskFlag('R06');
        if (flag) {
            triggered.push({
                ...flag,
                triggered_condition: 'procurement_route is direct_award and no direct_award_justification_reference provided',
                severity: 'red',
                constitutional_source: 'CONTRACT-RULES Rule 10.8; PA2023 s.44',
            });
        }
    }

    // ── Waiver without reference ─────────────────────────────────────────────
    // Synthesised from CONTRACT-RULES Rule 6.3 (not a separate schema flag)
    if (route === 'waiver' && !input.waiver_reference) {
        triggered.push({
            flag_id: 'WAIVER-REF',
            label: 'Waiver applied — no waiver approval reference recorded',
            triggered_condition: 'procurement_route is waiver and no waiver_reference provided',
            severity: 'red',
            constitutional_source: 'CONTRACT-RULES Rule 6.3; PART3E Table 4 (waiver approval authority)',
        });
    }

    // ── Above-threshold with invalid/unknown procurement route ───────────────
    // Synthesised check — PA2023 requires a defined procedure for above-threshold contracts
    const VALID_ABOVE_THRESHOLD_ROUTES = [
        'open_procedure',
        'competitive_flexible',
        'direct_award',
        'framework_calloff',
        'dynamic_market_calloff',
    ];
    if (
        isAbove &&
        route &&
        !VALID_ABOVE_THRESHOLD_ROUTES.includes(route)
    ) {
        triggered.push({
            flag_id: 'ROUTE-INVALID',
            label: 'Above-threshold procurement using unrecognised procedure',
            triggered_condition: `Above PA2023 threshold; procurement_route '${route}' is not one of the recognised PA2023 procedures`,
            severity: 'amber',
            constitutional_source: 'PA2023 s.19–s.44; CONTRACT-RULES Rule 9.1',
        });
    }

    return triggered;
}

/**
 * Evaluate missing required assessments (above-threshold contracts).
 */
function evaluateMissingAssessments(input, value, contractType, isAbove) {
    if (!isAbove) return [];

    const type = (contractType || '').toLowerCase();
    const isServices = type === 'services' || type === 'goods' || type === 'mixed';
    const missing = [];

    if (isServices && input.social_value_assessed !== true) {
        missing.push({
            assessment: 'Social value assessment',
            reason: 'Services above threshold require consideration of economic, social and environmental wellbeing',
            source: 'SV2012 — Public Services (Social Value) Act 2012',
            action: 'Complete social value assessment and record outcome in procurement case.',
        });
    }

    if (input.conflicts_assessment_completed !== true) {
        missing.push({
            assessment: 'Conflicts of interest assessment',
            reason: 'Required for all above-threshold procurements',
            source: 'CONTRACT-RULES Rule 7; PA2023 s.82',
            action: 'Complete and document conflicts of interest assessment for all evaluation team members.',
        });
    }

    if (input.lots_considered !== true) {
        missing.push({
            assessment: 'Lots consideration',
            reason: 'Contracting authorities must consider dividing contracts into lots',
            source: 'PA2023 s.34',
            action: 'Document whether contract is suitable for division into lots, with reasons.',
        });
    }

    if (input.existing_framework_checked !== true) {
        missing.push({
            assessment: 'Existing framework / dynamic market check',
            reason: 'Value for money requires checking existing frameworks before new procurement',
            source: 'CONTRACT-RULES Rule 22; NPPS2024',
            action: 'Check Crown Commercial Service, ESPO, and other available frameworks before launching new competition.',
        });
    }

    if (isServices && input.tupe_assessed !== true) {
        missing.push({
            assessment: 'TUPE assessment',
            reason: 'Services contracts may involve transfer of undertakings',
            source: 'TUPE 2006 (SI 2006/246)',
            action: 'Assess whether TUPE applies and notify bidders appropriately. Refer to One Legal if uncertain.',
        });
    }

    return missing;
}

/**
 * Evaluate checks that have been positively satisfied for audit output.
 */
function evaluateVerifiedChecks(input, value, contractType, isAbove) {
    const type = (contractType || '').toLowerCase();
    const route = (input.procurement_route || '').toLowerCase();
    const verified = [];

    if (value > 100000 && input.forward_plan_reference) {
        verified.push({
            check: 'Forward Plan reference',
            status: 'PASS',
            source: 'ART12 12.03(b)(iii) and (iv); PART3E 3E.11',
            forward_plan_reference: input.forward_plan_reference,
        });
    }

    if (value > 250000 && value <= 500000 && input.cabinet_member_decision_reference) {
        verified.push({
            check: 'Cabinet Member decision reference',
            status: 'PASS',
            source: 'SUB-DELEGATION; PART3E Table 4',
            cabinet_member_decision_reference: input.cabinet_member_decision_reference,
        });
    }

    if (value > 500000 && input.cabinet_decision_reference) {
        verified.push({
            check: 'Cabinet decision reference',
            status: 'PASS',
            source: 'ART12 KD4; PART3E Table 4',
            cabinet_decision_reference: input.cabinet_decision_reference,
        });
    }

    if (route === 'direct_award' || route === 'below_threshold_direct') {
        if (input.direct_award_justification_reference) {
            verified.push({
                check: 'Direct award justification reference',
                status: 'PASS',
                source: 'CONTRACT-RULES Rule 10.8; PA2023 s.44',
                direct_award_justification_reference: input.direct_award_justification_reference,
            });
        }
    }

    if (route === 'waiver' && input.waiver_reference) {
        verified.push({
            check: 'Waiver approval reference',
            status: 'PASS',
            source: 'CONTRACT-RULES Rule 6.3; PART3E Table 4',
            waiver_reference: input.waiver_reference,
        });
    }

    if (isAbove) {
        const isServices = type === 'services' || type === 'goods' || type === 'mixed';

        if (isServices && input.social_value_assessed === true) {
            verified.push({
                check: 'Social value assessment',
                status: 'PASS',
                source: 'SV2012 — Public Services (Social Value) Act 2012',
            });
        }

        if (input.conflicts_assessment_completed === true) {
            verified.push({
                check: 'Conflicts of interest assessment',
                status: 'PASS',
                source: 'CONTRACT-RULES Rule 7; PA2023 s.82',
            });
        }

        if (input.lots_considered === true) {
            verified.push({
                check: 'Lots consideration',
                status: 'PASS',
                source: 'PA2023 s.34',
            });
        }

        if (input.existing_framework_checked === true) {
            verified.push({
                check: 'Existing framework / dynamic market check',
                status: 'PASS',
                source: 'CONTRACT-RULES Rule 22; NPPS2024',
            });
        }

        if (isServices && input.tupe_assessed === true) {
            verified.push({
                check: 'TUPE assessment',
                status: 'PASS',
                source: 'TUPE 2006 (SI 2006/246)',
            });
        }
    }

    return verified;
}

/**
 * Determine overall status from flags and missing assessments.
 */
function overallStatus(flags, missingAssessments) {
    if (flags.length > 0) return 'FAIL';
    if (missingAssessments.length > 0) return 'WARNINGS';
    return 'PASS';
}

/**
 * Build recommended next actions in priority order.
 */
function buildRecommendations(flags, missingAssessments, value) {
    const actions = [];

    flags.forEach(f => {
        if (f.flag_id === 'R11') {
            actions.push({
                priority: 1,
                action: `Add this procurement to the Forward Plan immediately. Value £${value.toLocaleString()} exceeds KD3 threshold (£100,000). Procurement cannot proceed without Leader authorisation via Forward Plan mechanism.`,
                source: 'PART3E 3E.11; ART12 KD3',
            });
        } else if (f.flag_id === 'R12') {
            actions.push({
                priority: 1,
                action: `Obtain Cabinet Member decision before award. Value exceeds officer award ceiling of £250,000. Source: SUB-DELEGATION; PART3E Table 4.`,
                source: 'SUB-DELEGATION; PART3E Table 4',
            });
        } else if (f.flag_id === 'R13') {
            actions.push({
                priority: 1,
                action: `Obtain Full Cabinet approval before award. Value exceeds £500,000 (KD4 threshold). Cabinet minute reference must be recorded.`,
                source: 'ART12 KD4; PART3E Table 4',
            });
        } else if (f.flag_id === 'R06') {
            actions.push({
                priority: 2,
                action: 'Document the direct award ground and obtain Transparency Notice (UK5) approval before proceeding. Direct award without documented justification is a governance breach.',
                source: 'CONTRACT-RULES Rule 10.8; PA2023 s.44',
            });
        } else if (f.flag_id === 'WAIVER-REF') {
            actions.push({
                priority: 2,
                action: 'Obtain formal waiver approval and record reference. See PART3E Table 4 for waiver approval authority by value.',
                source: 'CONTRACT-RULES Rule 6.3; PART3E Table 4',
            });
        } else {
            actions.push({
                priority: 3,
                action: `Resolve ${f.flag_id}: ${f.label}`,
                source: f.constitutional_source || f.source || '',
            });
        }
    });

    missingAssessments.forEach(m => {
        actions.push({
            priority: 4,
            action: m.action,
            source: m.source,
        });
    });

    // Sort by priority
    actions.sort((a, b) => a.priority - b.priority);
    return actions;
}

/**
 * Render markdown output.
 */
function renderMarkdown(result) {
    const statusIcon = result.overall_status === 'PASS' ? '✅' : result.overall_status === 'WARNINGS' ? '⚠️' : '❌';
    const lines = [
        `## Procurement Case Validation — ${statusIcon} ${result.overall_status}`,
        '',
        `**Value:** £${result.value_estimated_gbp.toLocaleString()} | **Contract type:** ${result.contract_type}`,
        `**Above PA2023 threshold:** ${result.is_above_threshold ? 'YES' : 'NO'} (£${result.threshold_gbp.toLocaleString()})`,
        '',
    ];

    if (result.triggered_flags.length > 0) {
        lines.push('### ❌ Triggered Risk Flags');
        result.triggered_flags.forEach(f => {
            lines.push(`- **${f.flag_id}** ${f.label}`);
            lines.push(`  - Condition: ${f.triggered_condition}`);
            lines.push(`  - Source: ${f.constitutional_source || f.source || ''}`);
        });
        lines.push('');
    }

    if (result.missing_assessments.length > 0) {
        lines.push('### ⚠️ Missing Required Assessments');
        result.missing_assessments.forEach(m => {
            lines.push(`- **${m.assessment}** — ${m.reason}`);
            lines.push(`  - Action: ${m.action}`);
            lines.push(`  - Source: ${m.source}`);
        });
        lines.push('');
    }

    if (result.recommendations.length > 0) {
        lines.push('### Recommended Next Actions');
        result.recommendations.forEach((r, i) => {
            lines.push(`${i + 1}. ${r.action} | Source: ${r.source}`);
        });
        lines.push('');
    }

    lines.push(`*Schema version: ${result.schema_version}*`);
    return lines.join('\n');
}

/**
 * Execute the gcc_procurement_validate_case tool.
 * @param {object} input
 * @returns {object}
 */
function execute(input = {}) {
    const missing = validateRequired(input, ['value_estimated_gbp', 'contract_type']);
    if (missing) {
        return createError(ERROR_CODES.BAD_REQUEST, missing);
    }

    const value = Number(input.value_estimated_gbp);
    if (!Number.isFinite(value) || value <= 0) {
        return createError(ERROR_CODES.BAD_REQUEST, 'value_estimated_gbp must be a positive number');
    }

    const contractType = (input.contract_type || '').toLowerCase();
    if (!VALID_TYPES.includes(contractType)) {
        return createError(ERROR_CODES.BAD_REQUEST, `contract_type must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const responseFormat = (input.response_format || 'markdown').toLowerCase();

    const thresholdResult = isAboveThreshold(value, contractType);

    const triggered_flags = evaluateFlags(input, value, contractType, thresholdResult.above);
    const missing_assessments = evaluateMissingAssessments(input, value, contractType, thresholdResult.above);
    const verified_checks = evaluateVerifiedChecks(input, value, contractType, thresholdResult.above);
    const status = overallStatus(triggered_flags, missing_assessments);
    const recommendations = buildRecommendations(triggered_flags, missing_assessments, value);

    const result = {
        value_estimated_gbp: value,
        contract_type: contractType,
        is_above_threshold: thresholdResult.above,
        threshold_gbp: thresholdResult.thresholdGbp,
        threshold_source: thresholdResult.source,
        overall_status: status,
        triggered_flags,
        missing_assessments,
        verified_checks,
        recommendations,
        schema_version: SCHEMA_VERSION,
    };

    if (responseFormat === 'json') {
        return createSuccess(result);
    }

    return createSuccess({ text: renderMarkdown(result), raw: result });
}

module.exports = { execute };
