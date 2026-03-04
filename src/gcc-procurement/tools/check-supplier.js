/**
 * Tool: gcc_procurement_check_supplier
 *
 * Returns the supplier compliance checklist for a given contract.
 * Schema-only — all rules are derived from procurement-contracts-schema-v0.9.1.json.
 * No external API calls are made.
 *
 * TODO: Companies House live lookup not yet implemented.
 * Future: GET https://api.company-information.service.gov.uk/search/companies?q={company_name}
 * Requires COMPANIES_HOUSE_API_KEY env var.
 * See also: https://developer.company-information.service.gov.uk/
 */

'use strict';

const { createError, createSuccess, validateRequired, ERROR_CODES } = require('../../util/errors');
const {
    SCHEMA_VERSION,
    isAboveThreshold,
} = require('../schema-loader');

const VALID_TYPES = ['goods', 'services', 'works', 'light_touch', 'concession', 'mixed'];

const DEBARMENT_URL = 'https://www.find-tender.service.gov.uk/debarment';

/**
 * Build the compliance checklist for the given contract parameters.
 */
function buildChecklist(value, contractType, isAbove) {
    const type = (contractType || '').toLowerCase();
    const isWorks = type === 'works';

    const items = [];

    // Financial check — CONTRACT-RULES Rule 15.5
    items.push({
        check: 'Financial standing check',
        required: value > 10000,
        condition: 'Contract value > £10,000',
        action: value > 10000
            ? 'Obtain and review supplier financial accounts or credit check report before award.'
            : 'Not required at this value.',
        source: 'CONTRACT-RULES Rule 15.5',
    });

    // Debarment check — CONTRACT-RULES Rule 10.8
    items.push({
        check: 'Debarment register check',
        required: isAbove,
        condition: 'Above PA2023 threshold',
        action: isAbove
            ? `Search the Central Debarment List before contract award: ${DEBARMENT_URL}`
            : 'Not mandatory below threshold but good practice.',
        source: 'CONTRACT-RULES Rule 10.8',
        debarment_register_url: DEBARMENT_URL,
    });

    // Exclusion grounds — PA2023 Schedule 6
    items.push({
        check: 'Exclusion grounds assessment (mandatory and discretionary)',
        required: isAbove,
        condition: 'Above PA2023 threshold',
        action: isAbove
            ? 'Assess supplier against mandatory exclusion grounds (Schedule 6 PA2023) and discretionary exclusion grounds before award.'
            : 'Not mandatory below threshold.',
        source: 'PA2023 Schedule 6',
    });

    // SME status — always
    items.push({
        check: 'SME status identification',
        required: true,
        condition: 'All contracts',
        action: 'Record whether supplier is an SME (fewer than 250 employees, turnover ≤ €50m or balance sheet ≤ €43m). Support NPPS2024 SME objectives.',
        source: 'CONTRACT-RULES Definitions; NPPS2024',
    });

    // Parent Company Guarantee — works AND value > £1,000,000
    const pcgRequired = isWorks && value > 1000000;
    items.push({
        check: 'Parent Company Guarantee or Performance Bond',
        required: pcgRequired,
        condition: 'Works contracts with value > £1,000,000',
        action: pcgRequired
            ? 'Obtain a Parent Company Guarantee or Performance Bond from supplier. s151 Officer may determine not appropriate in specific circumstances.'
            : 'Not required (not a works contract above £1m).',
        source: 'CONTRACT-RULES Rule 20.1',
    });

    // Beneficial ownership — above threshold
    items.push({
        check: 'Beneficial ownership / transparency check',
        required: isAbove,
        condition: 'Above PA2023 threshold',
        action: isAbove
            ? 'Verify supplier is not subject to subsidy control obligations that would make award unlawful. Check beneficial ownership where appropriate.'
            : 'Not required below threshold.',
        source: 'Subsidy Control Act 2022; PA2023 s.26',
    });

    return items;
}

/**
 * Render a markdown response.
 */
function renderMarkdown(result) {
    const lines = [
        `## Supplier Compliance Checklist`,
        '',
        `**Contract value:** £${result.contract_value_gbp.toLocaleString()} (inc. VAT)`,
        `**Contract type:** ${result.contract_type}`,
        result.company_name ? `**Supplier:** ${result.company_name}` : null,
        `**Above PA2023 threshold:** ${result.is_above_threshold ? '**YES**' : 'NO'} (£${result.threshold_gbp.toLocaleString()} for ${result.contract_type})`,
        '',
        '> ⚠️ **Note:** Companies House live lookup is not yet implemented. The following checklist is based on constitutional rules only.',
        '',
        '| Check | Required | Action | Source |',
        '|---|---|---|---|',
        ...result.checklist.map(item =>
            `| ${item.check} | ${item.required ? '✅ YES' : 'NO'} | ${item.action.replace(/\n/g, ' ')} | ${item.source} |`
        ),
        '',
        `**Debarment register:** ${result.debarment_register_url}`,
        '',
        `*Schema version: ${result.schema_version}*`,
    ].filter(l => l !== null);

    return lines.join('\n');
}

/**
 * Execute the gcc_procurement_check_supplier tool.
 * @param {object} input
 * @returns {object}
 */
function execute(input = {}) {
    const missing = validateRequired(input, ['contract_value_gbp', 'contract_type']);
    if (missing) {
        return createError(ERROR_CODES.BAD_REQUEST, missing);
    }

    const value = Number(input.contract_value_gbp);
    if (!Number.isFinite(value) || value <= 0) {
        return createError(ERROR_CODES.BAD_REQUEST, 'contract_value_gbp must be a positive number');
    }

    const contractType = (input.contract_type || '').toLowerCase();
    if (!VALID_TYPES.includes(contractType)) {
        return createError(ERROR_CODES.BAD_REQUEST, `contract_type must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const responseFormat = (input.response_format || 'markdown').toLowerCase();

    const thresholdResult = isAboveThreshold(value, contractType);
    const checklist = buildChecklist(value, contractType, thresholdResult.above);

    const result = {
        contract_value_gbp: value,
        contract_type: contractType,
        company_name: input.company_name || null,
        is_above_threshold: thresholdResult.above,
        threshold_gbp: thresholdResult.thresholdGbp,
        threshold_source: thresholdResult.source,
        checklist,
        debarment_register_url: DEBARMENT_URL,
        companies_house_note: 'Companies House live lookup not yet implemented. Future integration will allow real-time company status verification.',
        schema_version: SCHEMA_VERSION,
    };

    if (responseFormat === 'json') {
        return createSuccess(result);
    }

    return createSuccess({ text: renderMarkdown(result), raw: result });
}

module.exports = { execute };
