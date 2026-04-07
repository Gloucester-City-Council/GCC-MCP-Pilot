'use strict';

/**
 * Render plan compiler — step 12.
 *
 * Takes the normalised site definition, resolved theme, and all resolved
 * registries, then produces a typed render plan (render_plan_v1).
 *
 * The render plan is the single source of truth for emitters — no emitter
 * reads the raw site definition directly.
 *
 * Output shape (render-plan.schema.json):
 *   schema_version, site_id, pages[], resolved_tokens{}, behaviour_manifest[], asset_manifest{}
 *
 * Each page contains ordered regions, each region contains component instances
 * with resolved slot values, styles, data-attributes, accessibility notes,
 * and source bindings.
 */

const { resolveTemplate }   = require('../resolver/template-resolver');
const { resolveComponent }  = require('../resolver/component-resolver');
const { evaluate }          = require('../resolver/condition-evaluator');
const { applyTransform }    = require('../resolver/transform-executor');
const { resolveStyleHooks, flattenTokens } = require('../resolver/token-resolver');

/**
 * Resolve a dotted path in an object.
 */
function get(obj, dotPath) {
    return dotPath.split('.').reduce((cur, key) => (cur != null ? cur[key] : undefined), obj);
}

/**
 * Build an instance_id for a component.
 */
function instanceId(pageId, regionId, componentId) {
    return `${pageId}-${regionId}-${componentId}`;
}

/**
 * Resolve slot values for a component from its recipe + content mappings.
 *
 * @param {object} recipe       Resolved component recipe
 * @param {object} template     Template entry
 * @param {object} page         Page from site definition
 * @param {object} transformRegistry
 * @returns {Array} slot array for render plan
 */
function resolveSlots(recipe, template, page, transformRegistry) {
    const slots = [];

    for (const slotDef of recipe.dom_recipe.slots || []) {
        // Find the mapping for this slot from the template's content_mappings
        const mapping = (template.content_mappings || []).find(
            m => m.target_component === recipe.id && m.target_slot === slotDef.id
        );

        let rawValue;
        if (mapping) {
            rawValue = get(page.content, mapping.source_field);
            if (mapping.transform_id) {
                rawValue = applyTransform(mapping.transform_id, rawValue, transformRegistry);
            }
        } else {
            // Fallback: look in content directly by slot source
            rawValue = slotDef.source ? get(page.content, slotDef.source) : undefined;
        }

        const isRendered = rawValue !== null && rawValue !== undefined &&
            !(Array.isArray(rawValue) && rawValue.length === 0);

        const slot = {
            slot_id:        slotDef.id,
            element:        slotDef.element,
            class_name:     `${recipe.dom_recipe.css_hooks.slot_class_prefix}${slotDef.id}`,
            resolved_value: rawValue !== undefined ? rawValue : null,
            is_rendered:    Boolean(isRendered),
        };

        if (slotDef.attributes) {
            slot.attributes = resolveSlotAttributes(slotDef.attributes, rawValue);
        }

        slots.push(slot);
    }

    return slots;
}

/**
 * Resolve slot attribute templates (e.g. href="{url}").
 */
function resolveSlotAttributes(attrTemplate, value) {
    const resolved = {};
    for (const [k, v] of Object.entries(attrTemplate)) {
        if (typeof v === 'string' && typeof value === 'string') {
            resolved[k] = v.replace('{url}', value).replace('{value}', value);
        } else {
            resolved[k] = v;
        }
    }
    return resolved;
}

/**
 * Build the behaviour manifest entries from component interaction hooks.
 */
function collectBehaviourHooks(componentId, instanceIdStr, recipe) {
    const hooks = [];
    if (recipe.interaction && Array.isArray(recipe.interaction.js_hooks)) {
        for (const hook of recipe.interaction.js_hooks) {
            hooks.push({
                hook,
                component_id: componentId,
                instance_id:  instanceIdStr,
            });
        }
    }
    return hooks;
}

