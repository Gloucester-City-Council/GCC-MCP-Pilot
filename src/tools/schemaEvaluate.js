'use strict';

/**
 * schema.evaluate tool — runtime-first council tax eligibility resolver.
 *
 * All evaluation logic is driven by the schema's executable_rule_slices.
 * The generic interpreter (ruleInterpreter.js) evaluates conditions and
 * resolves effects. This file handles:
 *   - mapping flat userFacts to the case context model
 *   - looking up display info from the adjustment_catalogue
 *   - ranking candidates and building the final response shape
 *
 * Adding a new rule to the schema document requires no code changes here.
 */

const { ERROR_CODES, createError, createSuccess } = require('../util/errors');
const { getSchema, getDocument } = require('../schema/loader');
const { evaluateRule, buildCaseContext } = require('../schema/ruleInterpreter');

const RULESETS = ['discount_eligibility'];
const PROJECTION_MODES = ['runtime', 'trace', 'debug'];

// Stages that produce direct user-facing outcomes.
// Disregard and workflow stages are handled internally by derived_values.
const OUTCOME_STAGES = new Set([
    'valuation_reduction',
    'apply_exemptions',
    'apply_statutory_discounts_and_disregards',
    'apply_local_discretionary_reductions',
    'apply_premiums',
    'discounts',
]);

// Where source_rule_refs doesn't map directly to a catalogue item ID, these
// overrides point to the right section and item. Kept intentionally small.
const CATALOGUE_OVERRIDES = {
    'rule.exemption.student.all_residents': { section: 'exemptions', id: 'class-n' },
    'rule.premium.empty_property_long_term': { section: 'property_premiums', id: 'empty_homes_premium' },
    'rule.premium.second_home': { section: 'property_premiums', id: 'second_homes_premium' },
};

// Scores used to rank candidates by how beneficial they are to the user.
const EFFECT_SCORE = {
    set_zero_charge: 1000,
    percentage_reduction: v => 500 + (v || 0),
    band_shift: 450,
    fractional_reduction: 450,
    mark_disregarded: 100,
    percentage_premium: v => 200 + (v || 0),
    no_adjustment: -50,
};

function effectScore(effect) {
    if (!effect) return 0;
    const fn = EFFECT_SCORE[effect.effect_type];
    if (typeof fn === 'function') return fn(effect.value);
    return typeof fn === 'number' ? fn : 0;
}

// ─── Catalogue lookup ────────────────────────────────────────────────────────

function extractIdFromRef(ref) {
    const bracket = ref.match(/\[([^\]]+)\]$/);
    if (bracket) return bracket[1];
    const adj = ref.match(/^adjustment_rules\.(.+)$/);
    if (adj) return adj[1];
    return null;
}

function searchCatalogueSection(adj, section, id) {
    if (!adj[section]) return null;
    if (Array.isArray(adj[section].items)) {
        return adj[section].items.find(i => i.id === id) || null;
    }
    // property_premiums uses named keys, not an items array
    return adj[section][id] || null;
}

function lookupCatalogueEntry(rule, adj) {
    const override = CATALOGUE_OVERRIDES[rule.rule_id];
    if (override) {
        const item = searchCatalogueSection(adj, override.section, override.id);
        if (item) return { section: override.section, item };
    }

    for (const ref of (rule.source_rule_refs || [])) {
        const id = extractIdFromRef(ref);
        if (!id) continue;
        for (const section of ['discounts', 'exemptions', 'property_premiums']) {
            const item = searchCatalogueSection(adj, section, id);
            if (item) return { section, item };
        }
    }
    return null;
}

// ─── Display helpers ─────────────────────────────────────────────────────────

