'use strict';

/**
 * CSS emitter — step 14b.
 *
 * Converts resolved theme tokens into a site.css file with --sb-* CSS custom
 * properties, plus utility class rules for component layouts and recipe classes.
 *
 * Output rules (from api_implementation_brief):
 *   - CSS variables with --sb- prefix
 *   - component class naming per naming contract (c-{component}, c-{component}__{slot})
 *   - no inline styles from content payload
 */

const { flattenTokens } = require('../resolver/token-resolver');

/**
 * Convert a dotted token path to a CSS variable name.
 * e.g. "color.primary" → "--sb-color-primary"
 */
function toCssVar(tokenPath) {
    return '--sb-' + tokenPath.replace(/\./g, '-').replace(/_/g, '-');
}

/**
 * Emit the :root block with all CSS custom properties from theme tokens.
 */
function emitRootVars(tokens) {
    const flat = flattenTokens(tokens);
    const lines = Object.entries(flat)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .map(([path, value]) => `  ${toCssVar(path)}: ${value};`);
    return `:root {\n${lines.join('\n')}\n}\n`;
}

/**
 * Emit base layout utility classes used by the layout_recipe values.
 */
function emitLayoutUtilities() {
    return `
/* Layout utilities */
.layout-full-width { width: 100%; }
.layout-single-column { max-width: var(--sb-layout-container-max-width, 1120px); margin: 0 auto; padding: 0 var(--sb-layout-gutter, 24px); }
.layout-two-column { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sb-layout-gutter, 24px); }
.layout-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sb-layout-gutter, 24px); }
.layout-stack { display: flex; flex-direction: column; gap: var(--sb-spacing-scale-2, 8px); }

@media (max-width: 768px) {
  .layout-two-column, .layout-grid-3 { grid-template-columns: 1fr; }
}
`;
}

function buildTokenValueLookup(renderPlan) {
    const byValue = new Map();
    const byPrefixAndValue = new Map();
    const values = renderPlan && renderPlan.resolved_tokens && renderPlan.resolved_tokens.values || {};
    for (const [tokenPath, value] of Object.entries(values)) {
        const key = String(value);
        if (!byValue.has(key)) byValue.set(key, tokenPath);
        const prefix = tokenPath.split('.')[0];
        if (!byPrefixAndValue.has(prefix)) byPrefixAndValue.set(prefix, new Map());
        const byPrefixedValue = byPrefixAndValue.get(prefix);
        if (!byPrefixedValue.has(key)) byPrefixedValue.set(key, tokenPath);
    }
    return { byValue, byPrefixAndValue };
}

const TOKEN_PREFIX_HINTS_BY_HOOK = {
    surface: ['color'],
    border: ['color'],
    padding: ['spacing'],
    gap: ['spacing'],
    radius: ['radius'],
    shadow: ['shadow'],
    title_scale: ['typography'],
    text_scale: ['typography'],
};

function toTokenReference(value, tokenValueLookup, hookName) {
    const lookupKey = String(value);
    const preferredPrefixes = TOKEN_PREFIX_HINTS_BY_HOOK[hookName] || [];

    for (const prefix of preferredPrefixes) {
        const prefixLookup = tokenValueLookup.byPrefixAndValue.get(prefix);
        if (prefixLookup && prefixLookup.has(lookupKey)) {
            return `var(${toCssVar(prefixLookup.get(lookupKey))})`;
        }
    }

    if (preferredPrefixes.length === 0 && tokenValueLookup.byValue.has(lookupKey)) {
        return `var(${toCssVar(tokenValueLookup.byValue.get(lookupKey))})`;
    }

    return String(value);
}

function pushProp(props, property, value, tokenValueLookup, hookName) {
    if (value === undefined || value === null || value === '') return;
    props.push(`  ${property}: ${toTokenReference(value, tokenValueLookup, hookName)};`);
}

function emitRootRule(cls, tokens, tokenValueLookup) {
    const props = [];
    pushProp(props, 'background-color', tokens.surface, tokenValueLookup, 'surface');
    pushProp(props, 'padding', tokens.padding, tokenValueLookup, 'padding');
    pushProp(props, 'border-radius', tokens.radius, tokenValueLookup, 'radius');
    pushProp(props, 'box-shadow', tokens.shadow, tokenValueLookup, 'shadow');
    if (tokens.border !== undefined && tokens.border !== null && tokens.border !== '') {
        props.push(`  border-color: ${toTokenReference(tokens.border, tokenValueLookup, 'border')};`);
        props.push('  border-style: solid;');
        props.push('  border-width: thin;');
    }
    pushProp(props, 'gap', tokens.gap, tokenValueLookup, 'gap');

    // Ensure every component with non-empty style tokens produces a selector.
    for (const [hookName, hookValue] of Object.entries(tokens)) {
        if (hookValue === undefined || hookValue === null || hookValue === '') continue;
        const cssCustomPropName = `--sb-component-${hookName.replace(/_/g, '-')}`;
        props.push(`  ${cssCustomPropName}: ${toTokenReference(hookValue, tokenValueLookup, hookName)};`);
    }

    if (props.length === 0) return null;
    return `.${cls} {\n${props.join('\n')}\n}`;
}

