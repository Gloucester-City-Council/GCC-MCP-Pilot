/**
 * Hybrid search implementation for heritage assets schema chunks
 * Uses tokenization + BM25-lite scoring with keyword boosting
 */

const { getChunks } = require('./chunker');

/**
 * Tokenize text into lowercase words
 * @param {string} text - Text to tokenize
 * @returns {string[]} Array of tokens
 */
function tokenize(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 0);
}

/**
 * Calculate term frequency for tokens in a document
 * @param {string[]} tokens - Array of tokens
 * @returns {Map<string, number>} Term frequency map
 */
function calculateTF(tokens) {
    const tf = new Map();
    for (const token of tokens) {
        tf.set(token, (tf.get(token) || 0) + 1);
    }
    return tf;
}

/**
 * Build inverse document frequency map from chunks
 * @param {object[]} chunks - Array of chunks
 * @returns {Map<string, number>} IDF map
 */
function buildIDF(chunks) {
    const docFreq = new Map();
    const n = chunks.length;

    for (const chunk of chunks) {
        const tokens = new Set(tokenize(chunk.text));
        for (const token of tokens) {
            docFreq.set(token, (docFreq.get(token) || 0) + 1);
        }
    }

    const idf = new Map();
    for (const [term, df] of docFreq) {
        // Standard IDF formula with smoothing
        idf.set(term, Math.log((n - df + 0.5) / (df + 0.5) + 1));
    }

    return idf;
}

// Module-level IDF cache
let cachedIDF = null;

/**
 * Get or build the IDF map
 * @returns {Map<string, number>} IDF map
 */
function getIDF() {
    if (cachedIDF === null) {
        cachedIDF = buildIDF(getChunks());
    }
    return cachedIDF;
}

/**
 * Reset the IDF cache (for testing)
 */
function resetIDF() {
    cachedIDF = null;
}

/**
 * Calculate BM25 score for a query against a document
 * @param {string[]} queryTokens - Query tokens
 * @param {string[]} docTokens - Document tokens
 * @param {Map<string, number>} idf - IDF map
 * @param {number} avgDL - Average document length
 * @param {number} k1 - BM25 k1 parameter (default 1.5)
 * @param {number} b - BM25 b parameter (default 0.75)
 * @returns {number} BM25 score
 */
function bm25Score(queryTokens, docTokens, idf, avgDL, k1 = 1.5, b = 0.75) {
    const docLength = docTokens.length;
    const tf = calculateTF(docTokens);
    let score = 0;

    for (const qToken of queryTokens) {
        const termFreq = tf.get(qToken) || 0;
        if (termFreq === 0) continue;

        const idfValue = idf.get(qToken) || 0;
        const numerator = termFreq * (k1 + 1);
        const denominator = termFreq + k1 * (1 - b + b * (docLength / avgDL));
        score += idfValue * (numerator / denominator);
    }

    return score;
}

/**
 * Calculate keyword boost for exact phrase matches
 * @param {string} query - Original query
 * @param {string} text - Document text
 * @returns {number} Boost multiplier (1.0 = no boost)
 */
function keywordBoost(query, text) {
    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();

    let boost = 1.0;

    // Exact phrase match - high boost
    if (textLower.includes(queryLower)) {
        boost += 0.5;
    }

    // Check for individual query words as whole words
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const matchedWords = queryWords.filter(w => {
        const regex = new RegExp(`\\b${w}\\b`, 'i');
        return regex.test(textLower);
    });

    // Boost based on percentage of query words found
    if (queryWords.length > 0) {
        boost += 0.3 * (matchedWords.length / queryWords.length);
    }

    // Heritage-specific term boosting
    const heritageTerms = [
        'listed building', 'conservation area', 'section 66', 'section 72',
        'nppf', 'historic england', 'substantial harm', 'significance',
        'setting', 'consent', 'grade i', 'grade ii', 'scheduled monument'
    ];
    for (const term of heritageTerms) {
        if (queryLower.includes(term) && textLower.includes(term)) {
            boost += 0.2;
        }
    }

    return boost;
}