function formatEffect(effect, catalogueItem, mechanism) {
    if (effect) {
        const t = effect.effect_type;
        const v = effect.value;
        if (t === 'set_zero_charge') {
            return mechanism === 'exemption'
                ? '100% exemption — no council tax due'
                : '100% discount (nil charge)';
        }
        if (t === 'percentage_reduction' && v === 100) return '100% discount';
        if (t === 'percentage_reduction') return `${v}% off your bill`;
        if (t === 'percentage_premium') return `${v}% premium (total bill = ${100 + v}% of standard charge)`;
        if (t === 'band_shift') return 'Bill reduced to one band lower than actual valuation band';
        if (t === 'fractional_reduction') return `${v} reduction on Band A charge`;
        if (t === 'no_adjustment') return 'No discount applies given current household composition';
    }
    return catalogueItem ? String(catalogueItem.effect || catalogueItem.premium_rate || 'See policy') : 'See policy';
}

const DERIVED_LABELS = {
    counted_adults: v => `${v} adult(s) counted for council tax purposes`,
    non_student_residents: v => v === 0 ? 'All residents are full-time students' : `${v} non-student resident(s) in household`,
    care_leavers_aged_18_to_24: v => `${v} care leaver(s) aged 18–24 in household`,
    other_counted_adults: v => v === 0 ? 'No other counted adults in the household' : `${v} other counted adult(s) alongside care leaver`,
};

function buildReasons(rule, result, effect) {
    const reasons = [];
    for (const [key, val] of Object.entries(result.derived || {})) {
        const label = DERIVED_LABELS[key] ? DERIVED_LABELS[key](val) : null;
        if (label) reasons.push(label);
    }
    if (effect) {
        const t = effect.effect_type;
        const v = effect.value;
        if (t === 'set_zero_charge') reasons.push('Your property is exempt — no council tax is charged');
        else if (t === 'percentage_reduction') reasons.push(`A ${v}% reduction applies to your council tax bill`);
        else if (t === 'percentage_premium') reasons.push(`A ${v}% premium is added to your council tax bill`);
        else if (t === 'band_shift') reasons.push('Your property is charged at one band lower than its actual valuation band');
    }
    if (reasons.length === 0 && rule.explanation_template) {
        reasons.push(rule.explanation_template.text || rule.name);
    }
    return reasons;
}

// ─── Candidate building ───────────────────────────────────────────────────────

function candidateId(rule, catalogueEntry) {
    if (!catalogueEntry) return rule.rule_id;
    const item = catalogueEntry.item;
    return item.id || item.premium_id || item.class || rule.rule_id;
}

function buildCandidate(rule, result, likelihood, catalogueEntry) {
    const item = catalogueEntry ? catalogueEntry.item : null;
    const effect = result.effect;
    const amount = formatEffect(effect, item, rule.mechanism);
    const reasons = likelihood === 'likely'
        ? buildReasons(rule, result, effect)
        : ['Not eligible based on the information provided'];

    const candidate = {
        id: candidateId(rule, catalogueEntry),
        ruleId: rule.rule_id,
        name: item ? (item.name || item.premium_name || rule.name) : rule.name,
        amount,
        mechanism: rule.mechanism,
        legalBasis: item && item.legal_basis ? (item.legal_basis.legislation || '') : '',
        likelihood,
        jsonPath: catalogueEntry ? `/${catalogueEntry.section}` : undefined,
        reasons,
    };

    if (item && item.application_process && item.application_process.how_to_apply) {
        const steps = item.application_process.how_to_apply;
        candidate.howToApply = Array.isArray(steps) ? steps[0] : steps;
    }
    if (item && item.url) candidate.applyUrl = item.url;

    return candidate;
}

// ─── Missing facts ────────────────────────────────────────────────────────────

