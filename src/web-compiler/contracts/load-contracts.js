'use strict';

/**
 * Loads all web compiler registries from schemas/WebCompiler/.
 * Returns a frozen contracts object used throughout the pipeline.
 */

const path = require('path');
const fs = require('fs');

const SCHEMAS_DIR = path.resolve(__dirname, '../../../schemas/WebCompiler');

function loadJson(filename) {
    const fullPath = path.join(SCHEMAS_DIR, filename);
    try {
        return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (err) {
        throw new Error(`Failed to load contract file "${filename}": ${err.message}`);
    }
}

/**
 * Stub recipes for components referenced in template content_mappings but
 * absent from the sample component-recipes file.  These stubs satisfy
 * integrity checks and provide enough dom_recipe shape for the compiler.
 */
const BUILTIN_COMPONENT_STUBS = [
    {
        id: 'hero',
        data_contract_ref: 'site-definition.schema.json#/$defs/heroItem',
        default_variant: 'slider',
        dom_recipe: {
            root_element: 'section',
            css_hooks: { block_class: 'c-hero', slot_class_prefix: 'c-hero__', data_component_attr: 'hero' },
            slots: [
                { id: 'items', element: 'div', source: 'hero_items', priority: 1 },
            ],
        },
        slot_conditions: [],
        collection_rendering: { source_field: 'hero_items', wrapper_element: 'div', item_component_mode: 'self_repeat', min_items: 1, max_items: 6 },
        empty_state_recipe: { strategy: 'omit_component', message: 'No hero items', element: 'div' },
        style_hooks: { surface: 'token:color.surface', layout_recipe: 'grid_3' },
        responsive_rules: [],
        accessibility: { rules: [], required_roles: [], required_attributes: [], slot_requirements: [] },
        variants: [{ id: 'slider', overrides: {} }],
    },
    {
        id: 'content_body',
        data_contract_ref: 'site-definition.schema.json#/$defs/bodySection',
        default_variant: 'default',
        dom_recipe: {
            root_element: 'section',
            css_hooks: { block_class: 'c-content-body', slot_class_prefix: 'c-content-body__', data_component_attr: 'content-body' },
            slots: [
                { id: 'sections', element: 'div', source: 'body_sections', priority: 1 },
            ],
        },
        slot_conditions: [],
        collection_rendering: { source_field: 'body_sections', wrapper_element: 'div', item_component_mode: 'self_repeat', min_items: 0, max_items: 50 },
        empty_state_recipe: { strategy: 'omit_component', message: 'No body sections', element: 'div' },
        style_hooks: { surface: 'literal:transparent', layout_recipe: 'stack' },
        responsive_rules: [],
        accessibility: { rules: [], required_roles: [], required_attributes: [], slot_requirements: [] },
        variants: [{ id: 'default', overrides: {} }],
    },
    {
        id: 'navigation',
        data_contract_ref: 'site-definition.schema.json#/$defs/navigation',
        default_variant: 'default',
        dom_recipe: {
            root_element: 'nav',
            css_hooks: { block_class: 'c-navigation', slot_class_prefix: 'c-navigation__', data_component_attr: 'navigation' },
            slots: [
                { id: 'brand', element: 'a', source: 'brand', priority: 1 },
                { id: 'items', element: 'ul', source: 'items', priority: 2 },
            ],
        },
        slot_conditions: [],
        collection_rendering: { source_field: 'items', wrapper_element: 'ul', item_component_mode: 'self_repeat', min_items: 1, max_items: 8 },
        empty_state_recipe: { strategy: 'raise_error', message: 'navigation requires items', element: 'div' },
        style_hooks: { surface: 'token:color.primary', layout_recipe: 'full_width' },
        responsive_rules: [],
        accessibility: { rules: ['nav landmark must be labelled'], required_roles: [], required_attributes: ['aria-label'], slot_requirements: [] },
        variants: [{ id: 'default', overrides: {} }],
    },
    {
        id: 'footer',
        data_contract_ref: 'site-definition.schema.json#/$defs/footer',
        default_variant: 'default',
        dom_recipe: {
            root_element: 'footer',
            css_hooks: { block_class: 'c-footer', slot_class_prefix: 'c-footer__', data_component_attr: 'footer' },
            slots: [
                { id: 'groups', element: 'div', source: 'groups', priority: 1 },
            ],
        },
        slot_conditions: [],
        collection_rendering: { source_field: 'groups', wrapper_element: 'div', item_component_mode: 'self_repeat', min_items: 1, max_items: 6 },
        empty_state_recipe: { strategy: 'raise_error', message: 'footer requires groups', element: 'div' },
        style_hooks: { surface: 'token:color.footer_bg', layout_recipe: 'full_width' },
        responsive_rules: [],
        accessibility: { rules: [], required_roles: [], required_attributes: [], slot_requirements: [] },
        variants: [{ id: 'default', overrides: {} }],
    },
    {
        id: 'alert_banner',
        data_contract_ref: 'site-definition.schema.json#/$defs/alertBanner',
        default_variant: 'default',
        dom_recipe: {
            root_element: 'aside',
            css_hooks: { block_class: 'c-alert-banner', slot_class_prefix: 'c-alert-banner__', data_component_attr: 'alert-banner' },
            slots: [
                { id: 'message', element: 'p', source: 'message_html', priority: 1 },
            ],
        },
        slot_conditions: [],
        collection_rendering: { source_field: '', wrapper_element: 'div', item_component_mode: 'child_records', min_items: 0, max_items: 1 },
        empty_state_recipe: { strategy: 'omit_component', message: 'No alert', element: 'div' },
        style_hooks: { surface: 'token:color.surface_alt', layout_recipe: 'single_column' },
        responsive_rules: [],
        accessibility: { rules: [], required_roles: [], required_attributes: [], slot_requirements: [] },
        variants: [{ id: 'default', overrides: {} }],
    },
    {
        id: 'breadcrumb',
        data_contract_ref: 'site-definition.schema.json#/$defs/linkItem',
        default_variant: 'default',
        dom_recipe: {
            root_element: 'nav',
            css_hooks: { block_class: 'c-breadcrumb', slot_class_prefix: 'c-breadcrumb__', data_component_attr: 'breadcrumb' },
            slots: [
                { id: 'items', element: 'ol', source: 'breadcrumb', priority: 1 },
            ],
        },
        slot_conditions: [],
        collection_rendering: { source_field: 'breadcrumb', wrapper_element: 'ol', item_component_mode: 'self_repeat', min_items: 0, max_items: 10 },
        empty_state_recipe: { strategy: 'omit_component', message: 'No breadcrumb items', element: 'div' },
        style_hooks: { surface: 'literal:transparent', layout_recipe: 'single_column' },
        responsive_rules: [],
        accessibility: { rules: ['breadcrumb nav must have aria-label'], required_roles: [], required_attributes: ['aria-label'], slot_requirements: [] },
        variants: [{ id: 'default', overrides: {} }],
    },
    {
        id: 'page_header',
        data_contract_ref: 'site-definition.schema.json#/$defs/pageContentBase',
        default_variant: 'default',
        dom_recipe: {
            root_element: 'header',
            css_hooks: { block_class: 'c-page-header', slot_class_prefix: 'c-page-header__', data_component_attr: 'page-header' },
            slots: [
                { id: 'eyebrow', element: 'span', source: 'eyebrow', required: false, priority: 1 },
                { id: 'title', element: 'h1', source: 'title', priority: 2 },
                { id: 'summary', element: 'p', source: 'summary', required: false, priority: 3 },
            ],
        },
        slot_conditions: [
            { slot_id: 'eyebrow', condition_id: 'slot.eyebrow.exists', else_action: 'omit_slot' },
            { slot_id: 'summary', condition_id: 'slot.summary.exists', else_action: 'omit_slot' },
        ],
        collection_rendering: { source_field: '', wrapper_element: 'div', item_component_mode: 'child_records', min_items: 0, max_items: 1 },
        empty_state_recipe: { strategy: 'raise_error', message: 'page_header requires title', element: 'div' },
        style_hooks: { surface: 'literal:transparent', padding: 'literal:0', gap: 'token:spacing.scale.1', radius: 'token:radius.none', title_scale: 'token:typography.scale.h1', text_scale: 'token:typography.scale.body', layout_recipe: 'stack' },
        responsive_rules: [],
        accessibility: { rules: ['must render exactly one h1 per page'], required_roles: [], required_attributes: [], slot_requirements: [] },
        variants: [{ id: 'default', overrides: {} }],
    },
];

/**
 * Merge stub recipes into the loaded component recipes, avoiding duplicates.
 * Stubs only fill gaps — the sample file takes precedence for any component
 * already defined there.
 */
function mergeComponentStubs(loaded) {
    const existingIds = new Set((loaded.components || []).map(c => c.id));
    const extras = BUILTIN_COMPONENT_STUBS.filter(s => !existingIds.has(s.id));
    if (extras.length === 0) return loaded;
    return Object.assign({}, loaded, { components: [...(loaded.components || []), ...extras] });
}

let _contracts = null;

function loadContracts() {
    if (_contracts) return _contracts;

    const rawRecipes = loadJson('component-recipes.sample.json');

    _contracts = Object.freeze({
        templateRegistry:   loadJson('template-registry.sample.json'),
        componentRecipes:   mergeComponentStubs(rawRecipes),
        themePack:          loadJson('theme-pack.sample.json'),
        conditionRegistry:  loadJson('condition-registry.sample.json'),
        transformRegistry:  loadJson('transform-registry.sample.json'),
        systemIntegrity:    loadJson('system-integrity.sample.json'),
        htmlPolicy:         loadJson('html-policy.sample.json'),
        normaliserContract: loadJson('normaliser-contract.sample.json'),
        namingContract:     loadJson('naming-contract.sample.json'),
        goldenTests:        loadJson('golden-tests.sample.json'),
    });

    return _contracts;
}

/**
 * Load contracts with caller-supplied overrides (used by tools that accept
 * custom registries, and by golden-test-runner which swaps individual files).
 */
function loadContractsWith(overrides = {}) {
    const base = loadContracts();
    return Object.assign({}, base, overrides);
}

/**
 * Async variant — merges custom templates persisted in blob storage over the
 * base in-memory template registry before returning contracts.
 *
 * Custom templates with the same id as a base template replace the base entry.
 * All other contracts (themes, components, etc.) are unchanged.
 *
 * @param {object} [overrides]  Optional additional overrides (same as loadContractsWith)
 * @returns {Promise<object>}
 */
async function loadContractsAsync(overrides = {}) {
    const base = loadContracts();

    let customTemplates = [];
    try {
        const { listCustomTemplates } = require('../storage/template-store');
        customTemplates = await listCustomTemplates();
    } catch {
        // If blob storage is unavailable (e.g. local dev without env var),
        // fall back gracefully to the base contracts only.
    }

    if (customTemplates.length === 0) {
        return Object.assign({}, base, overrides);
    }

    // Merge: custom templates take precedence over base entries with the same id
    const baseTemplates    = base.templateRegistry.templates || [];
    const customIds        = new Set(customTemplates.map(t => t.id));
    const filteredBase     = baseTemplates.filter(t => !customIds.has(t.id));
    const mergedTemplates  = [...filteredBase, ...customTemplates];

    const mergedRegistry = Object.assign({}, base.templateRegistry, { templates: mergedTemplates });
    return Object.assign({}, base, { templateRegistry: mergedRegistry }, overrides);
}

module.exports = { loadContracts, loadContractsWith, loadContractsAsync, mergeComponentStubs };
