'use strict';

/**
 * Generic rule interpreter for council tax executable_rule_slices.
 *
 * Reads conditions, derived_values, and effects directly from the schema's
 * rule objects. No per-rule logic lives here — adding a rule to the schema
 * document automatically makes it evaluable without code changes.
 *
 * Supported condition operators: equals, not_equals, greater_than,
 * greater_than_or_equal, less_than, less_than_or_equal, in, not_in, contains.
 *
 * Supported derived_value aggregations: count (with where_all conditions).
 *
 * Effect types resolved: single effect or first matching branch from
 * branching_effects.
 */

const OPERATORS = {
    equals: (a, b) => a === b,
    not_equals: (a, b) => a !== b,
    greater_than: (a, b) => typeof a === 'number' && a > b,
    greater_than_or_equal: (a, b) => typeof a === 'number' && a >= b,
    less_than: (a, b) => typeof a === 'number' && a < b,
    less_than_or_equal: (a, b) => typeof a === 'number' && a <= b,
    in: (a, b) => Array.isArray(b) && b.includes(a),
    not_in: (a, b) => Array.isArray(b) && !b.includes(a),
    contains: (a, b) => Array.isArray(a) && a.includes(b),
};

function resolvePath(obj, path) {
    if (!path) return undefined;
    return path.split('.').reduce((cur, k) => (cur != null ? cur[k] : undefined), obj);
}

function evalCondition(cond, ctx) {
    const val = resolvePath(ctx, cond.fact);
    const op = OPERATORS[cond.operator];
    return op ? op(val, cond.value) : false;
}

function evalConditions(conditions, combination, ctx) {
    if (!Array.isArray(conditions) || conditions.length === 0) return true;
    const test = c => evalCondition(c, ctx);
    return combination === 'any' ? conditions.some(test) : conditions.every(test);
}

function computeDerived(derivedDefs, ctx) {
    const derived = {};
    for (const def of (derivedDefs || [])) {
        if (def.aggregation !== 'count') continue;
        const collection = resolvePath(ctx, def.collection) || [];
        derived[def.name] = collection.filter(item =>
            evalConditions(def.where_all || [], 'all', { ...ctx, item })
        ).length;
    }
    return derived;
}

function resolveEffect(rule, ctx) {
    if (Array.isArray(rule.branching_effects)) {
        for (const branch of rule.branching_effects) {
            if (evalConditions(branch.when || [], 'all', ctx)) return branch.effect;
        }
        return null;
    }
    return rule.effect || null;
}

/**
 * Evaluate a single rule against a case context.
 *
 * Returns null if the rule has no evaluable conditions or mechanism.
 * Returns { ruleId, name, eligible, mechanism, stage, precedence, effect, derived }.
 */
function evaluateRule(rule, baseCtx) {
    if (!rule.mechanism || rule.mechanism === 'undefined') return null;
    if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) return null;

    const derived = computeDerived(rule.derived_values, baseCtx);
    const ctx = { ...baseCtx, derived: { ...baseCtx.derived, ...derived } };
    const eligible = evalConditions(rule.conditions, rule.condition_combination || 'all', ctx);

    return {
        ruleId: rule.rule_id,
        name: rule.name,
        eligible,
        mechanism: rule.mechanism,
        stage: rule.stage,
        precedence: rule.precedence || 50,
        effect: eligible ? resolveEffect(rule, ctx) : null,
        derived,
    };
}

/**
 * Build a unified case context from flat userFacts.
 *
 * Maps the flat summary model (adults: 2, students: 1, ...) to the
 * residents-array and property-object model that rule conditions reference.
 * Pre-computes household aggregates into derived so branching_effects
 * that reference derived.counted_adults_after_disregards work without
 * a separate disregard pass.
 */