function getMissingFacts(facts) {
    const missing = [];
    if (facts.adults === undefined) {
        missing.push('adults — how many adults (aged 18+) live at the property?');
    }
    if (facts.students === undefined && facts.adults >= 1) {
        missing.push('students — are any adults full-time students? (affects Class N exemption and disregard logic)');
    }
    if (facts.age === undefined && facts.care_leaver) {
        missing.push('age — how old are you? (care leaver discount applies to ages 18–24)');
    }
    if (facts.disabled_resident === undefined && facts.has_disabled_adaptations) {
        missing.push('disabled_resident — does a disabled person live at the property as their main home?');
    }
    if (facts.has_disabled_adaptations === undefined && facts.disabled_resident) {
        missing.push('has_disabled_adaptations — does the property have qualifying adaptations (extra bathroom, wheelchair room, etc.)?');
    }
    if (facts.has_disabled_adaptations && facts.property_band === undefined) {
        missing.push('property_band — what is your council tax valuation band (A–H)? (determines the exact reduction amount)');
    }
    if (facts.property_empty && facts.property_empty_years === undefined) {
        missing.push('property_empty_years — how long has the property been empty? (affects premium level)');
    }
    if (facts.severely_mentally_impaired > 0 && facts.smi_qualifying_benefit === undefined) {
        missing.push('smi_qualifying_benefit — does the person with SMI receive a qualifying benefit (PIP, DLA, Attendance Allowance, ESA support group, UC limited capability, or IS with disability premium)?');
    }
    return missing;
}

// ─── Likelihood assessment ────────────────────────────────────────────────────

// Branching facts whose absence makes an eligible-but-no-effect rule 'unclear'.
const BRANCHING_INPUTS = { 'property.valuation_band': ['property_band'] };

// Returns 'likely' | 'unclear' | 'unlikely'
function assessLikelihood(ruleResult, rule, userFacts) {
    if (!ruleResult || !ruleResult.eligible) return 'unlikely';

    // Rule fired but no effect branch matched
    if (!ruleResult.effect) {
        const hasMissingBranchFact = (rule.branching_effects || []).some(branch =>
            (branch.when || []).some(c => {
                const keys = BRANCHING_INPUTS[c.fact];
                return keys && keys.some(k => userFacts[k] === undefined);
            })
        );
        return hasMissingBranchFact ? 'unclear' : 'unlikely';
    }

    if (ruleResult.effect.effect_type === 'no_adjustment') return 'unlikely';
    return 'likely';
}

// ─── No-resident fallback ─────────────────────────────────────────────────────

const NO_RESIDENT_GUIDANCE = {
    id: 'no-resident-guidance',
    ruleId: null,
    name: 'No Resident Adults — Owner Liability',
    amount: 'Standard charge applies (owner liable)',
    mechanism: 'guidance',
    likelihood: 'unclear',
    legalBasis: 'Local Government Finance Act 1992, ss.6–9 (liability hierarchy)',
    reasons: [
        'No adult residents have been recorded. Where a property has no residents, the owner is usually liable for council tax.',
        'If the property is empty, exemptions or a discount may apply depending on how long it has been unoccupied and the reason.',
        'Please provide the number of adults (18+) living at the property, or confirm the property is empty or unoccupied.',
    ],
    howToApply: 'Contact Gloucester City Council Revenues team to clarify your liability',
};

// ─── Main resolver ────────────────────────────────────────────────────────────

