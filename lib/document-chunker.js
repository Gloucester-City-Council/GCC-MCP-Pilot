/**
 * Document Chunker
 * Splits harvested democratic documents into searchable chunks with metadata.
 *
 * Strategy:
 * - Split document text into ~500-word chunks with ~50-word overlap
 * - Each chunk carries metadata (council, committee, meeting date, document title, URL)
 * - Chunks are the unit of search — search returns chunks with their metadata
 */

// Module-level cache for the built chunk index
let cachedIndex = null;

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

/**
 * Set the cached chunk index (after harvesting + chunking)
 * @param {object[]} chunks
 */
function setCachedIndex(chunks) {
    cachedIndex = chunks;
}

/**
 * Get the cached chunk index
 * @returns {object[]|null}
 */
function getCachedIndex() {
    return cachedIndex;
}

/**
 * Clear the cached index
 */
function clearCachedIndex() {
    cachedIndex = null;
}

module.exports = {
    splitTextIntoChunks,
    buildDocumentChunkIndex,
    setCachedIndex,
    getCachedIndex,
    clearCachedIndex
};
