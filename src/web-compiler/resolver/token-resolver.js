'use strict';

/**
 * Token resolver — step 11.
 *
 * Resolves token:xxx.yyy references in component style_hooks against the
 * theme pack's token tree.  Also resolves literal: prefixed values.
 *
 * Returns a flat map of hookName → resolvedValue, or throws with error code
 * token_resolution_failed listing the first unresolvable path.
 */

function resolvePath(obj, dotPath) {
    return dotPath.split('.').reduce((cur, key) => (cur != null ? cur[key] : undefined), obj);
}

/**
 * Resolve all style_hooks for a component against theme tokens.
 *
 * @param {object} styleHooks   e.g. { surface: "token:color.surface", padding: "literal:0" }
 * @param {object} themeTokens  theme-pack.tokens
 * @returns {object} resolved hook map  e.g. { surface: "#FFFFFF", padding: "0" }
 */
function resolveStyleHooks(styleHooks, themeTokens) {
    const resolved = {};
    const failures = [];

    for (const [hookName, hookValue] of Object.entries(styleHooks || {})) {
        if (typeof hookValue !== 'string') {
            resolved[hookName] = hookValue;
            continue;
        }

        if (hookValue.startsWith('token:')) {
            const tokenPath = hookValue.slice('token:'.length);
            const value = resolvePath(themeTokens, tokenPath);
            if (value === undefined) {
                failures.push(tokenPath);
                resolved[hookName] = null;
            } else {
                resolved[hookName] = value;
            }
        } else if (hookValue.startsWith('literal:')) {
            resolved[hookName] = hookValue.slice('literal:'.length);
        } else {
            resolved[hookName] = hookValue;
        }
    }

    if (failures.length > 0) {
        const err = new Error(`Unresolved token path(s): ${failures.join(', ')}`);
        err.code = 'token_resolution_failed';
        err.paths = failures;
        throw err;
    }

    return resolved;
}

/**
 * Resolve the full token map for the site (theme tokens flattened to dotted paths).
 * Used by the CSS emitter to generate --sb-* variables.
 */
function flattenTokens(tokens, prefix = '') {
    const flat = {};
    for (const [key, val] of Object.entries(tokens || {})) {
        const dotKey = prefix ? `${prefix}.${key}` : key;
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            Object.assign(flat, flattenTokens(val, dotKey));
        } else {
            flat[dotKey] = val;
        }
    }
    return flat;
}

module.exports = { resolveStyleHooks, flattenTokens };
