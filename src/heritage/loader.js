/**
 * Heritage Assets Schema loader - loads the heritage assets schema at cold start
 * Computes SHA-256 hash and extracts version metadata
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Module-level cache for loaded schema
let cachedSchema = null;
let cachedHash = null;
let cachedVersion = null;
let loadError = null;

/**
 * Get the heritage schema file path
 * @returns {string} Path to schema file
 */
function getHeritageSchemaPath() {
    return process.env.MCP_HERITAGE_SCHEMA_PATH || 'schemas/HistoricAssets/heritage-assets-schema-v1.json';
}

/**
 * Load the heritage schema from disk
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
        const schemaPath = getHeritageSchemaPath();
        const absolutePath = path.resolve(process.cwd(), schemaPath);

        const schemaContent = fs.readFileSync(absolutePath, 'utf8');
        cachedSchema = JSON.parse(schemaContent);

        // Compute SHA-256 hash
        const hash = crypto.createHash('sha256');
        hash.update(schemaContent);
        cachedHash = 'sha256:' + hash.digest('hex');

        // Extract version from schema
        if (cachedSchema.version) {
            cachedVersion = cachedSchema.version;
        } else {
            cachedVersion = 'unknown';
        }

        console.log(`Heritage schema loaded: version=${cachedVersion}, hash=${cachedHash.substring(0, 20)}...`);

        return cachedSchema;
    } catch (err) {
        loadError = err;
        console.error('Failed to load heritage schema:', err.message);
        return null;
    }
}

/**
 * Get the heritage schema (loads if not already loaded)
 * @returns {object|null} Schema object or null if load failed
 */
function getSchema() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedSchema;
}

/**
 * Get the heritage schema hash
 * @returns {string|null} SHA-256 hash or null if not loaded
 */
function getSchemaHash() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedHash;
}

/**
 * Get the heritage schema version
 * @returns {string|null} Schema version or null if not loaded
 */
function getSchemaVersion() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedVersion;
}

/**
 * Check if heritage schema is loaded successfully
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
 * Force reload of the heritage schema (for testing)
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
    reloadSchema,
    getHeritageSchemaPath
};
