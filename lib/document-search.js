/**
 * Document Search
 * BM25 + keyword boosting search across chunked democratic documents.
 * Mirrors the proven approach in src/schema/search.js but adapted for
 * meeting documents with richer metadata filtering.
 */

const { getCachedIndex } = require('./document-chunker');

/**
 * Tokenize text into lowercase words, stripping punctuation
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1); // drop single chars
}

/**
 * Calculate term frequency map
 * @param {string[]} tokens
 * @returns {Map<string, number>}
 */
function calculateTF(tokens) {
    const tf = new Map();
    for (const token of tokens) {
        tf.set(token, (tf.get(token) || 0) + 1);
    }
    return tf;
}

/**
 * Build IDF map from a set of chunks
 * @param {object[]} chunks
 * @returns {Map<string, number>}
 */
function buildIDF(chunks) {
    const docFreq = new Map();
    const n = chunks.length;

    for (const chunk of chunks) {
        const uniqueTokens = new Set(tokenize(chunk.text));
        for (const token of uniqueTokens) {
            docFreq.set(token, (docFreq.get(token) || 0) + 1);
        }
    }

    const idf = new Map();
    for (const [term, df] of docFreq) {
        idf.set(term, Math.log((n - df + 0.5) / (df + 0.5) + 1));
    }

    return idf;
}

// Module-level IDF cache (rebuilt when index changes)
let cachedIDF = null;
let idfBuiltForLength = 0;

/**
 * Get or rebuild IDF for current index
 * @param {object[]} chunks
 * @returns {Map<string, number>}
 */
function getIDF(chunks) {
    if (cachedIDF && idfBuiltForLength === chunks.length) {
        return cachedIDF;
    }
    cachedIDF = buildIDF(chunks);
    idfBuiltForLength = chunks.length;
    return cachedIDF;
}

/**
 * BM25 score for a query against a document
 * @param {string[]} queryTokens
 * @param {string[]} docTokens
 * @param {Map<string, number>} idf
 * @param {number} avgDL - average document length
 * @param {number} k1
 * @param {number} b
 * @returns {number}
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
 * Keyword boost for exact and partial phrase matches
 * @param {string} query
 * @param {string} text
 * @returns {number} multiplier >= 1.0
 */
function keywordBoost(query, text) {
    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();

    let boost = 1.0;

    // Exact phrase match
    if (textLower.includes(queryLower)) {
        boost += 0.5;
    }

    // Individual word matches
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length > 0) {
        const matched = queryWords.filter(w => {
            try {
                return new RegExp(`\\b${w}\\b`, 'i').test(textLower);
            } catch {
                return textLower.includes(w);
            }
        });
        boost += 0.3 * (matched.length / queryWords.length);
    }

    return boost;
}

/**
 * Boost score based on metadata matches (council, committee names, etc.)
 * @param {string} query
 * @param {object} chunk
 * @returns {number} multiplier >= 1.0
 */
function metadataBoost(query, chunk) {
    const queryLower = query.toLowerCase();
    let boost = 1.0;

    // Boost if query mentions the council
    if (chunk.council && queryLower.includes(chunk.council.toLowerCase().split(' ')[0])) {
        boost += 0.2;
    }

    // Boost if query mentions the committee
    if (chunk.committee && queryLower.includes(chunk.committee.toLowerCase().split(' ')[0])) {
        boost += 0.2;
    }

    // Boost if query terms appear in document title
    if (chunk.document_title) {
        const titleLower = chunk.document_title.toLowerCase();
        const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
        const titleMatches = queryWords.filter(w => titleLower.includes(w));
        if (titleMatches.length > 0) {
            boost += 0.3 * (titleMatches.length / queryWords.length);
        }
    }

    return boost;
}

/**
 * Extract a snippet around the best match location
 * @param {string} text
 * @param {string} query
 * @param {number} maxLength
 * @returns {string}
 */
function extractSnippet(text, query, maxLength = 300) {
    if (!text || text.length <= maxLength) return text || '';

    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();

    // Find best match position
    let pos = textLower.indexOf(queryLower);
    if (pos === -1) {
        const firstWord = queryLower.split(/\s+/)[0];
        pos = textLower.indexOf(firstWord);
    }
    if (pos === -1) {
        return text.substring(0, maxLength) + '...';
    }

    const start = Math.max(0, pos - Math.floor(maxLength / 3));
    const end = Math.min(text.length, start + maxLength);
    let snippet = text.substring(start, end);

    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    return snippet;
}

