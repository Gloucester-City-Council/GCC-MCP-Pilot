'use strict';

/**
 * Template store — persists custom template registry entries in Azure Blob Storage.
 *
 * Container : web-compiler-templates   (created on first write if absent)
 * Blob name : {template_id}.json       (one blob per template)
 *
 * Base / sample templates are never written here — only custom templates
 * created via the MCP tools.  The compiler merges blob templates over the
 * base set at request time so the base registry remains a safe read-only
 * fallback.
 */

const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER_NAME = 'web-compiler-templates';

// ── Singleton clients (reused across warm invocations) ────────────────────────

let _blobServiceClient = null;
let _containerClient   = null;
let _containerReady    = null;   // Promise<void> — ensures createIfNotExists runs once

function getContainerClient() {
    if (!_blobServiceClient) {
        const cs = process.env.STORAGE_CONNECTION;
        if (!cs) throw new Error('STORAGE_CONNECTION environment variable is not set');
        _blobServiceClient = BlobServiceClient.fromConnectionString(cs);
    }
    if (!_containerClient) {
        _containerClient = _blobServiceClient.getContainerClient(CONTAINER_NAME);
    }
    return _containerClient;
}

async function ensureContainer() {
    if (!_containerReady) {
        const client = getContainerClient();
        _containerReady = client.createIfNotExists().then(() => {});
    }
    return _containerReady;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function blobName(templateId) {
    return `${templateId}.json`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * List all custom templates stored in blob.
 * @returns {Promise<object[]>}  Array of template objects (parsed JSON)
 */
async function listCustomTemplates() {
    await ensureContainer();
    const client    = getContainerClient();
    const templates = [];

    for await (const blob of client.listBlobsFlat()) {
        if (!blob.name.endsWith('.json')) continue;
        const blobClient = client.getBlobClient(blob.name);
        const download   = await blobClient.download();
        const text       = await streamToString(download.readableStreamBody);
        try {
            templates.push(JSON.parse(text));
        } catch {
            // skip malformed blobs
        }
    }

    return templates;
}

/**
 * Fetch a single template by id.
 * @param {string} id
 * @returns {Promise<object|null>}  Template object, or null if not found
 */
async function getTemplate(id) {
    await ensureContainer();
    const client     = getContainerClient();
    const blobClient = client.getBlobClient(blobName(id));

    try {
        const download = await blobClient.download();
        const text     = await streamToString(download.readableStreamBody);
        return JSON.parse(text);
    } catch (err) {
        if (err.statusCode === 404 || err.code === 'BlobNotFound') return null;
        throw err;
    }
}

/**
 * Save (create or overwrite) a template in blob storage.
 * @param {object} template  Must include an `id` string field
 */
async function saveTemplate(template) {
    await ensureContainer();
    const client      = getContainerClient();
    const blockClient = client.getBlockBlobClient(blobName(template.id));
    const content     = JSON.stringify(template, null, 2);

    await blockClient.upload(content, Buffer.byteLength(content), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
    });
}

/**
 * Delete a template by id.
 * @param {string} id
 * @returns {Promise<boolean>}  true if deleted, false if it did not exist
 */
async function deleteTemplate(id) {
    await ensureContainer();
    const client     = getContainerClient();
    const blobClient = client.getBlobClient(blobName(id));

    try {
        await blobClient.delete();
        return true;
    } catch (err) {
        if (err.statusCode === 404 || err.code === 'BlobNotFound') return false;
        throw err;
    }
}

// ── Internal ──────────────────────────────────────────────────────────────────

function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', chunk => chunks.push(chunk.toString()));
        readableStream.on('end',  () => resolve(chunks.join('')));
        readableStream.on('error', reject);
    });
}

module.exports = { listCustomTemplates, getTemplate, saveTemplate, deleteTemplate };
