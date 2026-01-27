/**
 * JSON Pointer (RFC 6901) implementation
 * Supports navigating schema by path like "/discounts/person_based_discounts/0"
 */

/**
 * Decode a JSON Pointer token (RFC 6901)
 * ~1 -> /
 * ~0 -> ~
 * @param {string} token - Encoded token
 * @returns {string} Decoded token
 */
function decodeToken(token) {
    return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Encode a JSON Pointer token (RFC 6901)
 * ~ -> ~0
 * / -> ~1
 * @param {string} token - Raw token
 * @returns {string} Encoded token
 */
function encodeToken(token) {
    return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Parse a JSON Pointer string into tokens
 * @param {string} pointer - JSON Pointer string (e.g., "/foo/bar/0")
 * @returns {string[]} Array of tokens
 * @throws {Error} If pointer is invalid
 */
function parsePointer(pointer) {
    if (pointer === '') {
        return [];
    }

    if (pointer[0] !== '/') {
        throw new Error('Invalid JSON Pointer: must start with / or be empty string');
    }

    const tokens = pointer.substring(1).split('/');
    return tokens.map(decodeToken);
}

/**
 * Build a JSON Pointer string from tokens
 * @param {string[]} tokens - Array of tokens
 * @returns {string} JSON Pointer string
 */
function buildPointer(tokens) {
    if (tokens.length === 0) {
        return '';
    }
    return '/' + tokens.map(encodeToken).join('/');
}

/**
 * Resolve a JSON Pointer against an object
 * @param {object} obj - The object to navigate
 * @param {string} pointer - JSON Pointer string
 * @returns {object} Result with { found: boolean, value: any, parent: any, key: string }
 */
function resolvePointer(obj, pointer) {
    const tokens = parsePointer(pointer);

    if (tokens.length === 0) {
        return { found: true, value: obj, parent: null, key: null };
    }

    let current = obj;
    let parent = null;
    let lastKey = null;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        parent = current;
        lastKey = token;

        if (current === null || current === undefined) {
            return { found: false, value: undefined, parent, key: lastKey };
        }

        if (Array.isArray(current)) {
            // Array access - token must be a non-negative integer or "-"
            if (token === '-') {
                // "-" refers to element past end (for appending)
                return { found: false, value: undefined, parent, key: token };
            }
            const index = parseInt(token, 10);
            if (isNaN(index) || index < 0 || index.toString() !== token) {
                return { found: false, value: undefined, parent, key: token };
            }
            if (index >= current.length) {
                return { found: false, value: undefined, parent, key: token };
            }
            current = current[index];
        } else if (typeof current === 'object') {
            if (!Object.prototype.hasOwnProperty.call(current, token)) {
                return { found: false, value: undefined, parent, key: token };
            }
            current = current[token];
        } else {
            return { found: false, value: undefined, parent, key: token };
        }
    }

    return { found: true, value: current, parent, key: lastKey };
}

/**
 * Get the top-level path from a JSON Pointer
 * @param {string} pointer - JSON Pointer string
 * @returns {string} Top-level path (e.g., "/discounts" from "/discounts/person_based_discounts/0")
 */
function getTopLevelPath(pointer) {
    const tokens = parsePointer(pointer);
    if (tokens.length === 0) {
        return '';
    }
    return '/' + encodeToken(tokens[0]);
}

/**
 * Check if a pointer starts with one of the allowed prefixes
 * @param {string} pointer - JSON Pointer string
 * @param {string[]} allowlist - Array of allowed top-level paths
 * @returns {boolean} True if allowed
 */
function isPathAllowed(pointer, allowlist) {
    if (pointer === '' || pointer === '/') {
        // Root access - allow if any allowlist entry exists
        return allowlist.length > 0;
    }

    const topLevel = getTopLevelPath(pointer);
    return allowlist.some(allowed => {
        // Allow exact match or if pointer starts with allowed path
        return topLevel === allowed || pointer.startsWith(allowed + '/') || pointer === allowed;
    });
}

module.exports = {
    parsePointer,
    buildPointer,
    resolvePointer,
    getTopLevelPath,
    isPathAllowed,
    decodeToken,
    encodeToken
};
