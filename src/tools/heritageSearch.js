/**
 * heritage.search tool - Search heritage assets schema content with hybrid search
 */

const { ERROR_CODES, createError, createSuccess } = require('../util/errors');
const { isSchemaLoaded } = require('../heritage/loader');
const { searchChunks } = require('../heritage/search');

/**
 * Execute the heritage.search tool
 * @param {object} input - Tool input
 * @param {string} input.text - Search text
 * @param {string[]} [input.scope] - Sections to search (e.g., ["serviceProcesses", "legislativeFramework"])
 * @param {number} [input.topK] - Number of results to return (default 5)
 * @param {object} [input.filters] - Additional filters (e.g., { tag: "consent" })
 * @returns {object} Tool result
 */
function execute(input = {}) {
    if (!isSchemaLoaded()) {
        return createError(
            ERROR_CODES.SCHEMA_LOAD_FAILED,
            'Heritage assets schema could not be loaded'
        );
    }

    const { text, scope, topK = 5, filters } = input;

    // Validate required parameters
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return createError(
            ERROR_CODES.BAD_REQUEST,
            'Missing or empty "text" parameter'
        );
    }

    // Validate topK
    const effectiveTopK = Math.max(1, Math.min(topK, 50));

    // Validate scope if provided
    if (scope !== undefined && !Array.isArray(scope)) {
        return createError(
            ERROR_CODES.BAD_REQUEST,
            '"scope" must be an array of section names'
        );
    }

    // Validate filters if provided
    if (filters !== undefined && (typeof filters !== 'object' || filters === null)) {
        return createError(
            ERROR_CODES.BAD_REQUEST,
            '"filters" must be an object'
        );
    }

    try {
        const results = searchChunks({
            text: text.trim(),
            scope,
            topK: effectiveTopK,
            filters
        });

        return createSuccess({
            results,
            query: text.trim(),
            scope: scope || [],
            filters: filters || {}
        });
    } catch (err) {
        return createError(
            ERROR_CODES.INTERNAL_ERROR,
            `Search failed: ${err.message}`
        );
    }
}

module.exports = { execute };
