/**
 * Schema chunker - builds a chunk index at cold start
 * Creates searchable chunks from schema content with metadata
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
        if (value.discount_id) tags.add('discount');
        if (value.exemption) tags.add('exemption');
        if (value.premium_id) tags.add('premium');
        if (value.legal_basis) tags.add('legal');
        if (value.eligibility) tags.add('eligibility');
        if (value.application_process) tags.add('application');
        if (value.url) tags.add('has-url');
        if (value.TODO || value.status === 'TODO') tags.add('todo');
    }

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
 * Build chunks from discounts section
 * @param {object} discounts - Discounts section
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkDiscounts(discounts, chunks, idCounter) {
    if (!discounts) return idCounter;

    // Person-based discounts
    if (Array.isArray(discounts.person_based_discounts)) {
        for (let i = 0; i < discounts.person_based_discounts.length; i++) {
            const item = discounts.person_based_discounts[i];
            chunks.push(createChunk(
                `chunk_${idCounter++}`,
                item,
                ['discounts', 'person_based_discounts', String(i)]
            ));
        }
    }

    // Student discounts
    if (Array.isArray(discounts.student_discounts)) {
        for (let i = 0; i < discounts.student_discounts.length; i++) {
            const item = discounts.student_discounts[i];
            chunks.push(createChunk(
                `chunk_${idCounter++}`,
                item,
                ['discounts', 'student_discounts', String(i)]
            ));
        }
    }

    // Property-based discounts
    if (Array.isArray(discounts.property_based_discounts)) {
        for (let i = 0; i < discounts.property_based_discounts.length; i++) {
            const item = discounts.property_based_discounts[i];
            chunks.push(createChunk(
                `chunk_${idCounter++}`,
                item,
                ['discounts', 'property_based_discounts', String(i)]
            ));
        }
    }

    // Other disregards
    if (Array.isArray(discounts.other_disregards)) {
        for (let i = 0; i < discounts.other_disregards.length; i++) {
            const item = discounts.other_disregards[i];
            chunks.push(createChunk(
                `chunk_${idCounter++}`,
                item,
                ['discounts', 'other_disregards', String(i)]
            ));
        }
    }

    // Overview
    if (discounts.overview) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            { overview: discounts.overview },
            ['discounts', 'overview']
        ));
    }

    return idCounter;
}

/**
 * Build chunks from enforcement section
 * @param {object} enforcement - Enforcement section
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkEnforcement(enforcement, chunks, idCounter) {
    if (!enforcement) return idCounter;

    // Recovery process stages
    if (enforcement.recovery_process) {
        const stages = ['stage_1', 'stage_2', 'stage_3', 'stage_4'];
        for (const stage of stages) {
            if (enforcement.recovery_process[stage]) {
                chunks.push(createChunk(
                    `chunk_${idCounter++}`,
                    enforcement.recovery_process[stage],
                    ['enforcement', 'recovery_process', stage]
                ));
            }
        }
    }

    // Avoiding enforcement
    if (enforcement.avoiding_enforcement) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            enforcement.avoiding_enforcement,
            ['enforcement', 'avoiding_enforcement']
        ));
    }

    // Overview
    if (enforcement.overview) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            { overview: enforcement.overview },
            ['enforcement', 'overview']
        ));
    }

    return idCounter;
}

/**
 * Build chunks from appeals section
 * @param {object} appeals - Appeals section
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkAppeals(appeals, chunks, idCounter) {
    if (!appeals) return idCounter;

    // Challenging bill
    if (appeals.challenging_bill) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            appeals.challenging_bill,
            ['appeals_and_challenges', 'challenging_bill']
        ));
    }

    // Valuation band challenges
    if (appeals.valuation_band_challenges) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            appeals.valuation_band_challenges,
            ['appeals_and_challenges', 'valuation_band_challenges']
        ));
    }

    // Valuation tribunal
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
 * @param {object} privacy - Data privacy section
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkPrivacy(privacy, chunks, idCounter) {
    if (!privacy) return idCounter;

    // What we process - each category as a chunk
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

    // Your rights
    if (privacy.your_rights) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            privacy.your_rights,
            ['data_privacy', 'your_rights']
        ));
    }

    // DPO info
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
 * @param {object} holidayLets - Holiday lets section
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkHolidayLets(holidayLets, chunks, idCounter) {
    if (!holidayLets) return idCounter;

    // Business rates eligibility
    if (holidayLets.business_rates_eligibility) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            holidayLets.business_rates_eligibility,
            ['holiday_lets_and_self_catering', 'business_rates_eligibility']
        ));
    }

    // Council tax liability
    if (holidayLets.council_tax_liability_for_holiday_lets) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            holidayLets.council_tax_liability_for_holiday_lets,
            ['holiday_lets_and_self_catering', 'council_tax_liability_for_holiday_lets']
        ));
    }

    // Common scenarios
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

    // Strategic implications
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
 * Build chunks from exemptions section
 * @param {object} exemptions - Exemptions section
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkExemptions(exemptions, chunks, idCounter) {
    if (!exemptions) return idCounter;

    // Unoccupied property exemptions
    if (Array.isArray(exemptions.unoccupied_property_exemptions)) {
        for (let i = 0; i < exemptions.unoccupied_property_exemptions.length; i++) {
            chunks.push(createChunk(
                `chunk_${idCounter++}`,
                exemptions.unoccupied_property_exemptions[i],
                ['exemptions', 'unoccupied_property_exemptions', String(i)]
            ));
        }
    }

    // Occupied property exemptions
    if (Array.isArray(exemptions.occupied_property_exemptions)) {
        for (let i = 0; i < exemptions.occupied_property_exemptions.length; i++) {
            chunks.push(createChunk(
                `chunk_${idCounter++}`,
                exemptions.occupied_property_exemptions[i],
                ['exemptions', 'occupied_property_exemptions', String(i)]
            ));
        }
    }

    return idCounter;
}

/**
 * Build chunks from property premiums section
 * @param {object} premiums - Property premiums section
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkPremiums(premiums, chunks, idCounter) {
    if (!premiums) return idCounter;

    // Empty homes premium
    if (premiums.empty_homes_premium) {
        chunks.push(createChunk(
            `chunk_${idCounter++}`,
            premiums.empty_homes_premium,
            ['property_premiums', 'empty_homes_premium']
        ));
    }

    // Second homes premium
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
 * Build chunks for top-level sections that are simple objects
 * @param {object} schema - Full schema
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
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
 * Build the chunk index from the schema
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
