'use strict';

/**
 * Integrity checker — step 4 of the pipeline.
 *
 * Runs all checks defined in system-integrity.sample.json against the
 * combined contract set.  Returns { passed, errors, warnings } where
 * errors are severity:"error" (blocking) and warnings are severity:"warning".
 *
 * Operators implemented:
 *   must_exist_in           — every value in left set exists in right set
 *   must_be_unique_in       — values in left set are unique
 *   must_be_supported_by    — left value is contained in right array
 *   must_match_template_page_type — page.template_id resolves and page_type matches
 *   must_resolve_token_path — token:xxx.yyy paths resolve in theme tokens
 */

/**
 * Resolve a dotted path into an object, returning undefined if missing.
 */
function resolvePath(obj, dotPath) {
    return dotPath.split('.').reduce((cur, key) => (cur != null ? cur[key] : undefined), obj);
}

/**
 * Collect all token: references from a style_hooks object.
 */
function collectTokenPaths(styleHooks) {
    const paths = [];
    for (const val of Object.values(styleHooks || {})) {
        if (typeof val === 'string' && val.startsWith('token:')) {
            paths.push(val.slice('token:'.length));
        }
    }
    return paths;
}

/**
 * Run all integrity checks.
 *
 * @param {object} siteDef   Normalised site definition (site_definition_v5)
 * @param {object} contracts { templateRegistry, componentRecipes, themePack, conditionRegistry, transformRegistry, systemIntegrity }
 * @returns {{ passed: boolean, errors: string[], warnings: string[] }}
 */
