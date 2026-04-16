/**
 * Schema chunker - builds a chunk index at cold start
 * Creates searchable chunks from the merged council tax schema (v2.5.2 four-document pack)
 * with metadata for hybrid search.
 */

const { getSchema } = require('./loader');
const { buildPointer } = require('./pointer');

// Module-level cache for chunk index
let cachedChunks = null;

/**
 * Extract text content from a value recursively
 * @param {*} value - Value to extract text from
 * @returns {string} Concatenated text content
 */
function extractText(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value.map(extractText).join(' ');
    }
    if (typeof value === 'object') {
        return Object.values(value).map(extractText).join(' ');
    }
    return '';
}

/**
 * Determine the section for a given path
 * @param {string[]} pathTokens - Path tokens
 * @returns {string} Section name
 */
function getSection(pathTokens) {
    if (pathTokens.length === 0) return 'root';
    return pathTokens[0];
}

/**
 * Extract tags from a chunk based on its content and structure
 * @param {*} value - The chunk value
 * @param {string[]} pathTokens - Path tokens
 * @returns {string[]} Array of tags
 */
function extractTags(value, pathTokens) {
    const tags = new Set();

    // Add section as tag
    if (pathTokens.length > 0) {
        tags.add(pathTokens[0]);
    }

    // Look for common identifiers in the value
    if (typeof value === 'object' && value !== null) {
        if (value.id) tags.add(value.id);
        if (value.category) tags.add(value.category);
        if (value.discount_id) tags.add('discount');
        if (value.exemption) tags.add('exemption');
        if (value.premium_id) tags.add('premium');
        if (value.legal_basis) tags.add('legal');
        if (value.eligibility) tags.add('eligibility');
        if (value.application_process) tags.add('application');
        if (value.url) tags.add('has-url');
        if (value.TODO || value.status === 'TODO') tags.add('todo');
        if (value.mechanism) tags.add(value.mechanism);
        if (value.rule_id) tags.add('rule');
        if (value.effect) tags.add('effect');
    }

    // Tag based on path context
    const pathStr = pathTokens.join('/');
    if (pathStr.includes('discount')) tags.add('discount');
    if (pathStr.includes('exemption')) tags.add('exemption');
    if (pathStr.includes('premium')) tags.add('premium');
    if (pathStr.includes('enforcement')) tags.add('enforcement');
    if (pathStr.includes('payment')) tags.add('payment');
    if (pathStr.includes('appeal')) tags.add('appeal');

    // Check for TODO in text
    const text = extractText(value);
    if (text.includes('TODO')) {
        tags.add('todo');
    }

    return Array.from(tags);
}

/**
 * Create a chunk from a value
 * @param {string} id - Unique chunk ID
 * @param {*} value - The chunk value
 * @param {string[]} pathTokens - Path tokens
 * @returns {object} Chunk object
 */
function createChunk(id, value, pathTokens) {
    const text = extractText(value);
    const section = getSection(pathTokens);
    const tags = extractTags(value, pathTokens);
    const jsonPath = buildPointer(pathTokens);

    return {
        id,
        text,
        section,
        tags,
        jsonPath,
        rawValue: value
    };
}

/**
 * Build chunks from the discounts section (v2.5.2 flat items array)
 */
function chunkDiscounts(discounts, chunks, idCounter) {
    if (!discounts) return idCounter;

    // Overview
    if (discounts.overview) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            { overview: discounts.overview },
            ['discounts', 'overview']
        ));
    }

    // Items array (flat list with category field)
    if (Array.isArray(discounts.items)) {
        for (let i = 0; i < discounts.items.length; i++) {
            chunks.push(createChunk(
                `chunk_${idCounter++}`,
                discounts.items[i],
                ['discounts', 'items', String(i)]
            ));
        }
    }

    return idCounter;
}

/**
 * Build chunks from enforcement section (v2.5.2 structure)
 */