/**
 * Emit component base class rules from component recipes in the render plan.
 * Uses resolved token values from render plan.
 */
function emitComponentClasses(renderPlan) {
    const seenRootRules = new Set();
    const seenBodySectionTypography = new Set();
    const emittedSelectors = new Set();
    const coverageWarnings = [];
    const tokenValueLookup = buildTokenValueLookup(renderPlan);
    const rules = [];

    for (const page of renderPlan.pages || []) {
        for (const region of page.regions || []) {
            for (const instance of region.components || []) {
                const cls = instance.dom.root_class;

                const tokens = instance.styles && instance.styles.tokens || {};
                const nonEmptyTokens = Object.entries(tokens).filter(([, val]) => val !== undefined && val !== null && val !== '');
                if (nonEmptyTokens.length === 0) continue;
                const rootRule = seenRootRules.has(cls) ? null : emitRootRule(cls, tokens, tokenValueLookup);

                if (rootRule) {
                    rules.push(rootRule);
                    seenRootRules.add(cls);
                    emittedSelectors.add(`.${cls}`);
                }

                if (cls === 'c-body-section' && !seenBodySectionTypography.has(cls)) {
                    seenBodySectionTypography.add(cls);
                    if (tokens.title_scale) {
                        rules.push(`.c-body-section__heading {\n  font-size: ${toTokenReference(tokens.title_scale, tokenValueLookup, 'title_scale')};\n}`);
                        emittedSelectors.add('.c-body-section__heading');
                    }
                    if (tokens.text_scale) {
                        rules.push(`.c-body-section__content {\n  font-size: ${toTokenReference(tokens.text_scale, tokenValueLookup, 'text_scale')};\n}`);
                        emittedSelectors.add('.c-body-section__content');
                    }
                }

                // Slot classes
                for (const slot of instance.dom.slots || []) {
                    const slotCls = slot.class_name;
                    const slotProps = [];
                    if (slot.element === 'h1' && tokens.title_scale) {
                        slotProps.push(`  font-size: ${toTokenReference(tokens.title_scale, tokenValueLookup, 'title_scale')};`);
                    } else if ((slot.element === 'h2' || slot.element === 'h3') && tokens.title_scale) {
                        slotProps.push(`  font-size: ${toTokenReference(tokens.title_scale, tokenValueLookup, 'title_scale')};`);
                    }
                    if (slot.element === 'p' && tokens.text_scale) {
                        slotProps.push(`  font-size: ${toTokenReference(tokens.text_scale, tokenValueLookup, 'text_scale')};`);
                    }
                    if (slotProps.length > 0) {
                        rules.push(`.${slotCls} {\n${slotProps.join('\n')}\n}`);
                        emittedSelectors.add(`.${slotCls}`);
                    }
                }

                if (!emittedSelectors.has(`.${cls}`) && !(instance.dom.slots || []).some(slot => emittedSelectors.has(`.${slot.class_name}`))) {
                    coverageWarnings.push(`webcompiler-css-coverage: component "${instance.component_id}" (${cls}) has non-empty styles.tokens but emitted no CSS rule`);
                }
            }
        }
    }

    return {
        css: rules.join('\n\n'),
        warnings: coverageWarnings,
    };
}

/**
 * Emit the full site.css.
 *
 * @param {object} renderPlan  render_plan_v1
 * @param {object} tokens      theme-pack.tokens
 * @returns {string} CSS content
 */
function emitCss(renderPlan, tokens) {
    const componentCss = emitComponentClasses(renderPlan);
    return [
        `/* Site CSS — generated by web-compiler. DO NOT EDIT. */`,
        `/* Theme: ${renderPlan.resolved_tokens.theme_id} | Profile: ${renderPlan.resolved_tokens.polish_profile_id} */`,
        '',
        emitRootVars(tokens),
        emitLayoutUtilities(),
        componentCss.css,
    ].join('\n');
}

function getCssCoverageWarnings(renderPlan) {
    return emitComponentClasses(renderPlan).warnings;
}

module.exports = { emitCss, toCssVar, getCssCoverageWarnings };
