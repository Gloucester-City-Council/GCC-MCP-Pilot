'use strict';

/**
 * HTML sanitiser — step 10.
 *
 * Enforces the html-policy allowlist (tags and attributes).  Rejects the
 * entire field if any forbidden tag or attribute is present, returning the
 * exact failing path.  Does NOT silently strip — policy violations are
 * blocking errors per the api_implementation_brief.
 *
 * Allowed/forbidden lists come from html-policy.sample.json.
 */

// Simple tag extractor — matches opening and self-closing tags
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)\/?\s*>/g;
// Attribute name extractor
const ATTR_RE = /\b([a-zA-Z][a-zA-Z0-9-]*)\s*(?:=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g;
// Inline style attribute (forbidden)
const INLINE_STYLE_RE = /\bstyle\s*=/i;
// Event handler attributes
const EVENT_HANDLER_RE = /\bon[a-zA-Z]+\s*=/i;

/**
 * Sanitise a single HTML string against the policy.
 *
 * @param {string} html          The HTML fragment to check
 * @param {string} fieldPath     Dotted path for error reporting, e.g. "pages[0].content.body_sections[0].html"
 * @param {object} policy        html-policy.sample.json .policy object
 * @returns {{ clean: string, error: string|null }}
 *   clean — the original string if it passes (no modification, output as-is)
 *   error — null on pass, error message string on failure
 */
function sanitiseField(html, fieldPath, policy) {
    if (typeof html !== 'string' || html.trim() === '') {
        return { clean: html, error: null };
    }

    const { allowed_tags, allowed_attributes, forbidden_tags, forbidden_attributes, uri_attribute_rules } = policy;
    const allowedTagSet     = new Set((allowed_tags     || []).map(t => t.toLowerCase()));
    const forbiddenTagSet   = new Set((forbidden_tags   || []).map(t => t.toLowerCase()));
    const forbiddenAttrSet  = new Set((forbidden_attributes || []).map(a => a.toLowerCase()));

    // Reset regex state
    TAG_RE.lastIndex = 0;

    let match;
    while ((match = TAG_RE.exec(html)) !== null) {
        const tagName   = match[1].toLowerCase();
        const attrBlock = match[2] || '';

        // Check forbidden tags
        if (forbiddenTagSet.has(tagName)) {
            return {
                clean: html,
                error: `html_sanitisation_failed: forbidden tag <${tagName}> at path "${fieldPath}"`
            };
        }

        // Check tag not in allowlist (only for non-closing tags)
        const fullMatch = match[0];
        const isClosing = fullMatch.startsWith('</');
        if (!isClosing && !allowedTagSet.has(tagName)) {
            return {
                clean: html,
                error: `html_sanitisation_failed: tag <${tagName}> not in allowlist at path "${fieldPath}"`
            };
        }

        // Check inline style
        if (INLINE_STYLE_RE.test(attrBlock)) {
            return {
                clean: html,
                error: `html_sanitisation_failed: inline style attribute on <${tagName}> at path "${fieldPath}"`
            };
        }

        // Check event handlers
        if (EVENT_HANDLER_RE.test(attrBlock)) {
            return {
                clean: html,
                error: `html_sanitisation_failed: event handler attribute on <${tagName}> at path "${fieldPath}"`
            };
        }

        // Check each attribute individually
        ATTR_RE.lastIndex = 0;
        let attrMatch;
        while ((attrMatch = ATTR_RE.exec(attrBlock)) !== null) {
            const attrName = attrMatch[1].toLowerCase();
            if (attrName === '/') continue; // self-closing slash

            // Forbidden attribute check
            if (forbiddenAttrSet.has(attrName)) {
                return {
                    clean: html,
                    error: `html_sanitisation_failed: forbidden attribute "${attrName}" on <${tagName}> at path "${fieldPath}"`
                };
            }

            // Allowlist check: allowed_attributes["*"] and allowed_attributes[tagName]
            const globalAllowed  = new Set((allowed_attributes && allowed_attributes['*'])  || []);
            const tagAllowed     = new Set((allowed_attributes && allowed_attributes[tagName]) || []);
            const allAllowed     = new Set([...globalAllowed, ...tagAllowed]);

            if (!isClosing && !allAllowed.has(attrName)) {
                return {
                    clean: html,
                    error: `html_sanitisation_failed: attribute "${attrName}" not allowed on <${tagName}> at path "${fieldPath}"`
                };
            }

            // URI scheme check for href attributes
            if (attrName === 'href' && uri_attribute_rules) {
                const hrefRule = (uri_attribute_rules).find(r => r.attribute === 'href');
                if (hrefRule) {
                    const hrefValueMatch = attrBlock.match(/href\s*=\s*["']?([^"'\s>]*)["']?/i);
                    if (hrefValueMatch) {
                        const hrefValue = hrefValueMatch[1];
                        const colonIdx = hrefValue.indexOf(':');
                        const scheme = colonIdx >= 0 ? hrefValue.slice(0, colonIdx).toLowerCase() : '';
                        const allowed = new Set(hrefRule.allowed_schemes || []);
                        if (colonIdx >= 0 && !allowed.has(scheme)) {
                            return {
                                clean: html,
                                error: `html_sanitisation_failed: disallowed URI scheme "${scheme}" in href on <${tagName}> at path "${fieldPath}"`
                            };
                        }
                    }
                }
            }
        }
    }

    return { clean: html, error: null };
}

/**
 * Walk a site definition and sanitise all HTML string fields.
 *
 * @param {object} siteDef   site_definition_v5
 * @param {object} htmlPolicy  html-policy.sample.json
 * @returns {{ errors: string[] }}  errors is empty on success
 */
function sanitiseSiteDefinition(siteDef, htmlPolicy) {
    const policy = htmlPolicy.policy || htmlPolicy;
    const errors = [];

    function checkField(value, path) {
        if (typeof value === 'string' && /<[a-zA-Z]/.test(value)) {
            const { error } = sanitiseField(value, path, policy);
            if (error) errors.push(error);
        } else if (Array.isArray(value)) {
            value.forEach((item, i) => checkField(item, `${path}[${i}]`));
        } else if (value && typeof value === 'object') {
            for (const [k, v] of Object.entries(value)) {
                checkField(v, `${path}.${k}`);
            }
        }
    }

    // Check globals
    checkField(siteDef.globals, 'globals');

    // Check each page's content
    (siteDef.pages || []).forEach((page, i) => {
        checkField(page.content, `pages[${i}].content`);
    });

    return { errors };
}

module.exports = { sanitiseField, sanitiseSiteDefinition };
