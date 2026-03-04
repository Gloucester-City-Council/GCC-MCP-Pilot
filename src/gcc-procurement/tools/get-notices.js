/**
 * Tool: gcc_procurement_get_notices
 *
 * Returns the required notice sequence for a procurement, derived from
 * DERIVED.fields.required_notices.logic in procurement-contracts-schema-v0.9.1.json.
 *
 * Each required notice is looked up in NOTICES for full detail (name, timing,
 * platform, legal basis). No external calls. Read-only.
 */

'use strict';

const { createError, createSuccess, validateRequired, ERROR_CODES } = require('../../util/errors');
const {
    NOTICES,
    DERIVED,
    SCHEMA_VERSION,
    isAboveThreshold,
    findNotice,
} = require('../schema-loader');

const VALID_TYPES = ['goods', 'services', 'works', 'light_touch', 'concession', 'mixed'];

const COMPETITIVE_ROUTES = [
    'open_procedure',
    'competitive_flexible',
    'framework_calloff',
    'dynamic_market_calloff',
    'competitive',
];

const DIRECT_ROUTES = [
    'direct_award',
    'below_threshold_direct',
    'transparency',
];

/**
 * Resolve a notice code string (may be in form 'UK4_tender_notice' or just 'UK4')
 * to a full notice entry, supplemented with a publication platform note.
 */
function resolveNotice(codeOrKey) {
    // Extract UK code prefix if present (e.g. 'UK4_tender_notice' → 'UK4')
    const match = codeOrKey.match(/^(UK\d+)/i);
    const ukCode = match ? match[1].toUpperCase() : null;

    if (ukCode) {
        const notice = findNotice(ukCode);
        if (notice) {
            return {
                code: notice.code,
                name: notice.name,
                timing: notice.timing || 'See PA2023',
                mandatory: notice.mandatory,
                section: notice.section,
                notes: notice.notes || null,
                platform: 'Find a Tender (find-tender.service.gov.uk)',
            };
        }
    }

    // Below-threshold notices are on CDP (Contracts Data Platform), not Find a Tender
    if (codeOrKey.includes('below_threshold') || codeOrKey === 'contract_details_notice') {
        const name = codeOrKey === 'contract_details_notice'
            ? 'Contract Details Notice (below threshold)'
            : 'Below-Threshold Tender Notice';
        return {
            code: codeOrKey,
            name,
            timing: codeOrKey === 'contract_details_notice'
                ? 'After contract signature'
                : 'Before tender documents issued',
            mandatory: true,
            section: 'CONTRACT-RULES Rule 9; PA2023 s.53',
            notes: 'Published on Contracts Data Platform (CDP), not Find a Tender',
            platform: 'Contracts Data Platform (CDP)',
        };
    }

    // Fallback
    return {
        code: codeOrKey,
        name: codeOrKey.replace(/_/g, ' '),
        timing: 'See procurement guidance',
        mandatory: true,
        section: 'PA2023; CONTRACT-RULES',
        platform: 'Find a Tender (find-tender.service.gov.uk)',
    };
}

/**
 * Derive the ordered list of required notices.
 */
function deriveRequiredNotices(value, isAbove, procurementRoute, isFrameworkEstablishment) {
    const logic = DERIVED.fields.required_notices.logic;
    const route = (procurementRoute || 'competitive').toLowerCase();
    const isDirect = DIRECT_ROUTES.some(r => route.includes(r));

    let codes = [];

    if (value < 30000) {
        codes = logic.below_30000_non_framework || [];
    } else if (!isAbove) {
        codes = [...(logic['30000_to_threshold'] || [])];
    } else if (isDirect) {
        codes = [...(logic.above_threshold_direct_award || [])];
    } else {
        codes = [...(logic.above_threshold_competitive || [])];
    }

    // High-value KPI notice
    if (value > 5000000) {
        const extra = logic.above_5m_contract || [];
        extra.forEach(c => { if (!codes.includes(c)) codes.push(c); });
    }

    // Optional Planned Procurement Notice for framework establishments
    if (isFrameworkEstablishment && !codes.includes('UK3')) {
        codes.unshift('UK3');
    }

    // Resolve to full notice objects
    return codes.map(resolveNotice);
}

/**
 * Render markdown output.
 */
function renderMarkdown(result) {
    const lines = [
        `## Required Notices`,
        '',
        `**Value:** £${result.value_gbp.toLocaleString()} | **Type:** ${result.contract_type} | **Route:** ${result.procurement_route}`,
        `**Above PA2023 threshold:** ${result.is_above_threshold ? 'YES' : 'NO'} (£${result.threshold_gbp.toLocaleString()})`,
        '',
    ];

    if (result.required_notices.length === 0) {
        lines.push('**No notices required** at this value (below £30,000). Source: derived_fields.fields.required_notices.logic');
    } else {
        lines.push(`### ${result.required_notices.length} Notice(s) Required`);
        lines.push('');
        result.required_notices.forEach((n, i) => {
            lines.push(`**${i + 1}. ${n.code} — ${n.name}**`);
            lines.push(`- Timing: ${n.timing}`);
            lines.push(`- Mandatory: ${typeof n.mandatory === 'boolean' ? (n.mandatory ? 'YES' : 'NO') : n.mandatory}`);
            lines.push(`- Platform: ${n.platform}`);
            lines.push(`- Legal basis: ${n.section}`);
            if (n.notes) lines.push(`- Note: ${n.notes}`);
            lines.push('');
        });
    }

    lines.push(`**Source:** derived_fields.fields.required_notices.logic; PA2023; CONTRACT-RULES Rules 9, 16, 27`);
    lines.push(`*Schema version: ${result.schema_version}*`);

    return lines.join('\n');
}

/**
 * Execute the gcc_procurement_get_notices tool.
 * @param {object} input
 * @returns {object}
 */
function execute(input = {}) {
    const missing = validateRequired(input, ['value_gbp', 'contract_type', 'procurement_route']);
    if (missing) {
        return createError(ERROR_CODES.BAD_REQUEST, missing);
    }

    const value = Number(input.value_gbp);
    if (!Number.isFinite(value) || value <= 0) {
        return createError(ERROR_CODES.BAD_REQUEST, 'value_gbp must be a positive number');
    }

    const contractType = (input.contract_type || '').toLowerCase();
    if (!VALID_TYPES.includes(contractType)) {
        return createError(ERROR_CODES.BAD_REQUEST, `contract_type must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const responseFormat = (input.response_format || 'markdown').toLowerCase();
    const isFramework = !!input.is_framework_establishment;

    const thresholdResult = isAboveThreshold(value, contractType);
    const required_notices = deriveRequiredNotices(
        value,
        thresholdResult.above,
        input.procurement_route,
        isFramework
    );

    const result = {
        value_gbp: value,
        contract_type: contractType,
        procurement_route: input.procurement_route,
        is_framework_establishment: isFramework,
        is_above_threshold: thresholdResult.above,
        threshold_gbp: thresholdResult.thresholdGbp,
        threshold_source: thresholdResult.source,
        required_notices,
        source: 'derived_fields.fields.required_notices.logic; PA2023; CONTRACT-RULES Rules 9, 16, 27',
        schema_version: SCHEMA_VERSION,
    };

    if (responseFormat === 'json') {
        return createSuccess(result);
    }

    return createSuccess({ text: renderMarkdown(result), raw: result });
}

module.exports = { execute };
