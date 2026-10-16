/**
 * Live badge store, backed by Blob Storage.
 *
 * Uses the same STORAGE_CONNECTION setting as mcpNotes. One blob per badge at
 * badges/<key>.json inside the MCP_SHIELDS_CONTAINER container (default
 * "mcp-shields"). The container is created on first use.
 *
 * The deployed package is read-only (WEBSITE_RUN_FROM_PACKAGE=1), so nothing
 * here writes to local disk.
 *
 * Keys are stored lower-case, so "Walker-Runs" and "walker-runs" are the
 * same badge.
 */

'use strict';

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PREFIX = 'badges/';
const MAX_LIST = 200;
const READ_CONCURRENCY = 8;

function normaliseKey(key) {
    const k = typeof key === 'string' ? key.trim().toLowerCase() : '';
    if (!KEY_PATTERN.test(k)) {
        throw new Error(`Key "${key}" must be 1-64 characters: letters, digits, dot, underscore or hyphen, starting with a letter or digit.`);
    }
    return k;
}

function isNotFound(err) {
    return !!err && (err.statusCode === 404 || err.code === 'BlobNotFound');
}

async function streamToString(readable) {
    const chunks = [];
    for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
}

let _defaultContainerClient = null;

function getDefaultContainerClient() {
    if (!_defaultContainerClient) {
        const cs = process.env.STORAGE_CONNECTION;
        if (!cs) throw new Error('STORAGE_CONNECTION is not set. Live badges need the same storage connection mcpNotes uses.');
        // Required lazily so unit tests and module loading never touch the SDK.
        const { BlobServiceClient } = require('@azure/storage-blob');
        _defaultContainerClient = BlobServiceClient.fromConnectionString(cs)
            .getContainerClient(process.env.MCP_SHIELDS_CONTAINER || 'mcp-shields');
    }
    return _defaultContainerClient;
}

/**
 * @param {{ containerClient?: object }} [options] Inject a container client in tests.
 */
function createStore(options = {}) {
    let ready = null;

    function container() {
        return options.containerClient || getDefaultContainerClient();
    }

    async function ensureContainer() {
        const c = container();
        if (!ready) {
            ready = c.createIfNotExists().catch((err) => {
                ready = null;
                throw err;
            });
        }
        await ready;
        return c;
    }

    async function read(c, name) {
        try {
            const download = await c.getBlobClient(name).download();
            return JSON.parse(await streamToString(download.readableStreamBody));
        } catch (err) {
            if (isNotFound(err)) return undefined;
            throw err;
        }
    }

    return {
        async get(key) {
            const k = normaliseKey(key);
            return read(await ensureContainer(), `${PREFIX}${k}.json`);
        },

        async set(key, entry, now = new Date()) {
            const k = normaliseKey(key);
            const full = {
                label: entry.label,
                message: entry.message,
                color: entry.color,
                updated: now.toISOString(),
            };
            const content = JSON.stringify(full);
            const c = await ensureContainer();
            await c.getBlockBlobClient(`${PREFIX}${k}.json`).upload(content, Buffer.byteLength(content), {
                blobHTTPHeaders: { blobContentType: 'application/json' },
            });
            return full;
        },

        async delete(key) {
            const k = normaliseKey(key);
            const c = await ensureContainer();
            const res = await c.getBlobClient(`${PREFIX}${k}.json`).deleteIfExists();
            return !!res.succeeded;
        },

        async list() {
            const c = await ensureContainer();
            const names = [];
            for await (const blob of c.listBlobsFlat({ prefix: PREFIX })) {
                names.push(blob.name);
                if (names.length >= MAX_LIST) break;
            }
            const out = [];
            for (let i = 0; i < names.length; i += READ_CONCURRENCY) {
                const batch = names.slice(i, i + READ_CONCURRENCY);
                const entries = await Promise.all(batch.map((n) => read(c, n)));
                batch.forEach((n, j) => {
                    if (entries[j]) out.push([n.slice(PREFIX.length, -'.json'.length), entries[j]]);
                });
            }
            return out.sort(([a], [b]) => a.localeCompare(b));
        },
    };
}

/** The JSON document Shields' /endpoint badge reads. */
function endpointJson(entry) {
    return { schemaVersion: 1, label: entry.label, message: entry.message, color: entry.color };
}

module.exports = { createStore, endpointJson, normaliseKey, MAX_LIST };
