/**
 * Tool: gcc_procurement_determine_route
 *
 * Given a contract value and type, returns the full procurement decision from
 * GCC's constitutional authority matrix: tier, award authority, key decision
 * status, Forward Plan obligation, threshold status, required notices, deed
 * requirement, and any live compliance warnings.
 *
 * All rules are sourced from procurement-contracts-schema-v0.9.1.json.
 * No external calls. Read-only.
 */

'use strict';

const { createError, createSuccess, validateRequired, ERROR_CODES } = require('../../util/errors');
const {
    DERIVED,
    CONFLICTS,
    SCHEMA_VERSION,
    findTier,
    isAboveThreshold,
    findNotice,
} = require('../schema-loader');

const VALID_TYPES = ['goods', 'services', 'works', 'light_touch', 'concession', 'mixed'];

const DIRECT_ROUTES = [
    'direct_award',
    'below_threshold_direct',
    'framework_call_off_direct',
    'transparency',
    'waiver',
];


/**
 * Derive the required notice codes for this contract context.
 * Source: derived_fields.fields.required_notices.logic
 */
function deriveNotices(value, isAbove, procurementRoute) {
    const logic = DERIVED.fields.required_notices.logic;
    const route = (procurementRoute || 'competitive').toLowerCase();
    const isDirect = DIRECT_ROUTES.some(directRoute => route.includes(directRoute));

    let codes = [];

    if (value < 30000) {
        codes = logic.below_30000_non_framework || [];
    } else if (!isAbove) {
        codes = logic['30000_to_threshold'] || [];
    } else if (isDirect) {
        codes = logic.above_threshold_direct_award || [];
    } else {
        codes = logic.above_threshold_competitive || [];
    }

    if (value > 5000000) {
        const extra = logic.above_5m_contract || [];
        codes = [...new Set([...codes, ...extra])];
    }

    // Map code strings to full notice objects where possible (UK prefixed codes)
    return codes.map(code => {
        const ukCode = code.split('_')[0]; // e.g. 'UK4' from 'UK4_tender_notice'
        const notice = findNotice(code) || (/^UK\d+$/.test(ukCode) ? findNotice(ukCode) : null);
        return notice
            ? { code: notice.code, name: notice.name, timing: notice.timing, section: notice.section }
            : {
                code: code === 'BT-TENDER' ? 'Below Threshold-TENDER'
                    : code === 'BT-AWARD' ? 'Below Threshold-AWARD'
                    : code,
                name: code === 'BT-TENDER'
                    ? 'Below-Threshold Tender Notice'
                    : code === 'BT-AWARD'
                        ? 'Below-Threshold Award / Contract Details Notice'
                        : code.replace(/_/g, ' '),
                timing: 'See Contract Rules',
                section: 'CONTRACT-RULES',
            };
    });
}

/**
 * Render a markdown response for the tool.
 */
function renderMarkdown(result) {
    const status = result.compliance_warnings && result.compliance_warnings.length > 0 ? '⚠️' : '✅';
    const lines = [
        `## Procurement Route — ${status}`,
        '',
        `**Value:** £${result.value_gbp.toLocaleString()} (whole-life inc. VAT)`,
        `**Contract type:** ${result.contract_type}`,
        '',
        `### Tier ${result.tier}: ${result.tier_label}`,
        `**Award authority:** ${result.award_authority_label}`,
        `**Source:** ${result.tier_sources.join(', ')}`,
        '',
        `### Key Decision`,
        result.key_decision
            ? `**YES** — triggers: ${result.key_decision_triggers.join(', ')} | Source: ART12 12.03(b)`
            : `**NO** — value does not exceed key decision thresholds`,
        '',
        `### Forward Plan Required`,
        result.forward_plan_required
            ? `**YES** — ${result.forward_plan_note || 'Forward Plan entry required. Source: PART3E 3E.11'}`
            : `**NO**`,
        '',
        `### PA2023 Threshold`,
        result.is_above_threshold
            ? `**ABOVE THRESHOLD** — £${result.threshold_gbp.toLocaleString()} for ${result.contract_type} | Source: ${result.threshold_source}`
            : `**BELOW THRESHOLD** — £${result.threshold_gbp.toLocaleString()} for ${result.contract_type} | Source: ${result.threshold_source}`,
        '',
        `### Contract Formalities`,
        `- One Legal contract required: **${result.one_legal_contract_required ? 'YES' : 'NO'}** | Source: CONTRACT-RULES Rule 4.2.11`,
        `- Deed required: **${result.deed_required ? 'YES — Council Solicitor may approve signature instead of Common Seal' : 'NO'}** | Source: ART13 13.02`,
        '',
    ];

    if (result.required_notices && result.required_notices.length > 0) {
        lines.push('### Required Notices');
        result.required_notices.forEach(n => {
            lines.push(`- **${n.code}** ${n.name} — ${n.timing || ''} | ${n.section}`);
        });
        lines.push('');
    }

    if (result.lex_specialis_note) {
        lines.push('### Delegation Note (Lex Specialis)');
        lines.push(result.lex_specialis_note);
        lines.push('');
        lines.push('**Source:** PART3E Table 4, C4 conflict resolution');
        lines.push('');
    }

    if (result.compliance_warnings && result.compliance_warnings.length > 0) {
        lines.push('### ⚠️ Compliance Warnings');
        result.compliance_warnings.forEach(w => {
            lines.push(`- **${w.conflict_id}:** ${w.issue}`);
            lines.push(`  - Resolution: ${w.resolution}`);
            lines.push(`  - Action: ${w.action_required}`);
            lines.push(`  - Risk flag: ${w.risk_flag}`);
            lines.push(`  - Source: ${(w.between || []).join(', ')}`);
        });
        lines.push('');
    }

    lines.push(`*Schema version: ${result.schema_version}*`);

    return lines.join('\n');
}

