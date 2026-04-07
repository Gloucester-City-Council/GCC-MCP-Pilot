'use strict';

/**
 * Condition evaluator — step 5a.
 *
 * Evaluates a render_condition_id against the current render context to
 * decide whether an optional component should be rendered.
 *
 * Context shape passed in:
 *   { siteDef, page, globals }
 *
 * Operators supported (from condition-registry.sample.json):
 *   exists      — path has a non-null/non-undefined value with length > 0 if array
 *   not_equals  — resolvePath(context, path) !== value
 */

function resolvePath(obj, dotPath) {
    return dotPath.split('.').reduce((cur, key) => (cur != null ? cur[key] : undefined), obj);
}

/**
 * Evaluate a single condition against render context.
 *
 * @param {object} condition  Entry from conditionRegistry.conditions
 * @param {object} ctx        { globals, page }
 * @returns {boolean}  true = render the component
 */
function evaluateCondition(condition, ctx) {
    const { operator, path, value } = condition;

    // Build a flat lookup context: globals + page-level fields
    const lookupCtx = {
        globals:      ctx.globals || {},
        content:      (ctx.page && ctx.page.content) || {},
        page_options: (ctx.page && ctx.page.page_options) || {},
        slot:         (ctx.page && ctx.page.content) || {},
    };

    const resolved = resolvePath(lookupCtx, path);

    if (operator === 'exists') {
        if (resolved === null || resolved === undefined) return false;
        if (Array.isArray(resolved)) return resolved.length > 0;
        if (typeof resolved === 'string') return resolved.trim().length > 0;
        return true;
    }

    if (operator === 'not_equals') {
        return resolved !== value;
    }

    // Unknown operator — default to render
    return true;
}

/**
 * Look up a condition by id and evaluate it.
 *
 * @param {string} conditionId
 * @param {object} conditionRegistry
 * @param {object} ctx  { globals, page }
 * @returns {boolean}
 */
function evaluate(conditionId, conditionRegistry, ctx) {
    const condition = (conditionRegistry.conditions || []).find(c => c.id === conditionId);
    if (!condition) {
        // Unknown condition — fail safe by rendering
        return true;
    }
    return evaluateCondition(condition, ctx);
}

module.exports = { evaluate };
