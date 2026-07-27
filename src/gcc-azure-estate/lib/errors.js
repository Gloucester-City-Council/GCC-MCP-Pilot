/**
 * Standardized error codes and error handling for the Azure Estate MCP.
 * Mirrors src/util/errors.js's {ok,result}/{ok:false,error} contract.
 */

'use strict';

const ERROR_CODES = {
    BAD_REQUEST: 'BAD_REQUEST',
    UNKNOWN_TOOL: 'UNKNOWN_TOOL',
    UNKNOWN_INSTANCE: 'UNKNOWN_INSTANCE',
    NOT_FOUND: 'NOT_FOUND',
    FORBIDDEN: 'FORBIDDEN',
    CONFLICT: 'CONFLICT',
    PARTITION_KEY_IMMUTABLE: 'PARTITION_KEY_IMMUTABLE',
    PLAN_CONFLICT: 'PLAN_CONFLICT',
    DEPENDENCY_MISSING: 'DEPENDENCY_MISSING',
    INVALID_CONTRACT: 'INVALID_CONTRACT',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
};

class AzureEstateError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'AzureEstateError';
        this.code = code;
        this.details = details;
    }
}

function createError(code, message, details = {}) {
    return { ok: false, error: { code, message, details } };
}

function createSuccess(result) {
    return { ok: true, result };
}

function validateRequired(obj, fields) {
    for (const field of fields) {
        if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
            return `Missing required field: ${field}`;
        }
    }
    return null;
}

module.exports = {
    ERROR_CODES,
    AzureEstateError,
    createError,
    createSuccess,
    validateRequired,
};
