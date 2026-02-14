/**
 * Document Chunker
 * Splits harvested democratic documents into searchable chunks with metadata.
 * Persists the chunk index to disk so it survives Azure Functions cold starts.
 *
 * Storage layout (gzip-compressed):
 *   cache/document-index/documents.json.gz  — document texts + metadata (stored once per doc)
 *   cache/document-index/chunks.json.gz     — lightweight chunk pointers (doc index + word offsets)
 *   cache/document-index/manifest.json      — harvest metadata (small, kept readable)
 *
 * On load, full chunk objects are reconstructed in memory by slicing document
 * text at the recorded word offsets. This avoids duplicating text on disk while
 * keeping the in-memory index ready for BM25 search.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
 * Compute word offsets for chunks (mirrors splitTextIntoChunks logic but
 * returns start/end indices instead of text).
 *
 * @param {number} wordCount - Total words in the document
 * @param {number} chunkSize
 * @param {number} overlap
 * @returns {{start: number, end: number}[]}
 */
function computeChunkOffsets(wordCount, chunkSize = 500, overlap = 50) {
    if (wordCount === 0) return [];
    if (wordCount <= chunkSize) return [{ start: 0, end: wordCount }];

    const offsets = [];
    let start = 0;

    while (start < wordCount) {
        const end = Math.min(start + chunkSize, wordCount);
        offsets.push({ start, end });

        start += chunkSize - overlap;

        if (wordCount - start < overlap * 2 && start < wordCount) {
            offsets.push({ start, end: wordCount });
            break;
        }
    }

    return offsets;
}

/**
 * Build a searchable chunk index from an array of harvested documents.
 *
 * @param {object[]} documents - Documents from harvestDocuments()
 * @param {object} [options]
 * @param {number} [options.chunkSize] - Words per chunk (default 500)
 * @param {number} [options.overlap] - Overlap words (default 50)
 * @returns {object[]} Array of chunk objects (full, in-memory format)
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

// ─── Compact serialisation ──────────────────────────────────────────
//
// On disk we store two gzipped files:
//   documents.json.gz — each document's text + metadata, stored ONCE
//   chunks.json.gz    — lightweight pointers { doc_index, word_start, word_end }
//
// This avoids duplicating 500 words of text per chunk on disk.

/**
 * Convert harvested documents + chunk index into compact disk format.
 *
 * @param {object[]} documents - Raw harvested documents (with .text)
 * @param {object[]} chunks - Full chunk objects from buildDocumentChunkIndex
 * @returns {{ docStore: object[], chunkPointers: object[] }}
 */
function toCompactFormat(documents, chunks) {
    // Build a map from attachment_id → document index for fast lookup
    const attachmentToIdx = new Map();
    const docStore = documents.map((doc, idx) => {
        attachmentToIdx.set(doc.attachment_id, idx);
        return {
            t: doc.text,
            c: doc.council,
            cm: doc.committee,
            ci: doc.committee_id,
            mi: doc.meeting_id,
            md: doc.meeting_date,
            dt: doc.document_title,
            du: doc.document_url,
            ai: doc.agenda_item,
            at: doc.attachment_id,
            pd: doc.publication_date,
            pc: doc.page_count,
            wc: doc.word_count
        };
    });

    // For each chunk, record which document it belongs to and the word offsets
    const chunkPointers = [];
    for (const chunk of chunks) {
        const docIdx = attachmentToIdx.get(chunk.attachment_id);
        if (docIdx === undefined) continue;

        // Recover word offsets by splitting the doc text and finding the chunk's position
        const docWords = documents[docIdx].text.split(/\s+/).filter(w => w.length > 0);
        const chunkWords = chunk.text.split(/\s+/).filter(w => w.length > 0);

        // Use chunk_index + total_chunks to compute offsets deterministically
        const offsets = computeChunkOffsets(docWords.length);
        const offset = offsets[chunk.chunk_index] || { start: 0, end: docWords.length };

        chunkPointers.push({
            d: docIdx,           // document index
            s: offset.start,     // word start
            e: offset.end,       // word end
            ci: chunk.chunk_index,
            tc: chunk.total_chunks
        });
    }

    return { docStore, chunkPointers };
}

/**
 * Reconstruct full chunk objects from compact disk format.
 *
 * @param {object[]} docStore - Compact document store
 * @param {object[]} chunkPointers - Compact chunk pointers
 * @returns {object[]} Full chunk objects (same format as buildDocumentChunkIndex output)
 */