function buildCaseContext(userFacts) {
    const adults = Number.isFinite(userFacts.adults) ? userFacts.adults : 0;
    const students = Number.isFinite(userFacts.students) ? userFacts.students : 0;
    const carers = Number.isFinite(userFacts.carers) ? userFacts.carers : 0;
    const smi = Number.isFinite(userFacts.severely_mentally_impaired) ? userFacts.severely_mentally_impaired : 0;
    const apprentices = userFacts.apprentice ? 1 : 0;

    const residents = [];
    let allocated = 0;

    if (userFacts.care_leaver) {
        residents.push({
            age: Number.isFinite(userFacts.age) ? userFacts.age : 20,
            is_care_leaver: true,
            is_full_time_student: false,
            is_disregarded_other: false,
            is_severely_mentally_impaired: false,
        });
        allocated++;
    }
    for (let i = 0; i < students; i++) {
        residents.push({ age: 21, is_care_leaver: false, is_full_time_student: true, is_disregarded_other: false, is_severely_mentally_impaired: false });
        allocated++;
    }
    for (let i = 0; i < smi; i++) {
        residents.push({ age: 50, is_care_leaver: false, is_full_time_student: false, is_disregarded_other: false, is_severely_mentally_impaired: true });
        allocated++;
    }
    for (let i = 0; i < carers; i++) {
        residents.push({ age: 40, is_care_leaver: false, is_full_time_student: false, is_disregarded_other: true, is_severely_mentally_impaired: false });
        allocated++;
    }
    if (userFacts.apprentice) {
        residents.push({ age: 19, is_care_leaver: false, is_full_time_student: false, is_disregarded_other: true, is_severely_mentally_impaired: false });
        allocated++;
    }
    for (let i = 0; i < Math.max(0, adults - allocated); i++) {
        residents.push({ age: 40, is_care_leaver: false, is_full_time_student: false, is_disregarded_other: false, is_severely_mentally_impaired: false });
    }

    const disregardedAdults = students + carers + smi + apprentices;
    const countingAdults = Math.max(0, adults - disregardedAdults);

    const adultsDefined = Number.isFinite(userFacts.adults);

    let occupancyStatus = 'sole_or_main_residence';
    if (userFacts.property_empty) occupancyStatus = 'empty_long_term';
    else if (userFacts.second_home) occupancyStatus = 'second_home';
    // When adults is unknown or explicitly zero, occupancy-based rules cannot
    // fire. Returning 'no_residents_specified' makes all sole_or_main_residence
    // conditions fail, so the no-resident fallback is returned instead.
    else if (!adultsDefined || adults === 0) occupancyStatus = 'no_residents_specified';

    return {
        residents,
        property: {
            occupancy_status: occupancyStatus,
            empty_duration_years: Number.isFinite(userFacts.property_empty_years) ? userFacts.property_empty_years : 0,
            has_disabled_adaptation: Boolean(userFacts.has_disabled_adaptations),
            valuation_band: userFacts.property_band,
            disabled_resident: Boolean(userFacts.disabled_resident),
        },
        // Synthetic single-person view for rules that check person.* facts.
        // Used by SMI and carer disregard rules where the flat model doesn't
        // enumerate individual persons.
        person: {
            is_full_time_student: students > 0,
            is_severely_mentally_impaired: smi > 0,
            // Default to true if not explicitly denied — flagged as missing fact when smi > 0
            receives_qualifying_smi_benefit: userFacts.smi_qualifying_benefit !== false,
            is_carer: carers > 0,
            hours_of_care_per_week: carers > 0 ? (userFacts.care_hours_per_week || 40) : 0,
            cared_for_receives_qualifying_benefit: carers > 0,
            relationship_to_cared_for: userFacts.carer_relationship || 'non_relation',
            receiving_pension_credit: Boolean(userFacts.receiving_pension_credit),
            on_qualifying_benefit: Boolean(userFacts.on_qualifying_benefit),
            savings: Number.isFinite(userFacts.savings) ? userFacts.savings : undefined,
        },
        derived: {
            // Pre-computed so branching_effects can reference it without a separate disregard pass
            counted_adults_after_disregards: countingAdults,
        },
        workflow: { completed_stages: [] },
    };
}

module.exports = { evaluateRule, buildCaseContext, evalConditions, computeDerived, resolvePath };