function chunkEnforcement(enforcement, chunks, idCounter) {
    if (!enforcement) return idCounter;

    // Escalation stages
    if (Array.isArray(enforcement.escalation_stages)) {
        for (let i = 0; i < enforcement.escalation_stages.length; i++) {
            chunks.push(createChunk(
                `chunk_${idCounter++}`,
                enforcement.escalation_stages[i],
                ['enforcement', 'escalation_stages', String(i)]
            ));
        }
    }

    // Post-liability order powers
    if (enforcement.post_liability_order_powers) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            enforcement.post_liability_order_powers,
            ['enforcement', 'post_liability_order_powers']
        ));
    }

    // Debt support signposting
    if (enforcement.debt_support_signposting) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            enforcement.debt_support_signposting,
            ['enforcement', 'debt_support_signposting']
        ));
    }

    // Vulnerability and hardship policy
    if (enforcement.vulnerability_hardship_policy) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            enforcement.vulnerability_hardship_policy,
            ['enforcement', 'vulnerability_hardship_policy']
        ));
    }

    // Enforcement policy overview
    if (enforcement.enforcement_policy) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            enforcement.enforcement_policy,
            ['enforcement', 'enforcement_policy']
        ));
    }

    return idCounter;
}

/**
 * Build chunks from appeals section
 */
function chunkAppeals(appeals, chunks, idCounter) {
    if (!appeals) return idCounter;

    if (appeals.challenging_bill) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            appeals.challenging_bill,
            ['appeals_and_challenges', 'challenging_bill']
        ));
    }

    if (appeals.valuation_band_challenges) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            appeals.valuation_band_challenges,
            ['appeals_and_challenges', 'valuation_band_challenges']
        ));
    }

    if (appeals.valuation_tribunal) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            appeals.valuation_tribunal,
            ['appeals_and_challenges', 'valuation_tribunal']
        ));
    }

    return idCounter;
}

/**
 * Build chunks from data privacy section
 */
function chunkPrivacy(privacy, chunks, idCounter) {
    if (!privacy) return idCounter;

    if (privacy.what_we_process) {
        const categories = Object.keys(privacy.what_we_process);
        for (const cat of categories) {
            chunks.push(createChunk(
                `chunk_${idCounter++}`,
                privacy.what_we_process[cat],
                ['data_privacy', 'what_we_process', cat]
            ));
        }
    }

    if (privacy.your_rights) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            privacy.your_rights,
            ['data_privacy', 'your_rights']
        ));
    }

    if (privacy.data_protection_officer) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            privacy.data_protection_officer,
            ['data_privacy', 'data_protection_officer']
        ));
    }

    return idCounter;
}

/**
 * Build chunks from holiday lets section
 */
function chunkHolidayLets(holidayLets, chunks, idCounter) {
    if (!holidayLets) return idCounter;

    if (holidayLets.business_rates_eligibility) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            holidayLets.business_rates_eligibility,
            ['holiday_lets_and_self_catering', 'business_rates_eligibility']
        ));
    }

    if (holidayLets.council_tax_liability_for_holiday_lets) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            holidayLets.council_tax_liability_for_holiday_lets,
            ['holiday_lets_and_self_catering', 'council_tax_liability_for_holiday_lets']
        ));
    }

    if (holidayLets.common_scenarios) {
        const scenarios = Object.keys(holidayLets.common_scenarios);
        for (const scenario of scenarios) {
            chunks.push(createChunk(
                `chunk_${idCounter++}`,
                holidayLets.common_scenarios[scenario],
                ['holiday_lets_and_self_catering', 'common_scenarios', scenario]
            ));
        }
    }

    if (holidayLets.strategic_implications) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            holidayLets.strategic_implications,
            ['holiday_lets_and_self_catering', 'strategic_implications']
        ));
    }

    return idCounter;
}

/**
 * Build chunks from exemptions section (v2.5.2 flat items array)
 */
function chunkExemptions(exemptions, chunks, idCounter) {
    if (!exemptions) return idCounter;

    if (exemptions.overview) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            { overview: exemptions.overview },
            ['exemptions', 'overview']
        ));
    }

    if (Array.isArray(exemptions.items)) {
        for (let i = 0; i < exemptions.items.length; i++) {
            chunks.push(createChunk(
                `chunk_${idCounter++}`,
                exemptions.items[i],
                ['exemptions', 'items', String(i)]
            ));
        }
    }

    return idCounter;
}

