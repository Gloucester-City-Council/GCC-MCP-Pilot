/**
 * Standardized error codes and error handling for MCP Schema API
 */

const ERROR_CODES = {
    BAD_REQUEST: 'BAD_REQUEST',
    UNKNOWN_TOOL: 'UNKNOWN_TOOL',
    INVALID_PATH: 'INVALID_PATH',
    FORBIDDEN_PATH: 'FORBIDDEN_PATH',
    NOT_FOUND: 'NOT_FOUND',
    SCHEMA_LOAD_FAILED: 'SCHEMA_LOAD_FAILED',
    INTERNAL_ERROR: 'INTERNAL_ERROR'
};

/**
 * Create a standardized error response
 * @param {string} code - One of ERROR_CODES
 * @param {string} message - Human-readable error message
 * @param {object} [details] - Additional error details
 * @returns {object} Error response object
 */
function createError(code, message, details = {}) {
    return {
        ok: false,
        error: {
            code,
            message,
            details
        }
    };
}

/**
 * Create a standardized success response
 * @param {*} result - The result data
 * @returns {object} Success response object
 */
function createSuccess(result) {
    return {
        ok: true,
        result
    };
}

/**
 * Validate that required fields exist in an object
 * @param {object} obj - Object to validate
 * @param {string[]} fields - Required field names
 * @returns {string|null} Error message or null if valid
 */
function validateRequired(obj, fields) {
    for (const field of fields) {
        if (obj[field] === undefined || obj[field] === null) {
            return `Missing required field: ${field}`;
        }
    }
    return null;
}

module.exports = {
    ERROR_CODES,
    createError,
    createSuccess,
    validateRequired
};