/**
 * Apply metadata filters to chunks
 * @param {object[]} chunks
 * @param {object} filters
 * @returns {object[]}
 */
function applyFilters(chunks, filters) {
    if (!filters || Object.keys(filters).length === 0) return chunks;

    return chunks.filter(chunk => {
        if (filters.council && chunk.council !== filters.council) return false;
        if (filters.committee && chunk.committee !== filters.committee) return false;
        if (filters.committee_id && chunk.committee_id !== filters.committee_id) return false;
        if (filters.meeting_id && chunk.meeting_id !== filters.meeting_id) return false;

        // Date range filtering (meeting_date is DD/MM/YYYY)
        if (filters.from_date && chunk.meeting_date) {
            if (compareDatesUK(chunk.meeting_date, filters.from_date) < 0) return false;
        }
        if (filters.to_date && chunk.meeting_date) {
            if (compareDatesUK(chunk.meeting_date, filters.to_date) > 0) return false;
        }

        return true;
    });
}

/**
 * Compare two DD/MM/YYYY date strings
 * @returns {number} -1, 0, or 1
 */
function compareDatesUK(a, b) {
    const parseUK = (s) => {
        const [dd, mm, yyyy] = s.split('/');
        return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    };
    try {
        const da = parseUK(a);
        const db = parseUK(b);
        return da < db ? -1 : da > db ? 1 : 0;
    } catch {
        return 0;
    }
}

/**
 * Search across all harvested and chunked documents.
 *
 * @param {object} params
 * @param {string} params.query       - Search query text
 * @param {number} [params.topK]      - Number of results (default 10)
 * @param {object} [params.filters]   - Metadata filters { council, committee, from_date, to_date }
 * @returns {object} Search results with matches and stats
 */
function searchDocuments(params) {
    const { query, topK = 10, filters } = params;

    const allChunks = getCachedIndex();
    if (!allChunks || allChunks.length === 0) {
        return {
            results: [],
            total_chunks: 0,
            error: 'No document index available. Run harvest_documents first to build the search index.'
        };
    }

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return {
            results: [],
            total_chunks: allChunks.length,
            error: 'Search query is required.'
        };
    }

    // Apply metadata filters
    let chunks = applyFilters(allChunks, filters);

    if (chunks.length === 0) {
        return {
            results: [],
            total_chunks: allChunks.length,
            filtered_chunks: 0,
            note: 'No documents match the specified filters.'
        };
    }

    // Tokenize query
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
        return { results: [], total_chunks: allChunks.length };
    }

    // Build IDF and compute average doc length
    const idf = getIDF(allChunks); // IDF over full corpus, not filtered subset
    const totalLength = allChunks.reduce((sum, c) => sum + tokenize(c.text).length, 0);
    const avgDL = totalLength / allChunks.length;

    // Score each chunk
    const scored = chunks.map(chunk => {
        const docTokens = tokenize(chunk.text);
        const bm25 = bm25Score(queryTokens, docTokens, idf, avgDL);
        const kwBoost = keywordBoost(query, chunk.text);
        const metaBoost = metadataBoost(query, chunk);
        const finalScore = bm25 * kwBoost * metaBoost;

        return { chunk, score: finalScore };
    });

    // Sort descending
    scored.sort((a, b) => b.score - a.score);

    // Return top K with snippets
    const results = scored.slice(0, topK).filter(s => s.score > 0).map(item => ({
        snippet: extractSnippet(item.chunk.text, query),
        score: Math.round(item.score * 100) / 100,
        council: item.chunk.council,
        committee: item.chunk.committee,
        meeting_date: item.chunk.meeting_date,
        document_title: item.chunk.document_title,
        document_url: item.chunk.document_url,
        agenda_item: item.chunk.agenda_item,
        attachment_id: item.chunk.attachment_id,
        meeting_id: item.chunk.meeting_id,
        chunk_position: `${item.chunk.chunk_index + 1}/${item.chunk.total_chunks}`
    }));

    return {
        results,
        total_chunks: allChunks.length,
        filtered_chunks: chunks.length,
        query
    };
}

/**
 * Reset IDF cache (for testing or when index is rebuilt)
 */
function resetSearchCache() {
    cachedIDF = null;
    idfBuiltForLength = 0;
}

module.exports = {
    searchDocuments,
    resetSearchCache,
    tokenize
};
