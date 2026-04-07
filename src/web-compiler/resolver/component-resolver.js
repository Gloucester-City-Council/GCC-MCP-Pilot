'use strict';

/**
 * Component recipe resolver — step 8.
 *
 * Looks up the component recipe for a given component id and merges any
 * variant overrides requested by the template region.
 *
 * Returns the resolved recipe (base + variant overrides) or throws with
 * error code component_recipe_missing.
 */

function deepMerge(base, override) {
    if (!override) return base;
    const result = Object.assign({}, base);
    for (const [key, val] of Object.entries(override)) {
        if (val && typeof val === 'object' && !Array.isArray(val) && typeof base[key] === 'object') {
            result[key] = deepMerge(base[key], val);
        } else {
            result[key] = val;
        }
    }
    return result;
}

/**
 * Resolve a component recipe, applying variant overrides.
 *
 * @param {string} componentId   e.g. "service_card"
 * @param {string|null} variantId  e.g. "compact_link" or null (use default)
 * @param {object} componentRecipes
 * @returns {object} Resolved recipe
 */
function resolveComponent(componentId, variantId, componentRecipes) {
    const recipe = (componentRecipes.components || []).find(c => c.id === componentId);
    if (!recipe) {
        const err = new Error(`Component recipe not found for "${componentId}"`);
        err.code = 'component_recipe_missing';
        throw err;
    }

    const effectiveVariantId = variantId || recipe.default_variant;
    const variant = (recipe.variants || []).find(v => v.id === effectiveVariantId);
    const overrides = (variant && variant.overrides) || {};

    // deep_merge_last_wins strategy per renderer-execution-contract
    const resolved = deepMerge(recipe, { style_hooks: deepMerge(recipe.style_hooks, overrides.style_hooks) });
    resolved._resolved_variant = effectiveVariantId;

    return resolved;
}

module.exports = { resolveComponent };
