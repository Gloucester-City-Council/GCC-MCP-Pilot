'use strict';

/**
 * Transform executor — step 5b.
 *
 * Applies a registered transform to a source value before it is placed into a
 * component slot.
 *
 * Transforms defined in transform-registry.sample.json:
 *   identity                           — pass value through unchanged
 *   wrap_scalar_as_body_section        — wraps a plain string into a body-section array
 */

/**
 * Apply a transform to a source value.
 *
 * @param {string} transformId
 * @param {*} value                The raw source value from page content
 * @param {object} transformRegistry
 * @returns {*} Transformed value
 */
function applyTransform(transformId, value, transformRegistry) {
    const transform = (transformRegistry.transforms || []).find(t => t.id === transformId);
    if (!transform) {
        throw new Error(`transform_not_found:${transformId}`);
    }

    switch (transform.kind) {
        case 'identity':
            return value;

        case 'wrap_scalar_as_body_section': {
            if (value === null || value === undefined) return [];
            const cfg = transform.config || {};
            const heading = cfg.heading || '';
            const wrapper = cfg.target_html_wrapper || '<p>{{value}}</p>';
            const html = wrapper.replace('{{value}}', String(value));
            return [{ heading, html }];
        }

        default:
            // Unknown kind — pass through unchanged
            return value;
    }
}

module.exports = { applyTransform };