function runRuntimeResolver(userFacts, rulesetId, projectionMode) {
    const rulesDoc = getDocument('rules');
    const factsDoc = getDocument('facts');
    const adj = factsDoc.adjustment_catalogue;
    const allRules = (rulesDoc.executable_rule_slices && rulesDoc.executable_rule_slices.rules) || [];

    const caseCtx = buildCaseContext(userFacts);

    const candidates = [];
    const rulesUsed = [];

    for (const rule of allRules) {
        if (!OUTCOME_STAGES.has(rule.stage)) continue;

        const result = evaluateRule(rule, caseCtx);
        if (!result) continue;

        const catalogueEntry = lookupCatalogueEntry(rule, adj);
        const likelihood = assessLikelihood(result, rule, userFacts);
        const candidate = buildCandidate(rule, result, likelihood, catalogueEntry);
        candidate._effect = result.effect; // kept for scoring; removed before output

        candidates.push(candidate);
        if (result.eligible) rulesUsed.push(rule.rule_id);
    }

    // Sort: likely first, then by effect score (uses raw _effect stored on candidate)
    const scoredCandidates = candidates.map(c => ({
        ...c,
        _score: (c.likelihood === 'likely' ? 10000 : c.likelihood === 'unclear' ? 5000 : 0) + effectScore(c._effect),
    }));
    scoredCandidates.sort((a, b) => b._score - a._score);

    // Handle premium-dominates-discount logic: if a premium fires, occupancy
    // discounts don't apply to the same property state.
    // Disregard rules become support_logic rather than stand-alone outcomes.
    const hasPremium = scoredCandidates.some(c => c.likelihood === 'likely' && c.mechanism === 'premium');
    const ranked = scoredCandidates.map(c => {
        const next = { ...c };
        delete next._score;
        delete next._effect;
        if (hasPremium && c.mechanism !== 'premium' && c.mechanism !== 'guidance') {
            next.candidateRole = 'rejected';
            next.likelihood = 'unlikely';
            next.reasons = [...(next.reasons || []), 'Property-state premium applies — occupancy discounts do not apply in this scenario'];
        } else if (c.mechanism === 'disregard') {
            next.candidateRole = 'support_logic';
        } else if (!next.candidateRole) {
            next.candidateRole = c.likelihood === 'likely' ? 'final_outcome' : c.likelihood === 'unclear' ? 'alternative' : 'rejected';
        }
        return next;
    });

    const finalPool = ranked.filter(c => c.candidateRole === 'final_outcome');
    // Fall back to the best 'unclear' candidate only when the user provided at least one
    // scenario-specific fact — otherwise return null so the no-resident guidance appears.
    const hasScenarioFacts = Boolean(
        userFacts.has_disabled_adaptations || userFacts.disabled_resident ||
        userFacts.property_empty || userFacts.second_home || userFacts.care_leaver ||
        (userFacts.severely_mentally_impaired > 0) || (userFacts.students > 0)
    );
    const bestOutcome = finalPool.length > 0
        ? finalPool[0]
        : (hasScenarioFacts ? ranked.filter(c => c.candidateRole === 'alternative').find(Boolean) : null) || null;

    const missingCriticalFacts = getMissingFacts(userFacts);

    const result = {
        best_outcome: bestOutcome || NO_RESIDENT_GUIDANCE,
        why_best_outcome_won: bestOutcome
            ? `${bestOutcome.name} selected — mechanism: ${bestOutcome.mechanism}, score: highest eligible candidate`
            : 'No eligible outcome resolved from the supplied facts — owner-liability guidance returned',
        options: {
            supporting_candidates: [
                ...finalPool.slice(1),
                ...ranked.filter(c => c.candidateRole === 'support_logic'),
            ],
            alternative_outcomes: ranked.filter(c => c.candidateRole === 'alternative'),
            rejected_outcomes: ranked.filter(c => c.candidateRole === 'rejected'),
        },
        facts: {
            input_facts: userFacts,
            derived_facts: {
                has_likely_outcome: bestOutcome !== null,
                requires_manual_review: missingCriticalFacts.length > 0,
                review_reasons: missingCriticalFacts.length > 0 ? [`Missing critical facts: ${missingCriticalFacts.length}`] : [],
            },
            normalised_household: {
                adults: Number.isFinite(userFacts.adults) ? userFacts.adults : 0,
                counting_adults: caseCtx.derived.counted_adults_after_disregards,
                disregarded_adults: Math.max(0, (Number.isFinite(userFacts.adults) ? userFacts.adults : 0) - caseCtx.derived.counted_adults_after_disregards),
            },
        },
        missing_critical_facts: missingCriticalFacts,
        unresolved_conflicts: [],
        confidence: buildConfidence(bestOutcome, missingCriticalFacts),
        trace: {
            resolver_version: '2.5.7-schema-driven',
            projection_mode: projectionMode,
            ruleset_id: rulesetId,
            rules_evaluated: allRules.filter(r => OUTCOME_STAGES.has(r.stage)).length,
            rules_used: rulesUsed,
            note: "This is guidance based on Gloucester City Council's approved 2026/27 council tax policy. Your actual entitlement depends on your individual circumstances and a formal assessment by the council's Revenues team.",
        },
    };

    return projectResult(result, projectionMode);
}

