'use strict';

/**
 * Normaliser — step 2 of the pipeline.
 *
 * Converts a site_authoring_v1 payload into a site_definition_v5 runtime
 * object, applying the repairs defined in normaliser-contract.sample.json:
 *   - supply_default_language_if_missing
 *   - generate_page_id_from_slug_if_missing
 *   - omit_optional_empty_fields
 *
 * Returns { siteDef, warnings } where siteDef is a valid site_definition_v5
 * candidate (integrity checks still to follow) and warnings is an array of
 * non-blocking repair notes.
 */

const DEFAULT_PAGE_TYPE_TO_TEMPLATE = {
    homepage:                 'template_homepage_v5',
    service_page:             'template_service_v5',
    news_page:                'template_news_v5',
    contact_page:             'template_contact_v5',
    eligibility_or_apply_page:'template_apply_v5',
    document_list_page:       'template_document_list_v5',
    search_results_page:      'template_search_v5',
    policy_page:              'template_policy_page_v5',
};

const UNIVERSAL_PAGE_HEADER_FIELDS = new Set(['title', 'summary', 'eyebrow']);

function buildTemplateBindingIndex(templateRegistry) {
    const index = new Map();
    for (const template of (templateRegistry && templateRegistry.templates) || []) {
        const boundFields = new Set((template.content_mappings || []).map(mapping => mapping.source_field));
        index.set(template.id, boundFields);
    }
    return index;
}

function slugify(str) {
    return String(str)
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '') || 'page';
}

/**
 * Validate a site_authoring_v1 payload structurally (before normalisation).
 * Returns { valid, errors }.
 */
function validateAuthoring(payload) {
    const errors = [];
    if (!payload || typeof payload !== 'object') {
        return { valid: false, errors: ['Input must be a JSON object'] };
    }
    if (payload.schema_version && payload.schema_version !== 'site_authoring_v1') {
        errors.push(`schema_version must be "site_authoring_v1", got "${payload.schema_version}"`);
    }
    if (!payload.site || typeof payload.site !== 'object') {
        errors.push('site object is required');
    } else if (!payload.site.name) {
        errors.push('site.name is required');
    }
    if (!Array.isArray(payload.pages) || payload.pages.length === 0) {
        errors.push('pages array is required and must contain at least one page');
    } else {
        payload.pages.forEach((p, i) => {
            if (!p.page_type) errors.push(`pages[${i}].page_type is required`);
            if (!p.content || typeof p.content !== 'object') errors.push(`pages[${i}].content is required`);
            if (!p.content || !p.content.title) errors.push(`pages[${i}].content.title is required`);
        });
    }
    return { valid: errors.length === 0, errors };
}

/**
 * Normalise a site_authoring_v1 or site_definition_v5 payload.
 * If the payload is already site_definition_v5 it is passed through with
 * minimal defaulting applied.
 */
function normalise(payload, templateRegistry) {
    const warnings = [];
    const templateBindings = buildTemplateBindingIndex(templateRegistry);

    // Pass-through if already a runtime definition
    if (payload && payload.schema_version === 'site_definition_v5') {
        return { siteDef: payload, warnings };
    }

    const site = Object.assign({}, payload.site || {});
    const globals = Object.assign({}, payload.globals || {});

    // supply_default_language_if_missing
    if (!site.language) {
        site.language = 'en-GB';
        warnings.push('site.language defaulted to "en-GB"');
    }

    // Require theme_id and polish_profile_id — callers must supply these or they
    // will fail runtime validation; we default to the civic_blue theme so the
    // compiler can proceed without them being hard-required at authoring time.
    if (!site.theme_id) {
        site.theme_id = 'civic_blue';
        warnings.push('site.theme_id defaulted to "civic_blue"');
    }
    if (!site.polish_profile_id) {
        site.polish_profile_id = 'comfortable-civic';
        warnings.push('site.polish_profile_id defaulted to "comfortable-civic"');
    }

    // Derive site.id from name if missing
    if (!site.id) {
        site.id = slugify(site.name || 'site');
        warnings.push(`site.id derived as "${site.id}"`);
    }

    const pages = (payload.pages || []).map((rawPage, idx) => {
        const page = Object.assign({}, rawPage);

        // generate_page_id_from_slug_if_missing
        if (!page.id) {
            const base = page.slug
                ? page.slug.replace(/^\//, '').replace(/\//g, '-') || 'home'
                : (page.content && page.content.title)
                    ? slugify(page.content.title)
                    : `page-${idx}`;
            page.id = base;
            warnings.push(`pages[${idx}].id derived as "${page.id}"`);
        }

        if (!page.slug) {
            page.slug = page.id === 'home' ? '/' : `/${page.id}`;
            warnings.push(`pages[${idx}].slug derived as "${page.slug}"`);
        }

        // Auto-select default template_id based on page_type if not given
        if (!page.template_id && page.page_type) {
            const tmpl = DEFAULT_PAGE_TYPE_TO_TEMPLATE[page.page_type];
            if (tmpl) {
                page.template_id = tmpl;
                warnings.push(`pages[${idx}].template_id defaulted to "${tmpl}"`);
            }
        }

        const boundFields = templateBindings.get(page.template_id);
        if (page.content && typeof page.content === 'object' && boundFields) {
            for (const field of Object.keys(page.content)) {
                if (UNIVERSAL_PAGE_HEADER_FIELDS.has(field)) continue;
                if (boundFields.has(field)) continue;
                warnings.push(`pages[${idx}].content.${field} supplied but template "${page.template_id}" has no binding for this field — content will not be rendered`);
            }
        }

        // omit_optional_empty_fields — strip null/undefined optional top-level
        // page fields so they don't fail strict schema checks
        if (page.page_options && Object.keys(page.page_options).length === 0) {
            delete page.page_options;
        }

        return page;
    });

    // omit_optional_empty_fields on globals
    if (globals.alert_banner && Object.keys(globals.alert_banner).length === 0) {
        delete globals.alert_banner;
    }

    const siteDef = {
        schema_version: 'site_definition_v5',
        site,
        globals,
        pages,
    };

    return { siteDef, warnings };
}

module.exports = { validateAuthoring, normalise };
