/**
 * Document Chunker
 * Splits harvested democratic documents into searchable chunks with metadata.
 * Persists the chunk index to disk so it survives Azure Functions cold starts.
 *
 * Storage: cache/document-index/chunks.json  (the searchable index)
 *          cache/document-index/manifest.json (harvest metadata)
 *
 * Strategy:
 * - Split document text into ~500-word chunks with ~50-word overlap
 * - Each chunk carries metadata (council, committee, meeting date, document title, URL)
 * - On harvest, save to disk; on cold start, auto-load from disk
 */

const fs = require('fs');
const path = require('path');

// Cache directory (relative to project root)
const CACHE_DIR = path.join(__dirname, '..', 'cache', 'document-index');

// Module-level in-memory cache (fast access after first load)
let cachedIndex = null;
let cachedManifest = null;

/**
 * Ensure the cache directory exists
 */
function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

/**
 * Split text into overlapping chunks of approximately `chunkSize` words
 * with `overlap` words of overlap between consecutive chunks.
 *
 * @param {string} text - Full document text
 * @param {number} chunkSize - Target words per chunk (default 500)
 * @param {number} overlap - Words of overlap (default 50)
 * @returns {string[]} Array of chunk texts
 */
function splitTextIntoChunks(text, chunkSize = 500, overlap = 50) {
    if (!text || typeof text !== 'string') return [];

    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return [];

    // Small documents get a single chunk
    if (words.length <= chunkSize) {
        return [words.join(' ')];
    }

    const chunks = [];
    let start = 0;

    while (start < words.length) {
        const end = Math.min(start + chunkSize, words.length);
        chunks.push(words.slice(start, end).join(' '));

        // Move forward by (chunkSize - overlap) words
        start += chunkSize - overlap;

        // Avoid tiny trailing chunks
        if (words.length - start < overlap * 2 && start < words.length) {
            chunks.push(words.slice(start).join(' '));
            break;
        }
    }

    return chunks;
}

/**
 * Build a searchable chunk index from an array of harvested documents.
 *
 * @param {object[]} documents - Documents from harvestDocuments()
 * @param {object} [options]
 * @param {number} [options.chunkSize] - Words per chunk (default 500)
 * @param {number} [options.overlap] - Overlap words (default 50)
 * @returns {object[]} Array of chunk objects
 */
function buildDocumentChunkIndex(documents, options = {}) {
    const chunkSize = options.chunkSize || 500;
    const overlap = options.overlap || 50;
    const chunks = [];
    let idCounter = 1;

    for (const doc of documents) {
        const textChunks = splitTextIntoChunks(doc.text, chunkSize, overlap);

        for (let i = 0; i < textChunks.length; i++) {
            chunks.push({
                id: `doc_chunk_${idCounter++}`,
                text: textChunks[i],
                chunk_index: i,
                total_chunks: textChunks.length,

                // Document metadata (carried on every chunk for search results)
                council: doc.council,
                committee: doc.committee,
                committee_id: doc.committee_id,
                meeting_id: doc.meeting_id,
                meeting_date: doc.meeting_date,
                document_title: doc.document_title,
                document_url: doc.document_url,
                agenda_item: doc.agenda_item,
                attachment_id: doc.attachment_id,
                publication_date: doc.publication_date,
                page_count: doc.page_count,
                word_count: doc.word_count
            });
        }
    }

    return chunks;
}

// ─── Persistence ────────────────────────────────────────────────────

/**
 * Save the chunk index and harvest metadata to disk.
 * Called after a successful harvest.
 *
 * @param {object[]} chunks - The chunk index
 * @param {object} harvestStats - Stats from the harvest (date range, councils, etc.)
 */
function saveToDisk(chunks, harvestStats) {
    ensureCacheDir();

    const chunksPath = path.join(CACHE_DIR, 'chunks.json');
    const manifestPath = path.join(CACHE_DIR, 'manifest.json');

    const manifest = {
        harvested_at: new Date().toISOString(),
        total_chunks: chunks.length,
        stats: harvestStats,
        version: 1
    };

    // Write chunks (can be large — write synchronously for simplicity)
    fs.writeFileSync(chunksPath, JSON.stringify(chunks));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(`[document-chunker] Saved ${chunks.length} chunks to ${chunksPath}`);

    // Update in-memory cache
    cachedIndex = chunks;
    cachedManifest = manifest;
}

/**
 * Load the chunk index from disk (if it exists).
 * Called on cold start or first search.
 *
 * @returns {boolean} true if loaded successfully
 */
function loadFromDisk() {
    const chunksPath = path.join(CACHE_DIR, 'chunks.json');
    const manifestPath = path.join(CACHE_DIR, 'manifest.json');

    if (!fs.existsSync(chunksPath)) {
        return false;
    }

    try {
        const chunksData = fs.readFileSync(chunksPath, 'utf8');
        const chunks = JSON.parse(chunksData);

        let manifest = null;
        if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        }

        cachedIndex = chunks;
        cachedManifest = manifest;

        console.log(`[document-chunker] Loaded ${chunks.length} chunks from disk (harvested: ${manifest?.harvested_at || 'unknown'})`);
        return true;
    } catch (err) {
        console.error('[document-chunker] Failed to load cache from disk:', err.message);
        return false;
    }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Set the in-memory cached index (and persist to disk).
 * @param {object[]} chunks
 * @param {object} [harvestStats] - Optional harvest stats for the manifest
 */
function setCachedIndex(chunks, harvestStats) {
    cachedIndex = chunks;
    if (harvestStats) {
        saveToDisk(chunks, harvestStats);
    }
}

/**
 * Get the cached chunk index.
 * On first call, attempts to load from disk if not already in memory.
 * @returns {object[]|null}
 */
function getCachedIndex() {
    if (cachedIndex === null) {
        // Try loading from persistent cache on disk
        loadFromDisk();
    }
    return cachedIndex;
}

/**
 * Get the manifest (harvest metadata) for the current index.
 * @returns {object|null}
 */
function getCachedManifest() {
    if (cachedManifest === null && cachedIndex === null) {
        loadFromDisk();
    }
    return cachedManifest;
}

/**
 * Clear both in-memory and on-disk cache.
 */
function clearCachedIndex() {
    cachedIndex = null;
    cachedManifest = null;

    const chunksPath = path.join(CACHE_DIR, 'chunks.json');
    const manifestPath = path.join(CACHE_DIR, 'manifest.json');

    try { if (fs.existsSync(chunksPath)) fs.unlinkSync(chunksPath); } catch {}
    try { if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath); } catch {}
}

/**
 * Get the path to the cache directory (for diagnostics)
 * @returns {string}
 */
function getCacheDir() {
    return CACHE_DIR;
}

module.exports = {
    splitTextIntoChunks,
    buildDocumentChunkIndex,
    setCachedIndex,
    getCachedIndex,
    getCachedManifest,
    clearCachedIndex,
    getCacheDir,
    saveToDisk,
    loadFromDisk
};