function buildConfidence(bestOutcome, missingCriticalFacts) {
    const base = !bestOutcome ? 0.2
        : bestOutcome.likelihood === 'likely' ? 0.85
        : bestOutcome.likelihood === 'unclear' ? 0.55 : 0.3;
    const weight = Math.min(0.4, missingCriticalFacts.length * 0.1);
    return {
        overall: Math.max(0, Number((base - weight).toFixed(2))),
        best_outcome_likelihood: bestOutcome ? bestOutcome.likelihood : 'unclear',
        missing_critical_facts_count: missingCriticalFacts.length,
    };
}

function projectResult(result, projectionMode) {
    const mode = PROJECTION_MODES.includes(projectionMode) ? projectionMode : 'runtime';
    if (mode === 'debug') return result;
    if (mode === 'trace') {
        return {
            best_outcome: result.best_outcome,
            why_best_outcome_won: result.why_best_outcome_won,
            facts: result.facts,
            missing_critical_facts: result.missing_critical_facts,
            unresolved_conflicts: result.unresolved_conflicts,
            confidence: result.confidence,
            trace: result.trace,
        };
    }
    return {
        best_outcome: result.best_outcome,
        why_best_outcome_won: result.why_best_outcome_won,
        options: result.options,
        facts: result.facts,
        missing_critical_facts: result.missing_critical_facts,
        unresolved_conflicts: result.unresolved_conflicts,
        confidence: result.confidence,
        trace: {
            resolver_version: result.trace.resolver_version,
            projection_mode: result.trace.projection_mode,
            ruleset_id: result.trace.ruleset_id,
            rules_evaluated: result.trace.rules_evaluated,
            note: result.trace.note,
        },
    };
}

// ─── Tool entry point ─────────────────────────────────────────────────────────

function execute(input = {}) {
    if (!getSchema()) {
        return createError(ERROR_CODES.SCHEMA_LOAD_FAILED, 'Council tax schema could not be loaded');
    }

    const { rulesetId, userFacts, projectionMode = 'runtime' } = input;

    if (!rulesetId || typeof rulesetId !== 'string') {
        return createError(ERROR_CODES.BAD_REQUEST, 'Missing or invalid "rulesetId" parameter', { availableRulesets: RULESETS });
    }
    if (!RULESETS.includes(rulesetId)) {
        return createError(ERROR_CODES.BAD_REQUEST, `Unknown ruleset "${rulesetId}"`, { availableRulesets: RULESETS });
    }
    if (!userFacts || typeof userFacts !== 'object') {
        return createError(ERROR_CODES.BAD_REQUEST, 'Missing or invalid "userFacts" parameter — tell us about your household circumstances');
    }
    if (!PROJECTION_MODES.includes(projectionMode)) {
        return createError(ERROR_CODES.BAD_REQUEST, `Unknown projectionMode "${projectionMode}"`, { availableProjectionModes: PROJECTION_MODES });
    }

    try {
        const result = runRuntimeResolver(userFacts, rulesetId, projectionMode);
        return createSuccess({ rulesetId, userFacts, projectionMode, ...result });
    } catch (err) {
        return createError(ERROR_CODES.INTERNAL_ERROR, `Evaluation failed: ${err.message}`);
    }
}

module.exports = { execute, RULESETS };
