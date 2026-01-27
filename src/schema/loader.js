/**
 * Schema loader - loads the council tax schema at cold start
 * Computes SHA-256 hash and extracts version metadata
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getSchemaPath } = require('../util/config');

// Module-level cache for loaded schema
let cachedSchema = null;
let cachedHash = null;
let cachedVersion = null;
let loadError = null;

/**
 * Load the schema from disk
 * @returns {object|null} Loaded schema or null on error
 */
function loadSchema() {
    if (cachedSchema !== null) {
        return cachedSchema;
    }

    if (loadError !== null) {
        return null;
    }

    try {
        const schemaPath = getSchemaPath();
        const absolutePath = path.resolve(process.cwd(), schemaPath);

        const schemaContent = fs.readFileSync(absolutePath, 'utf8');
        cachedSchema = JSON.parse(schemaContent);

        // Compute SHA-256 hash
        const hash = crypto.createHash('sha256');
        hash.update(schemaContent);
        cachedHash = 'sha256:' + hash.digest('hex');

        // Extract version from schema metadata
        if (cachedSchema.schema_metadata && cachedSchema.schema_metadata.schema_version) {
            cachedVersion = cachedSchema.schema_metadata.schema_version;
        } else {
            cachedVersion = 'unknown';
        }

        console.log(`Schema loaded: version=${cachedVersion}, hash=${cachedHash.substring(0, 20)}...`);

        return cachedSchema;
    } catch (err) {
        loadError = err;
        console.error('Failed to load schema:', err.message);
        return null;
    }
}

/**
 * Get the schema (loads if not already loaded)
 * @returns {object|null} Schema object or null if load failed
 */
function getSchema() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedSchema;
}

/**
 * Get the schema hash
 * @returns {string|null} SHA-256 hash or null if not loaded
 */
function getSchemaHash() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedHash;
}

/**
 * Get the schema version
 * @returns {string|null} Schema version or null if not loaded
 */
function getSchemaVersion() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedVersion;
}

/**
 * Check if schema is loaded successfully
 * @returns {boolean} True if loaded
 */
function isSchemaLoaded() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedSchema !== null;
}

/**
 * Get the load error if any
 * @returns {Error|null} Load error or null
 */
function getLoadError() {
    return loadError;
}

/**
 * Force reload of the schema (for testing)
 */
function reloadSchema() {
    cachedSchema = null;
    cachedHash = null;
    cachedVersion = null;
    loadError = null;
    return loadSchema();
}

module.exports = {
    getSchema,
    getSchemaHash,
    getSchemaVersion,
    isSchemaLoaded,
    getLoadError,
    reloadSchema
};
