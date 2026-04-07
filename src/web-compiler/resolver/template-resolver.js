'use strict';

/**
 * Template resolver — steps 6 & 7.
 *
 * Finds the template for a page and verifies template.page_type === page.page_type.
 * Returns { template } or throws with error code template_not_found |
 * template_page_type_mismatch.
 */

/**
 * Resolve the template for a single page.
 *
 * @param {object} page            Page from site_definition_v5
 * @param {object} templateRegistry
 * @returns {object} Matched template entry
 */
function resolveTemplate(page, templateRegistry) {
    const template = (templateRegistry.templates || []).find(t => t.id === page.template_id);

    if (!template) {
        const err = new Error(`Template "${page.template_id}" not found for page "${page.id}"`);
        err.code = 'template_not_found';
        throw err;
    }

    if (template.page_type !== page.page_type) {
        const err = new Error(
            `Page "${page.id}" page_type "${page.page_type}" does not match ` +
            `template "${template.id}" page_type "${template.page_type}"`
        );
        err.code = 'template_page_type_mismatch';
        throw err;
    }

    return template;
}

module.exports = { resolveTemplate };