function runIntegrityChecks(siteDef, contracts) {
    const { templateRegistry, componentRecipes, themePack, conditionRegistry, transformRegistry } = contracts;
    const errors = [];
    const warnings = [];

    function fail(severity, checkId, msg) {
        if (severity === 'error') errors.push(`[${checkId}] ${msg}`);
        else warnings.push(`[${checkId}] ${msg}`);
    }

    // Build lookup sets
    const conditionIds = new Set((conditionRegistry.conditions || []).map(c => c.id));
    const transformIds = new Set((transformRegistry.transforms || []).map(t => t.id));
    const templateIds  = new Set((templateRegistry.templates  || []).map(t => t.id));
    const componentIds = new Set((componentRecipes.components  || []).map(c => c.id));
    const themeIds     = new Set([themePack.manifest.theme_id]);
    const supportedPolishProfiles = new Set(themePack.manifest.supported_polish_profiles || []);

    // ── 1. template.render_condition_id.exists ───────────────────────────────
    for (const tmpl of templateRegistry.templates || []) {
        for (const region of tmpl.regions || []) {
            for (const comp of region.components || []) {
                if (comp.render_condition_id && !conditionIds.has(comp.render_condition_id)) {
                    fail('error', 'template.render_condition_id.exists',
                        `Template "${tmpl.id}" region "${region.id}" references unknown render_condition_id "${comp.render_condition_id}"`);
                }
            }
        }
    }

    // ── 2. mapping.transform_id.exists ──────────────────────────────────────
    for (const tmpl of templateRegistry.templates || []) {
        for (const mapping of tmpl.content_mappings || []) {
            if (mapping.transform_id && mapping.transform_id !== 'identity' && !transformIds.has(mapping.transform_id)) {
                fail('error', 'mapping.transform_id.exists',
                    `Template "${tmpl.id}" mapping "${mapping.source_field}" references unknown transform_id "${mapping.transform_id}"`);
            }
            // identity is always valid; check all transform_ids including identity
            if (mapping.transform_id && !transformIds.has(mapping.transform_id)) {
                fail('error', 'mapping.transform_id.exists',
                    `Template "${tmpl.id}" mapping "${mapping.source_field}" references unknown transform_id "${mapping.transform_id}"`);
            }
        }
    }

    // ── 3. site.theme_id.exists ──────────────────────────────────────────────
    if (siteDef.site && siteDef.site.theme_id && !themeIds.has(siteDef.site.theme_id)) {
        fail('error', 'site.theme_id.exists',
            `site.theme_id "${siteDef.site.theme_id}" not found in theme pack (available: ${[...themeIds].join(', ')})`);
    }

    // ── 4. site.polish_profile_id.supported ─────────────────────────────────
    if (siteDef.site && siteDef.site.polish_profile_id && !supportedPolishProfiles.has(siteDef.site.polish_profile_id)) {
        fail('error', 'site.polish_profile_id.supported',
            `site.polish_profile_id "${siteDef.site.polish_profile_id}" not supported by theme "${siteDef.site.theme_id}" (supported: ${[...supportedPolishProfiles].join(', ')})`);
    }

    // ── 5. page.template_id.exists ───────────────────────────────────────────
    for (const page of siteDef.pages || []) {
        if (page.template_id && !templateIds.has(page.template_id)) {
            fail('error', 'page.template_id.exists',
                `Page "${page.id}" template_id "${page.template_id}" not found in template registry`);
        }
    }

    // ── 6. page.template_id.matches_page_type ───────────────────────────────
    const templatePageTypeMap = {};
    for (const tmpl of templateRegistry.templates || []) {
        templatePageTypeMap[tmpl.id] = tmpl.page_type;
    }
    for (const page of siteDef.pages || []) {
        if (page.template_id && page.page_type) {
            const tmplPageType = templatePageTypeMap[page.template_id];
            if (tmplPageType && tmplPageType !== page.page_type) {
                fail('error', 'page.template_id.matches_page_type',
                    `template_page_type_mismatch: Page "${page.id}" has page_type "${page.page_type}" but template "${page.template_id}" expects "${tmplPageType}"`);
            }
        }
    }

    // ── 7. mapping.target_component.exists ──────────────────────────────────
    for (const tmpl of templateRegistry.templates || []) {
        for (const mapping of tmpl.content_mappings || []) {
            if (mapping.target_component && !componentIds.has(mapping.target_component)) {
                fail('error', 'mapping.target_component.exists',
                    `Template "${tmpl.id}" mapping targets unknown component "${mapping.target_component}"`);
            }
        }
    }

    // ── 8. component.default_variant.exists ─────────────────────────────────
    for (const comp of componentRecipes.components || []) {
        const variantIds = new Set((comp.variants || []).map(v => v.id));
        if (comp.default_variant && !variantIds.has(comp.default_variant)) {
            fail('error', 'component.default_variant.exists',
                `Component "${comp.id}" default_variant "${comp.default_variant}" not found in variants`);
        }
    }

    // ── 9. style_tokens.resolve ──────────────────────────────────────────────
    const themeTokens = themePack.tokens || {};
    for (const comp of componentRecipes.components || []) {
        for (const tokenPath of collectTokenPaths(comp.style_hooks)) {
            if (resolvePath(themeTokens, tokenPath) === undefined) {
                fail('error', 'style_tokens.resolve',
                    `Component "${comp.id}" style_hook token path "${tokenPath}" not found in theme pack`);
            }
        }
    }

    // ── 10. page.id.unique ────────────────────────────────────────────────────
    const pageIds = (siteDef.pages || []).map(p => p.id);
    const seenIds = new Set();
    for (const id of pageIds) {
        if (seenIds.has(id)) {
            fail('error', 'page.id.unique', `Duplicate page id "${id}"`);
        }
        seenIds.add(id);
    }

    // ── 11. page.slug.unique ──────────────────────────────────────────────────
    const pageSlugs = (siteDef.pages || []).map(p => p.slug);
    const seenSlugs = new Set();
    for (const slug of pageSlugs) {
        if (seenSlugs.has(slug)) {
            fail('error', 'page.slug.unique', `Duplicate page slug "${slug}"`);
        }
        seenSlugs.add(slug);
    }

    // ── 12. template.region.order.unique ─────────────────────────────────────
    for (const tmpl of templateRegistry.templates || []) {
        const orders = (tmpl.regions || []).map(r => r.order);
        const seenOrders = new Set();
        for (const order of orders) {
            if (seenOrders.has(order)) {
                fail('error', 'template.region.order.unique',
                    `Template "${tmpl.id}" has duplicate region order "${order}"`);
            }
            seenOrders.add(order);
        }
    }

    return { passed: errors.length === 0, errors, warnings };
}

module.exports = { runIntegrityChecks };
