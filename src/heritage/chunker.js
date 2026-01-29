/**
 * Heritage Assets Schema chunker - builds a chunk index at cold start
 * Creates searchable chunks from heritage schema content with metadata
 */

const { getSchema } = require('./loader');
const { buildPointer } = require('../schema/pointer');

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
        if (value.assetType) tags.add('asset-type');
        if (value.designation) tags.add('designation');
        if (value.legislativeAuthority) tags.add('legislation');
        if (value.statutoryDuty) tags.add('statutory-duty');
        if (value.consentRequired) tags.add('consent');
        if (value.processName) tags.add('process');
        if (value.section) tags.add('section');
        if (value.paragraph) tags.add('nppf');
        if (value.grade) tags.add('grade');
        if (value.policyWeight) tags.add('policy');
        if (value.sourceUrl) tags.add('has-url');
        if (value.caselaw) tags.add('caselaw');
    }

    // Check for statutory terms in text
    const text = extractText(value);
    if (text.toLowerCase().includes('listed building')) {
        tags.add('listed-building');
    }
    if (text.toLowerCase().includes('conservation area')) {
        tags.add('conservation-area');
    }
    if (text.toLowerCase().includes('consent')) {
        tags.add('consent');
    }
    if (text.toLowerCase().includes('nppf')) {
        tags.add('nppf');
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
 * Build chunks from legislative framework section
 * @param {object} legislative - Legislative framework section
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkLegislativeFramework(legislative, chunks, idCounter) {
    if (!legislative) return idCounter;

    // Primary legislation
    if (Array.isArray(legislative.primaryLegislation)) {
        for (let i = 0; i < legislative.primaryLegislation.length; i++) {
            const leg = legislative.primaryLegislation[i];
            chunks.push(createChunk(
                `heritage_chunk_${idCounter++}`,
                leg,
                ['legislativeFramework', 'primaryLegislation', String(i)]
            ));

            // Chunk key provisions separately for better search
            if (Array.isArray(leg.keyProvisions)) {
                for (let j = 0; j < leg.keyProvisions.length; j++) {
                    chunks.push(createChunk(
                        `heritage_chunk_${idCounter++}`,
                        leg.keyProvisions[j],
                        ['legislativeFramework', 'primaryLegislation', String(i), 'keyProvisions', String(j)]
                    ));
                }
            }
        }
    }

    // National policy (NPPF)
    if (Array.isArray(legislative.nationalPolicy)) {
        for (let i = 0; i < legislative.nationalPolicy.length; i++) {
            const policy = legislative.nationalPolicy[i];
            chunks.push(createChunk(
                `heritage_chunk_${idCounter++}`,
                policy,
                ['legislativeFramework', 'nationalPolicy', String(i)]
            ));

            // Chunk key paragraphs separately for better search
            if (Array.isArray(policy.keyParagraphs)) {
                for (let j = 0; j < policy.keyParagraphs.length; j++) {
                    chunks.push(createChunk(
                        `heritage_chunk_${idCounter++}`,
                        policy.keyParagraphs[j],
                        ['legislativeFramework', 'nationalPolicy', String(i), 'keyParagraphs', String(j)]
                    ));
                }
            }
        }
    }

    // Technical guidance
    if (Array.isArray(legislative.technicalGuidance)) {
        for (let i = 0; i < legislative.technicalGuidance.length; i++) {
            chunks.push(createChunk(
                `heritage_chunk_${idCounter++}`,
                legislative.technicalGuidance[i],
                ['legislativeFramework', 'technicalGuidance', String(i)]
            ));
        }
    }

    return idCounter;
}

/**
 * Build chunks from heritage asset types section
 * @param {object} assetTypes - Heritage asset types section
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkHeritageAssetTypes(assetTypes, chunks, idCounter) {
    if (!assetTypes) return idCounter;

    // Designated assets
    if (Array.isArray(assetTypes.designatedAssets)) {
        for (let i = 0; i < assetTypes.designatedAssets.length; i++) {
            chunks.push(createChunk(
                `heritage_chunk_${idCounter++}`,
                assetTypes.designatedAssets[i],
                ['heritageAssetTypes', 'designatedAssets', String(i)]
            ));
        }
    }

    // Non-designated assets
    if (Array.isArray(assetTypes.nonDesignatedAssets)) {
        for (let i = 0; i < assetTypes.nonDesignatedAssets.length; i++) {
            chunks.push(createChunk(
                `heritage_chunk_${idCounter++}`,
                assetTypes.nonDesignatedAssets[i],
                ['heritageAssetTypes', 'nonDesignatedAssets', String(i)]
            ));
        }
    }

    return idCounter;
}

/**
 * Build chunks from service processes section
 * @param {object} processes - Service processes section
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkServiceProcesses(processes, chunks, idCounter) {
    if (!processes) return idCounter;

    // Listed building consent process
    if (processes.listedBuildingConsent) {
        chunks.push(createChunk(
            `heritage_chunk_${idCounter++}`,
            processes.listedBuildingConsent,
            ['serviceProcesses', 'listedBuildingConsent']
        ));

        // Sub-sections of LBC process
        const lbc = processes.listedBuildingConsent;
        if (lbc.applicationRequirements) {
            chunks.push(createChunk(
                `heritage_chunk_${idCounter++}`,
                lbc.applicationRequirements,
                ['serviceProcesses', 'listedBuildingConsent', 'applicationRequirements']
            ));
        }
        if (lbc.consultationRequirements) {
            chunks.push(createChunk(
                `heritage_chunk_${idCounter++}`,
                lbc.consultationRequirements,
                ['serviceProcesses', 'listedBuildingConsent', 'consultationRequirements']
            ));
        }
        if (lbc.determinationProcess) {
            chunks.push(createChunk(
                `heritage_chunk_${idCounter++}`,
                lbc.determinationProcess,
                ['serviceProcesses', 'listedBuildingConsent', 'determinationProcess']
            ));
        }
        if (lbc.appeals) {
            chunks.push(createChunk(
                `heritage_chunk_${idCounter++}`,
                lbc.appeals,
                ['serviceProcesses', 'listedBuildingConsent', 'appeals']
            ));
        }
        if (lbc.enforcement) {
            chunks.push(createChunk(
                `heritage_chunk_${idCounter++}`,
                lbc.enforcement,
                ['serviceProcesses', 'listedBuildingConsent', 'enforcement']
            ));
        }
    }

    // Conservation area consent
    if (processes.conservationAreaConsent) {
        chunks.push(createChunk(
            `heritage_chunk_${idCounter++}`,
            processes.conservationAreaConsent,
            ['serviceProcesses', 'conservationAreaConsent']
        ));
    }

    // Heritage at risk
    if (processes.heritageAtRisk) {
        chunks.push(createChunk(
            `heritage_chunk_${idCounter++}`,
            processes.heritageAtRisk,
            ['serviceProcesses', 'heritageAtRisk']
        ));
    }

    return idCounter;
}

/**
 * Build chunks from user journeys section
 * @param {object} journeys - User journeys section
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkUserJourneys(journeys, chunks, idCounter) {
    if (!journeys) return idCounter;

    const journeyKeys = Object.keys(journeys);
    for (const key of journeyKeys) {
        chunks.push(createChunk(
            `heritage_chunk_${idCounter++}`,
            journeys[key],
            ['userJourneys', key]
        ));
    }

    return idCounter;
}

/**
 * Build chunks from key definitions section
 * @param {object} definitions - Key definitions section
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkKeyDefinitions(definitions, chunks, idCounter) {
    if (!definitions) return idCounter;

    const defKeys = Object.keys(definitions);
    for (const key of defKeys) {
        chunks.push(createChunk(
            `heritage_chunk_${idCounter++}`,
            definitions[key],
            ['keyDefinitions', key]
        ));
    }

    return idCounter;
}

/**
 * Build chunks for simple top-level sections
 * @param {object} schema - Full schema
 * @param {object[]} chunks - Array to add chunks to
 * @param {number} idCounter - Current ID counter
 * @returns {number} Updated ID counter
 */
function chunkSimpleSections(schema, chunks, idCounter) {
    const simpleSections = [
        'authorityContext',
        'contactInformation',
        'metadata'
    ];

    for (const section of simpleSections) {
        if (schema[section]) {
            chunks.push(createChunk(
                `heritage_chunk_${idCounter++}`,
                schema[section],
                [section]
            ));
        }
    }

    return idCounter;
}

/**
 * Build the chunk index from the heritage schema
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
    idCounter = chunkLegislativeFramework(schema.legislativeFramework, chunks, idCounter);
    idCounter = chunkHeritageAssetTypes(schema.heritageAssetTypes, chunks, idCounter);
    idCounter = chunkServiceProcesses(schema.serviceProcesses, chunks, idCounter);
    idCounter = chunkUserJourneys(schema.userJourneys, chunks, idCounter);
    idCounter = chunkKeyDefinitions(schema.keyDefinitions, chunks, idCounter);

    // Chunk simple top-level sections
    idCounter = chunkSimpleSections(schema, chunks, idCounter);

    cachedChunks = chunks;
    console.log(`Built heritage chunk index with ${chunks.length} chunks`);

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
