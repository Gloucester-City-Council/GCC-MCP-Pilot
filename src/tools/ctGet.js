'use strict';

/**
 * ct_get tool — retrieve data from the revised council tax schema by JSON Pointer path.
 */

const { ERROR_CODES, createError, createSuccess } = require('../util/errors');
const { getMaxBytes } = require('../util/config');
const { getSchema, getSchemaHash, getSchemaVersion } = require('../schema/revisedLoader');
const { resolvePointer, isPathAllowed } = require('../schema/pointer');

const REVISED_ALLOWLIST = [
    '/authority',
    '/valuation',
    '/discounts',
    '/exemptions',
    '/premiums',
    '/council_tax_support',
    '/liability',
    '/enforcement',
    '/appeals',
    '/calculation_sequence',
    '/conflict_resolution',
    '/human_review_gates',
    '/executable_rules',
    '/narrative_rules',
    '/vocabulary',
    '/channel_overlay',
    '/chatbot_overlay',
];

function applyProjection(data, projection) {
    if (!projection || projection.length === 0) return data;
    if (typeof data !== 'object' || data === null) return data;
    if (Array.isArray(data)) return data.map(item => applyProjection(item, projection));
    const result = {};
    for (const field of projection) {
        if (Object.prototype.hasOwnProperty.call(data, field)) {
            result[field] = data[field];
        }
    }
    return result;
}

function truncateToBytes(data, maxBytes) {
    const json = JSON.stringify(data);
    const bytes = Buffer.byteLength(json, 'utf8');
    if (bytes <= maxBytes) return { data, truncated: false, totalBytes: bytes };
    const preview = json.substring(0, Math.min(1000, maxBytes / 2));
    return {
        data: null,
        truncated: true,
        preview: preview + '...',
        omittedBytes: bytes - preview.length,
        totalBytes: bytes,
    };
}

function execute(input = {}) {
    const schema = getSchema();
    if (!schema) {
        return createError(ERROR_CODES.SCHEMA_LOAD_FAILED, 'Revised council tax schema could not be loaded');
    }

    const path = input.path || '';
    const projection = input.projection || [];
    const maxBytes = input.maxBytes || getMaxBytes();

    if (path !== '' && !isPathAllowed(path, REVISED_ALLOWLIST)) {
        return createError(
            ERROR_CODES.FORBIDDEN_PATH,
            `Path "${path}" is not in the allowlist`,
            { allowedPaths: REVISED_ALLOWLIST }
        );
    }

    let resolved;
    try {
        resolved = resolvePointer(schema, path);
    } catch (err) {
        return createError(ERROR_CODES.INVALID_PATH, `Invalid JSON Pointer: ${err.message}`, { path });
    }

    if (!resolved.found) {
        return createError(ERROR_CODES.NOT_FOUND, `Path "${path}" not found in schema`, { path });
    }

    let data = resolved.value;
    if (projection.length > 0) data = applyProjection(data, projection);

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
            totalBytes: truncated.totalBytes,
        });
    }

    return createSuccess({
        data: truncated.data,
        jsonPath: path,
        schemaVersion: getSchemaVersion(),
        hash: getSchemaHash(),
        truncated: false,
    });
}

module.exports = { execute, REVISED_ALLOWLIST };
