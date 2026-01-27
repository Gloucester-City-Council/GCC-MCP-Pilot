/**
 * schema.get tool - Retrieve data from schema by JSON Pointer path
 */

const { ERROR_CODES, createError, createSuccess } = require('../util/errors');
const { getSchemaAllowlist, getMaxBytes } = require('../util/config');
const { getSchema, getSchemaHash, getSchemaVersion } = require('../schema/loader');
const { resolvePointer, isPathAllowed } = require('../schema/pointer');

/**
 * Apply projection to data (keep only specified fields)
 * @param {*} data - Data to project
 * @param {string[]} projection - Fields to keep
 * @returns {*} Projected data
 */
function applyProjection(data, projection) {
    if (!projection || projection.length === 0) {
        return data;
    }

    if (typeof data !== 'object' || data === null) {
        return data;
    }

    if (Array.isArray(data)) {
        return data.map(item => applyProjection(item, projection));
    }

    const result = {};
    for (const field of projection) {
        if (Object.prototype.hasOwnProperty.call(data, field)) {
            result[field] = data[field];
        }
    }
    return result;
}

/**
 * Truncate data to fit within byte limit
 * @param {*} data - Data to truncate
 * @param {number} maxBytes - Maximum bytes
 * @returns {object} Result with truncation info
 */
function truncateToBytes(data, maxBytes) {
    const json = JSON.stringify(data);
    const bytes = Buffer.byteLength(json, 'utf8');

    if (bytes <= maxBytes) {
        return {
            data,
            truncated: false,
            totalBytes: bytes
        };
    }

    // Create a preview by taking a portion of the data
    const preview = json.substring(0, Math.min(1000, maxBytes / 2));

    return {
        data: null,
        truncated: true,
        preview: preview + '...',
        omittedBytes: bytes - preview.length,
        totalBytes: bytes
    };
}

/**
 * Execute the schema.get tool
 * @param {object} input - Tool input
 * @param {string} [input.path] - JSON Pointer path (default "")
 * @param {string[]} [input.projection] - Fields to include
 * @param {number} [input.maxBytes] - Maximum response bytes
 * @returns {object} Tool result
 */
function execute(input = {}) {
    const schema = getSchema();

    if (!schema) {
        return createError(
            ERROR_CODES.SCHEMA_LOAD_FAILED,
            'Schema could not be loaded'
        );
    }

    const path = input.path || '';
    const projection = input.projection || [];
    const maxBytes = input.maxBytes || getMaxBytes();

    // Validate path is allowed
    const allowlist = getSchemaAllowlist();
    if (path !== '' && !isPathAllowed(path, allowlist)) {
        return createError(
            ERROR_CODES.FORBIDDEN_PATH,
            `Path "${path}" is not in the allowlist`,
            { allowedPaths: allowlist }
        );
    }

    // Resolve the path
    let resolved;
    try {
        resolved = resolvePointer(schema, path);
    } catch (err) {
        return createError(
            ERROR_CODES.INVALID_PATH,
            `Invalid JSON Pointer: ${err.message}`,
            { path }
        );
    }

    if (!resolved.found) {
        return createError(
            ERROR_CODES.NOT_FOUND,
            `Path "${path}" not found in schema`,
            { path }
        );
    }

    // Apply projection
    let data = resolved.value;
    if (projection.length > 0) {
        data = applyProjection(data, projection);
    }

    // Check size and truncate if needed
    const truncated = truncateToBytes(data, maxBytes);

    if (truncated.truncated) {
        return createSuccess({
            data: null,
            jsonPath: path,
            schemaVersion: getSchemaVersion(),
            hash: getSchemaHash(),
            truncated: true,
            preview: truncated.preview,
            omittedBytes: truncated.omittedBytes,
            totalBytes: truncated.totalBytes
        });
    }

    return createSuccess({
        data: truncated.data,
        jsonPath: path,
        schemaVersion: getSchemaVersion(),
        hash: getSchemaHash(),
        truncated: false
    });
}

module.exports = { execute };
