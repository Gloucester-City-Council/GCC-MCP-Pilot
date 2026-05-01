'use strict';

/**
 * ct_search tool — BM25-lite search across the revised council tax schema.
 * Self-contained: chunks the revised schema and scores against the query.
 */

const { ERROR_CODES, createError, createSuccess } = require('../util/errors');
const { getSchema, isSchemaLoaded } = require('../schema/revisedLoader');

// ─── Chunker ──────────────────────────────────────────────────────────────────

let cachedChunks = null;

function extractText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(extractText).join(' ');
    if (typeof value === 'object') return Object.values(value).map(extractText).join(' ');
    return '';
}

function chunkObject(obj, pathTokens, chunks, maxDepth = 4) {
    if (maxDepth <= 0 || obj === null || obj === undefined) return;

    const section = pathTokens.length > 0 ? pathTokens[0] : 'root';
    const jsonPath = pathTokens.length > 0 ? '/' + pathTokens.join('/') : '/';

    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            chunkObject(obj[i], [...pathTokens, String(i)], chunks, maxDepth - 1);
        }
        return;
    }

    if (typeof obj === 'object') {
        // Emit a chunk for named objects with a meaningful text field
        const text = extractText(obj);
        if (text.length > 20) {
            chunks.push({ jsonPath, section, text: text.substring(0, 2000) });
        }
        // Recurse into each key
        for (const [key, val] of Object.entries(obj)) {
            if (typeof val === 'object' && val !== null) {
                chunkObject(val, [...pathTokens, key], chunks, maxDepth - 1);
            }
        }
    }
}

function buildChunks(schema) {
    const chunks = [];
    const topSections = [
        'discounts', 'exemptions', 'premiums', 'council_tax_support',
        'liability', 'enforcement', 'appeals', 'valuation', 'vocabulary',
        'calculation_sequence', 'conflict_resolution', 'human_review_gates',
        'channel_overlay', 'chatbot_overlay', 'authority',
    ];
    for (const section of topSections) {
        if (schema[section]) {
            chunkObject(schema[section], [section], chunks, 4);
        }
    }
    return chunks;
}

function getChunks() {
    if (cachedChunks !== null) return cachedChunks;
    const schema = getSchema();
    if (!schema) return [];
    cachedChunks = buildChunks(schema);
    return cachedChunks;
}

// ─── BM25-lite search ────────────────────────────────────────────────────────

function tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 0);
}

function calculateTF(tokens) {
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
    return tf;
}

function buildIDF(chunks) {
    const docFreq = new Map();
    const n = chunks.length;
    for (const chunk of chunks) {
        for (const token of new Set(tokenize(chunk.text))) {
            docFreq.set(token, (docFreq.get(token) || 0) + 1);
        }
    }
    const idf = new Map();
    for (const [term, df] of docFreq) {
        idf.set(term, Math.log((n - df + 0.5) / (df + 0.5) + 1));
    }
    return idf;
}

function bm25Score(queryTokens, docTokens, idf, avgDL, k1 = 1.5, b = 0.75) {
    const docLength = docTokens.length;
    const tf = calculateTF(docTokens);
    let score = 0;
    for (const qToken of queryTokens) {
        const termFreq = tf.get(qToken) || 0;
        if (termFreq === 0) continue;
        const idfValue = idf.get(qToken) || 0;
        score += idfValue * (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * (docLength / avgDL)));
    }
    return score;
}

function keywordBoost(query, text) {
    const qLower = query.toLowerCase();
    const tLower = text.toLowerCase();
    let boost = 1.0;
    if (tLower.includes(qLower)) boost += 0.5;
    const queryWords = qLower.split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length > 0) {
        const matched = queryWords.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(tLower)).length;
        boost += 0.3 * (matched / queryWords.length);
    }
    return boost;
}

function extractSnippet(text, query, maxLength = 200) {
    if (!text || text.length <= maxLength) return text || '';
    const tLower = text.toLowerCase();
    let pos = tLower.indexOf(query.toLowerCase());
    if (pos === -1) pos = tLower.indexOf(query.toLowerCase().split(/\s+/)[0]);
    if (pos === -1) return text.substring(0, maxLength) + '...';
    const start = Math.max(0, pos - Math.floor(maxLength / 2));
    const end = Math.min(text.length, start + maxLength);
    return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
}

function searchChunks({ text, scope, topK = 5, filters }) {
    let chunks = getChunks();
    if (scope && scope.length > 0) chunks = chunks.filter(c => scope.includes(c.section));
    if (filters && filters.section) chunks = chunks.filter(c => c.section === filters.section);
    if (chunks.length === 0) return [];

    const queryTokens = tokenize(text);
    if (queryTokens.length === 0) return [];

    const allChunks = getChunks();
    const idf = buildIDF(allChunks);
    const avgDL = allChunks.reduce((s, c) => s + tokenize(c.text).length, 0) / allChunks.length;

    const scored = chunks.map(chunk => {
        const docTokens = tokenize(chunk.text);
        const score = bm25Score(queryTokens, docTokens, idf, avgDL) * keywordBoost(text, chunk.text);
        return { chunk, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map(({ chunk, score }) => ({
        snippet: extractSnippet(chunk.text, text),
        jsonPath: chunk.jsonPath,
        section: chunk.section,
        score: Math.round(score * 100) / 100,
    }));
}

// ─── Tool entry point ────────────────────────────────────────────────────────

function execute(input = {}) {
    if (!isSchemaLoaded()) {
        return createError(ERROR_CODES.SCHEMA_LOAD_FAILED, 'Revised council tax schema could not be loaded');
    }

    const { text, scope, topK = 5, filters } = input;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return createError(ERROR_CODES.BAD_REQUEST, 'Missing or empty "text" parameter');
    }
    if (scope !== undefined && !Array.isArray(scope)) {
        return createError(ERROR_CODES.BAD_REQUEST, '"scope" must be an array of section names');
    }
    if (filters !== undefined && (typeof filters !== 'object' || filters === null)) {
        return createError(ERROR_CODES.BAD_REQUEST, '"filters" must be an object');
    }

    try {
        const results = searchChunks({
            text: text.trim(),
            scope,
            topK: Math.max(1, Math.min(topK, 50)),
            filters,
        });
        return createSuccess({ results, query: text.trim(), scope: scope || [], filters: filters || {} });
    } catch (err) {
        return createError(ERROR_CODES.INTERNAL_ERROR, `Search failed: ${err.message}`);
    }
}

module.exports = { execute };