/**
 * Build chunks from property premiums section
 */
function chunkPremiums(premiums, chunks, idCounter) {
    if (!premiums) return idCounter;

    if (premiums.empty_homes_premium) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            premiums.empty_homes_premium,
            ['property_premiums', 'empty_homes_premium']
        ));
    }

    if (premiums.second_homes_premium) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            premiums.second_homes_premium,
            ['property_premiums', 'second_homes_premium']
        ));
    }

    return idCounter;
}

/**
 * Build chunks from charge outputs (2026/27 approved rates)
 */
function chunkChargeOutputs(chargeOutputs, chunks, idCounter) {
    if (!chargeOutputs) return idCounter;

    if (Array.isArray(chargeOutputs.band_totals)) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            chargeOutputs.band_totals,
            ['charge_outputs', 'band_totals']
        ));
    }

    if (chargeOutputs.increase_summary) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            chargeOutputs.increase_summary,
            ['charge_outputs', 'increase_summary']
        ));
    }

    return idCounter;
}

/**
 * Build chunks from executable rules
 */
function chunkExecutableRules(execRules, chunks, idCounter) {
    if (!execRules || !Array.isArray(execRules.rules)) return idCounter;

    for (let i = 0; i < execRules.rules.length; i++) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            execRules.rules[i],
            ['executable_rules', 'rules', String(i)]
        ));
    }

    return idCounter;
}

/**
 * Build chunks for top-level sections that are simple objects
 */
function chunkSimpleSections(schema, chunks, idCounter) {
    const simpleSections = [
        'schema_metadata',
        'package_identity',
        'service_overview',
        'legal_framework',
        'valuation_and_charging',
        'council_tax_support',
        'payment',
        'liability',
        'service_standards',
        'governance',
        'national_context',
        'channels',
        'complaints',
        'related_services',
        'fraud',
        'security_warning'
    ];

    for (const section of simpleSections) {
        if (schema[section]) {
            chunks.push(createChunk(
                `chunk_${idCounter++}`,
                schema[section],
                [section]
            ));
        }
    }

    return idCounter;
}

/**
 * Build the chunk index from the merged schema
 * @returns {object[]} Array of chunks
 */
function buildChunkIndex() {
    if (cachedChunks !== null) {
        return cachedChunks;
    }

    const schema = getSchema();
    if (!schema) {
        cachedChunks = [];
        return cachedChunks;
    }

    const chunks = [];
    let idCounter = 1;

    // Chunk complex sections with fine granularity
    idCounter = chunkDiscounts(schema.discounts, chunks, idCounter);
    idCounter = chunkEnforcement(schema.enforcement, chunks, idCounter);
    idCounter = chunkAppeals(schema.appeals_and_challenges, chunks, idCounter);
    idCounter = chunkPrivacy(schema.data_privacy, chunks, idCounter);
    idCounter = chunkHolidayLets(schema.holiday_lets_and_self_catering, chunks, idCounter);
    idCounter = chunkExemptions(schema.exemptions, chunks, idCounter);
    idCounter = chunkPremiums(schema.property_premiums, chunks, idCounter);
    idCounter = chunkChargeOutputs(schema.charge_outputs, chunks, idCounter);
    idCounter = chunkExecutableRules(schema.executable_rules, chunks, idCounter);

    // Chunk simple top-level sections
    idCounter = chunkSimpleSections(schema, chunks, idCounter);

    cachedChunks = chunks;
    console.log(`Built chunk index with ${chunks.length} chunks`);

    return cachedChunks;
}

/**
 * Get the chunk index (builds if not already built)
 * @returns {object[]} Array of chunks
 */
function getChunks() {
    if (cachedChunks === null) {
        buildChunkIndex();
    }
    return cachedChunks;
}

/**
 * Force rebuild of the chunk index (for testing)
 */
function rebuildChunks() {
    cachedChunks = null;
    return buildChunkIndex();
}

module.exports = {
    getChunks,
    buildChunkIndex,
    rebuildChunks,
    extractText
};