/**
 * Execute the gcc_procurement_determine_route tool.
 * @param {object} input
 * @returns {object} createSuccess or createError result
 */
function execute(input = {}) {
    // ── Validate required inputs ─────────────────────────────────────────────
    const missing = validateRequired(input, ['value_gbp', 'contract_type']);
    if (missing) {
        return createError(ERROR_CODES.BAD_REQUEST, missing);
    }

    const value = Number(input.value_gbp);
    if (!Number.isFinite(value) || value <= 0) {
        return createError(ERROR_CODES.BAD_REQUEST, 'value_gbp must be a positive number (whole-life value inc. VAT)');
    }

    const contractType = (input.contract_type || '').toLowerCase();
    if (!VALID_TYPES.includes(contractType)) {
        return createError(ERROR_CODES.BAD_REQUEST, `contract_type must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const responseFormat = (input.response_format || 'markdown').toLowerCase();

    // ── Find tier ────────────────────────────────────────────────────────────
    const tier = findTier(value);
    if (!tier) {
        return createError(ERROR_CODES.INTERNAL_ERROR, `No procurement tier found for value £${value.toLocaleString()}`);
    }

    // ── Threshold assessment ─────────────────────────────────────────────────
    const thresholdResult = isAboveThreshold(value, contractType);

    // ── Key decision triggers ────────────────────────────────────────────────
    // Use the tier's key_decision_triggers array for primary triggers, then
    // add qualitative KD1/KD2 if the caller supplied them.
    const kd_triggers = [...(tier.key_decision_triggers || [])];
    if (input.budget_significant === true && !kd_triggers.includes('KD1')) {
        kd_triggers.unshift('KD1');
    }
    if (input.has_ward_impact === true && !kd_triggers.includes('KD2')) {
        kd_triggers.unshift('KD2');
    }

    const is_key_decision = tier.key_decision || kd_triggers.length > 0;

    // ── Forward Plan ─────────────────────────────────────────────────────────
    const forward_plan_required = tier.forward_plan_required || is_key_decision;

    // ── Required notices ─────────────────────────────────────────────────────
    const required_notices = deriveNotices(value, thresholdResult.above, input.procurement_route);

    // ── Compliance warnings (C3 on tier 4) ───────────────────────────────────
    const compliance_warnings = [];
    if (tier.tier === 4) {
        const c3 = CONFLICTS.find(c => c.conflict_id === 'C3');
        if (c3) compliance_warnings.push(c3);
    }

    // ── Lex specialis note (tier 5) ───────────────────────────────────────────
    const lex_specialis_note = tier.tier === 5 ? tier.cabinet_member_delegation_basis : null;

    // ── Assemble result ───────────────────────────────────────────────────────
    const result = {
        value_gbp: value,
        contract_type: contractType,
        service_area: input.service_area || null,
        tier: tier.tier,
        tier_label: tier.label,
        award_authority: tier.award_authority,
        award_authority_label: tier.award_authority_label,
        key_decision: is_key_decision,
        key_decision_triggers: kd_triggers,
        forward_plan_required,
        forward_plan_note: tier.forward_plan_note || null,
        is_above_threshold: thresholdResult.above,
        threshold_gbp: thresholdResult.thresholdGbp,
        threshold_source: thresholdResult.source,
        one_legal_contract_required: !!tier.one_legal_contract_required,
        deed_required: !!tier.deed_normally_required,
        deed_note: tier.deed_normally_required
            ? 'Council Solicitor may approve signature instead of Common Seal where appropriate. Source: ART13 13.02'
            : null,
        required_notices,
        tier_sources: tier.sources || [],
        lex_specialis_note,
        compliance_warnings,
        schema_version: SCHEMA_VERSION,
    };

    if (responseFormat === 'json') {
        return createSuccess(result);
    }

    return createSuccess({ text: renderMarkdown(result), raw: result });
}

module.exports = { execute };