/**
 * Filter chunks by scope
 * @param {object[]} chunks - All chunks
 * @param {string[]} scope - Sections to include (empty = all)
 * @returns {object[]} Filtered chunks
 */
function filterByScope(chunks, scope) {
    if (!scope || scope.length === 0) {
        return chunks;
    }
    return chunks.filter(chunk => scope.includes(chunk.section));
}

/**
 * Filter chunks by filters object
 * @param {object[]} chunks - All chunks
 * @param {object} filters - Filter criteria (e.g., { section: "serviceProcesses" })
 * @returns {object[]} Filtered chunks
 */
function filterByFilters(chunks, filters) {
    if (!filters || Object.keys(filters).length === 0) {
        return chunks;
    }

    return chunks.filter(chunk => {
        for (const [key, value] of Object.entries(filters)) {
            if (key === 'section' && chunk.section !== value) {
                return false;
            }
            if (key === 'tag' && !chunk.tags.includes(value)) {
                return false;
            }
            if (key === 'tags' && Array.isArray(value)) {
                const hasAnyTag = value.some(t => chunk.tags.includes(t));
                if (!hasAnyTag) return false;
            }
        }
        return true;
    });
}

/**
 * Search the heritage schema chunks
 * @param {object} params - Search parameters
 * @param {string} params.text - Search text
 * @param {string[]} [params.scope] - Sections to search
 * @param {number} [params.topK] - Number of results (default 5)
 * @param {object} [params.filters] - Additional filters
 * @returns {object[]} Search results
 */
function searchChunks(params) {
    const { text, scope, topK = 5, filters } = params;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return [];
    }

    let chunks = getChunks();

    // Apply scope filter
    chunks = filterByScope(chunks, scope);

    // Apply additional filters
    chunks = filterByFilters(chunks, filters);

    if (chunks.length === 0) {
        return [];
    }

    // Tokenize query
    const queryTokens = tokenize(text);
    if (queryTokens.length === 0) {
        return [];
    }

    // Get IDF and calculate average document length
    const idf = getIDF();
    const allChunks = getChunks();
    const totalLength = allChunks.reduce((sum, c) => sum + tokenize(c.text).length, 0);
    const avgDL = totalLength / allChunks.length;

    // Score each chunk
    const scored = chunks.map(chunk => {
        const docTokens = tokenize(chunk.text);
        const bm25 = bm25Score(queryTokens, docTokens, idf, avgDL);
        const boost = keywordBoost(text, chunk.text);
        const finalScore = bm25 * boost;

        return {
            chunk,
            score: finalScore
        };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Return top K results
    const results = scored.slice(0, topK).map(item => {
        // Extract a relevant snippet
        const snippet = extractSnippet(item.chunk.text, text, 200);

        return {
            snippet,
            jsonPath: item.chunk.jsonPath,
            section: item.chunk.section,
            tags: item.chunk.tags,
            score: Math.round(item.score * 100) / 100
        };
    });

    return results;
}

/**
 * Extract a relevant snippet from text
 * @param {string} text - Full text
 * @param {string} query - Search query
 * @param {number} maxLength - Maximum snippet length
 * @returns {string} Snippet
 */
function extractSnippet(text, query, maxLength) {
    if (!text || text.length <= maxLength) {
        return text || '';
    }

    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();

    // Find position of query or first query word
    let pos = textLower.indexOf(queryLower);
    if (pos === -1) {
        const firstWord = queryLower.split(/\s+/)[0];
        pos = textLower.indexOf(firstWord);
    }

    if (pos === -1) {
        // No match found, return start of text
        return text.substring(0, maxLength) + '...';
    }

    // Center the snippet around the match
    const start = Math.max(0, pos - Math.floor(maxLength / 2));
    const end = Math.min(text.length, start + maxLength);

    let snippet = text.substring(start, end);

    // Add ellipsis if truncated
    if (start > 0) {
        snippet = '...' + snippet;
    }
    if (end < text.length) {
        snippet = snippet + '...';
    }

    return snippet;
}

module.exports = {
    searchChunks,
    tokenize,
    resetIDF
};