/**
 * Compile the full render plan.
 *
 * @param {object} siteDef          Normalised site_definition_v5
 * @param {object} contracts        { templateRegistry, componentRecipes, transformRegistry, conditionRegistry }
 * @param {object} themeResolution  { tokens, themeManifest, polishProfile }
 * @returns {object} render_plan_v1
 */
function compileRenderPlan(siteDef, contracts, themeResolution) {
    const { templateRegistry, componentRecipes, transformRegistry, conditionRegistry } = contracts;
    const { tokens, themeManifest, polishProfile } = themeResolution;

    const behaviourManifest = [];
    const pages = [];

    // Flatten theme tokens for resolved_tokens
    const flatTokens = flattenTokens(tokens);

    for (const page of siteDef.pages) {
        const template = resolveTemplate(page, templateRegistry);
        const ctx = { globals: siteDef.globals, page };

        const regions = [];

        // Sort regions by order (deterministic)
        const sortedRegions = [...(template.regions || [])].sort((a, b) => a.order - b.order);

        for (const region of sortedRegions) {
            const componentInstances = [];

            for (const regionComp of region.components || []) {
                // Evaluate optional render condition
                if (regionComp.render_condition_id) {
                    const shouldRender = evaluate(regionComp.render_condition_id, conditionRegistry, ctx);
                    if (!shouldRender) continue;
                }

                const recipe = resolveComponent(regionComp.component, regionComp.variant || null, componentRecipes);
                const iId = instanceId(page.id, region.id, recipe.id);

                // Resolve style hooks → token values
                const resolvedStyleTokens = resolveStyleHooks(recipe.style_hooks, tokens);

                // Resolve slots
                const slots = resolveSlots(recipe, template, page, transformRegistry);

                // Collect behaviour hooks
                const hooks = collectBehaviourHooks(recipe.id, iId, recipe);
                behaviourManifest.push(...hooks);

                const instance = {
                    component_id:    recipe.id,
                    instance_id:     iId,
                    variant:         recipe._resolved_variant,
                    dom: {
                        root_element: recipe.dom_recipe.root_element,
                        root_class:   recipe.dom_recipe.css_hooks.block_class,
                        slots,
                    },
                    styles: {
                        tokens:  resolvedStyleTokens,
                        recipe:  { layout_recipe: recipe.style_hooks && recipe.style_hooks.layout_recipe },
                    },
                    data_attributes: {
                        component: recipe.dom_recipe.css_hooks.data_component_attr,
                        variant:   recipe._resolved_variant,
                        region:    region.id,
                    },
                    accessibility: {
                        rules_applied: (recipe.accessibility && recipe.accessibility.rules) || [],
                        roles:         (recipe.accessibility && recipe.accessibility.required_roles) || [],
                        attributes:    (recipe.accessibility && recipe.accessibility.required_attributes) || [],
                    },
                    source_bindings: (template.content_mappings || [])
                        .filter(m => m.target_component === recipe.id)
                        .map(m => ({ source_field: m.source_field, target_slot: m.target_slot })),
                };

                // Accessibility guardrail: exactly one h1 per page
                if (recipe.id === 'page_header') {
                    instance._guardrails = { single_h1: true };
                }

                componentInstances.push(instance);
            }

            if (componentInstances.length > 0) {
                regions.push({
                    region_id:  region.id,
                    order:      region.order,
                    layout:     region.layout,
                    components: componentInstances,
                });
            }
        }

        pages.push({
            page_id:     page.id,
            slug:        page.slug,
            template_id: template.id,
            regions,
        });
    }

    return {
        schema_version: 'render_plan_v1',
        site_id:        siteDef.site.id,
        pages,
        resolved_tokens: {
            theme_id:         themeManifest.theme_id,
            polish_profile_id: polishProfile.id,
            values:            flatTokens,
        },
        behaviour_manifest: behaviourManifest,
        asset_manifest: {
            html_files: siteDef.pages.map(p => (p.slug === '/' ? 'index.html' : `${p.id}.html`)),
            css_files:  ['site.css'],
            js_files:   behaviourManifest.length > 0 ? ['site.js'] : [],
            images:     [],
        },
    };
}

module.exports = { compileRenderPlan };