function fromCompactFormat(docStore, chunkPointers) {
    // Pre-split all document texts into word arrays (once each)
    const docWordArrays = docStore.map(d => d.t.split(/\s+/).filter(w => w.length > 0));

    const chunks = [];
    let idCounter = 1;

    for (const ptr of chunkPointers) {
        const doc = docStore[ptr.d];
        const words = docWordArrays[ptr.d];
        const chunkText = words.slice(ptr.s, ptr.e).join(' ');

        chunks.push({
            id: `doc_chunk_${idCounter++}`,
            text: chunkText,
            chunk_index: ptr.ci,
            total_chunks: ptr.tc,
            council: doc.c,
            committee: doc.cm,
            committee_id: doc.ci,
            meeting_id: doc.mi,
            meeting_date: doc.md,
            document_title: doc.dt,
            document_url: doc.du,
            agenda_item: doc.ai,
            attachment_id: doc.at,
            publication_date: doc.pd,
            page_count: doc.pc,
            word_count: doc.wc
        });
    }

    return chunks;
}

// ─── Persistence (gzip compressed) ──────────────────────────────────

/**
 * Save the chunk index and harvest metadata to disk in compact gzip format.
 * Called after a successful harvest.
 *
 * @param {object[]} chunks - The full in-memory chunk index
 * @param {object[]} documents - The raw harvested documents (with .text)
 * @param {object} harvestStats - Stats from the harvest
 */
function saveToDisk(chunks, documents, harvestStats) {
    ensureCacheDir();

    const docsPath = path.join(CACHE_DIR, 'documents.json.gz');
    const chunksPath = path.join(CACHE_DIR, 'chunks.json.gz');
    const manifestPath = path.join(CACHE_DIR, 'manifest.json');

    // Convert to compact format
    const { docStore, chunkPointers } = toCompactFormat(documents, chunks);

    // Gzip compress and write
    const docsGz = zlib.gzipSync(JSON.stringify(docStore));
    const chunksGz = zlib.gzipSync(JSON.stringify(chunkPointers));

    const manifest = {
        harvested_at: new Date().toISOString(),
        total_documents: documents.length,
        total_chunks: chunks.length,
        stats: harvestStats,
        cache_size: {
            documents_gz_bytes: docsGz.length,
            chunks_gz_bytes: chunksGz.length,
            total_bytes: docsGz.length + chunksGz.length,
            total_readable: formatBytes(docsGz.length + chunksGz.length)
        },
        version: 2
    };

    fs.writeFileSync(docsPath, docsGz);
    fs.writeFileSync(chunksPath, chunksGz);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(`[document-chunker] Saved ${documents.length} docs / ${chunks.length} chunks to disk (${manifest.cache_size.total_readable} compressed)`);

    // Update in-memory cache
    cachedIndex = chunks;
    cachedManifest = manifest;
}

/**
 * Load the chunk index from disk (gzip-compressed compact format).
 * Called on cold start or first search.
 *
 * @returns {boolean} true if loaded successfully
 */
function loadFromDisk() {
    const docsPath = path.join(CACHE_DIR, 'documents.json.gz');
    const chunksPath = path.join(CACHE_DIR, 'chunks.json.gz');
    const manifestPath = path.join(CACHE_DIR, 'manifest.json');

    if (!fs.existsSync(docsPath) || !fs.existsSync(chunksPath)) {
        return false;
    }

    try {
        // Decompress and parse
        const docStore = JSON.parse(zlib.gunzipSync(fs.readFileSync(docsPath)).toString());
        const chunkPointers = JSON.parse(zlib.gunzipSync(fs.readFileSync(chunksPath)).toString());

        // Reconstruct full chunk objects
        const chunks = fromCompactFormat(docStore, chunkPointers);

        let manifest = null;
        if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        }

        cachedIndex = chunks;
        cachedManifest = manifest;

        console.log(`[document-chunker] Loaded ${chunks.length} chunks from disk (harvested: ${manifest?.harvested_at || 'unknown'}, size: ${manifest?.cache_size?.total_readable || 'unknown'})`);
        return true;
    } catch (err) {
        console.error('[document-chunker] Failed to load cache from disk:', err.message);
        return false;
    }
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Set the in-memory cached index (and optionally persist to disk).
 * @param {object[]} chunks - Full chunk objects
 * @param {object} [harvestStats] - Harvest stats for the manifest
 * @param {object[]} [documents] - Raw documents (needed for compact disk storage)
 */
function setCachedIndex(chunks, harvestStats, documents) {
    cachedIndex = chunks;
    if (harvestStats && documents) {
        saveToDisk(chunks, documents, harvestStats);
    }
}

/**
 * Get the cached chunk index.
 * On first call, attempts to load from disk if not already in memory.
 * @returns {object[]|null}
 */
function getCachedIndex() {
    if (cachedIndex === null) {
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

    const files = ['documents.json.gz', 'chunks.json.gz', 'manifest.json'];
    for (const file of files) {
        const p = path.join(CACHE_DIR, file);
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
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
