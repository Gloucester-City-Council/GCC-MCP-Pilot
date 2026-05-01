'use strict';

/**
 * ct_evaluate tool — runtime-first eligibility resolver for the revised council tax schema.
 *
 * Key differences from schemaEvaluate.js (original schema):
 *   - executable_rules is a top-level array on rulesDoc (not .executable_rule_slices.rules)
 *   - discounts/exemptions are flat arrays on factsDoc (not nested adjustment_catalogue)
 *   - premiums are an object with named keys (empty_homes, second_homes)
 *   - council_tax_support is a flat object on factsDoc
 *   - howToApply / applyUrl are enriched from the channel overlay document
 */

const { ERROR_CODES, createError, createSuccess } = require('../util/errors');
const { getSchema, getDocument } = require('../schema/revisedLoader');
const { evaluateRule, buildCaseContext } = require('../schema/ruleInterpreter');

const RULESETS = ['discount_eligibility'];
const PROJECTION_MODES = ['runtime', 'trace', 'debug'];

const OUTCOME_STAGES = new Set([
    'valuation_reduction',
    'apply_exemptions',
    'apply_statutory_discounts_and_disregards',
    'apply_local_discretionary_reductions',
    'apply_premiums',
    'discounts',
    'apply_local_council_tax_support',
]);

// ─── Catalogue lookup (revised schema) ───────────────────────────────────────

function extractIdFromRef(ref) {
    const bracket = ref.match(/\[([^\]]+)\]$/);
    if (bracket) return bracket[1];
    const adj = ref.match(/^adjustment_rules\.(.+)$/);
    if (adj) return adj[1];
    return null;
}

function lookupDiscount(factsDoc, id) {
    const list = factsDoc.discounts || [];
    return list.find(d => d.id === id) || null;
}

function lookupExemption(factsDoc, id) {
    const list = factsDoc.exemptions || [];
    return list.find(e => e.id === id || (e.class && `class-${e.class.toLowerCase()}` === id)) || null;
}

function lookupPremium(factsDoc, id) {
    const premiums = factsDoc.premiums || {};
    if (id === 'empty_homes_premium' || id === 'empty-homes-premium') return premiums.empty_homes || null;
    if (id === 'second_homes_premium' || id === 'second-homes-premium') return premiums.second_homes || null;
    // Try direct key lookup
    return premiums[id] || null;
}

const RULE_CATALOGUE_OVERRIDES = {
    'rule.exemption.student.all_residents': (factsDoc) => {
        const item = lookupExemption(factsDoc, 'class-n');
        return item ? { section: 'exemptions', item } : null;
    },
    'rule.premium.empty_property_long_term': (factsDoc) => {
        const item = lookupPremium(factsDoc, 'empty_homes_premium');
        return item ? { section: 'premiums', item } : null;
    },
    'rule.premium.second_home': (factsDoc) => {
        const item = lookupPremium(factsDoc, 'second_homes_premium');
        return item ? { section: 'premiums', item } : null;
    },
    'rule.cts.pension_credit_claimant': (factsDoc) => {
        return factsDoc.council_tax_support ? { section: 'council_tax_support', item: factsDoc.council_tax_support } : null;
    },
    'rule.cts.benefits_claimant': (factsDoc) => {
        return factsDoc.council_tax_support ? { section: 'council_tax_support', item: factsDoc.council_tax_support } : null;
    },
    'rule.cts.low_income': (factsDoc) => {
        return factsDoc.council_tax_support ? { section: 'council_tax_support', item: factsDoc.council_tax_support } : null;
    },
    'rule.cts.savings_above_threshold': (factsDoc) => {
        return factsDoc.council_tax_support ? { section: 'council_tax_support', item: factsDoc.council_tax_support } : null;
    },
};

function lookupCatalogueEntry(rule, factsDoc) {
    const override = RULE_CATALOGUE_OVERRIDES[rule.rule_id];
    if (override) {
        const entry = override(factsDoc);
        if (entry) return entry;
    }

    for (const ref of (rule.source_rule_refs || [])) {
        const id = extractIdFromRef(ref);
        if (!id) continue;

        const discount = lookupDiscount(factsDoc, id);
        if (discount) return { section: 'discounts', item: discount };

        const exemption = lookupExemption(factsDoc, id);
        if (exemption) return { section: 'exemptions', item: exemption };

        const premium = lookupPremium(factsDoc, id);
        if (premium) return { section: 'premiums', item: premium };
    }

    if (rule.mechanism === 'council_tax_support' && factsDoc.council_tax_support) {
        return { section: 'council_tax_support', item: factsDoc.council_tax_support };
    }

    return null;
}

function enrichWithChannelOverlay(entry, channelDoc) {
    if (!entry || !channelDoc) return entry;
    const byFactId = (channelDoc.by_fact_id) || {};
    const id = entry.item && (entry.item.id || entry.item.scheme_id);
    if (!id) return entry;
    const overlay = byFactId[id];
    if (!overlay) return entry;
    return {
        ...entry,
        item: { ...entry.item, _channel: overlay },
    };
}

// ─── Effect scoring ───────────────────────────────────────────────────────────

const EFFECT_SCORE = {
    set_zero_charge: 1000,
    percentage_reduction: v => 500 + (v || 0),
    band_shift: 450,
    fractional_reduction: 450,
    means_tested_reduction: 400,
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

// ─── Display helpers ──────────────────────────────────────────────────────────

function formatEffect(effect, catalogueItem, mechanism) {
    if (effect) {
        const t = effect.effect_type;
        const v = effect.value;
        if (t === 'set_zero_charge') return mechanism === 'exemption' ? '100% exemption — no council tax due' : '100% discount (nil charge)';
        if (t === 'percentage_reduction' && v === 100) return '100% discount';
        if (t === 'percentage_reduction') return `${v}% off your bill`;
        if (t === 'percentage_premium') return `${v}% premium (total bill = ${100 + v}% of standard charge)`;
        if (t === 'band_shift') return 'Bill reduced to one band lower than actual valuation band';
        if (t === 'fractional_reduction') return `${v} reduction on Band A charge`;
        if (t === 'means_tested_reduction') return 'Potential Council Tax Support — amount depends on income and savings assessment';
        if (t === 'no_adjustment') return 'No discount applies given current household composition';
    }
    // Fallback to catalogue item's effect field (revised schema discounts store effect as a string like "25%")
    const raw = catalogueItem ? (catalogueItem.effect || catalogueItem.premium_rate) : null;
    if (!raw) return 'See policy';
    return typeof raw === 'string' ? raw : 'See policy';
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
        else if (t === 'means_tested_reduction') reasons.push('You may qualify for Council Tax Support — a formal income and savings assessment is required');
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
    return item.id || item.scheme_id || item.premium_id || item.class || rule.rule_id;
}

function buildCandidate(rule, result, likelihood, catalogueEntry) {
    const item = catalogueEntry ? catalogueEntry.item : null;
    const channel = item && item._channel;
    const effect = result.effect;

    const candidate = {
        id: candidateId(rule, catalogueEntry),
        ruleId: rule.rule_id,
        name: item ? (item.name || item.scheme_name || item.premium_name || rule.name) : rule.name,
        amount: formatEffect(effect, item, rule.mechanism),
        mechanism: rule.mechanism,
        legalBasis: item ? (item.legislation || item.legal_basis_type || '') : '',
        likelihood,
        jsonPath: catalogueEntry ? `/${catalogueEntry.section}` : undefined,
        reasons: likelihood === 'likely'
            ? buildReasons(rule, result, effect)
            : ['Not eligible based on the information provided'],
    };

    if (channel && channel.how_to_apply) {
        const steps = channel.how_to_apply;
        candidate.howToApply = Array.isArray(steps) ? steps[0] : steps;
    } else if (item && item.application_process && item.application_process.how_to_apply) {
        const steps = item.application_process.how_to_apply;
        candidate.howToApply = Array.isArray(steps) ? steps[0] : steps;
    }

    if (channel && channel.url) candidate.applyUrl = channel.url;
    else if (item && item.url) candidate.applyUrl = item.url;

    return candidate;
}

// ─── Missing facts ────────────────────────────────────────────────────────────

function getMissingFacts(facts) {
    const missing = [];
    if (facts.adults === undefined) missing.push('adults — how many adults (aged 18+) live at the property?');
    if (facts.students === undefined && facts.adults >= 1) missing.push('students — are any adults full-time students?');
    if (facts.age === undefined && facts.care_leaver) missing.push('age — how old are you? (care leaver discount covers ages 18–24)');
    if (facts.disabled_resident === undefined && facts.has_disabled_adaptations) missing.push('disabled_resident — does a disabled person live there as their main home?');
    if (facts.has_disabled_adaptations === undefined && facts.disabled_resident) missing.push('has_disabled_adaptations — does the property have qualifying disabled adaptations?');
    if (facts.has_disabled_adaptations && facts.property_band === undefined) missing.push('property_band — what is your council tax valuation band (A–H)?');
    if (facts.property_empty && facts.property_empty_years === undefined) missing.push('property_empty_years — how long has the property been empty?');
    if (facts.severely_mentally_impaired > 0 && facts.smi_qualifying_benefit === undefined) missing.push('smi_qualifying_benefit — does the person with SMI receive a qualifying benefit?');
    if (facts.savings === undefined && !facts.property_empty && !facts.second_home && Number.isFinite(facts.adults) && facts.adults >= 1) {
        missing.push('savings — do you have savings or investments above £16,000? (affects Council Tax Support eligibility)');
    }
    return missing;
}

// ─── Likelihood assessment ────────────────────────────────────────────────────

const BRANCHING_INPUTS = { 'property.valuation_band': ['property_band'] };

function assessLikelihood(ruleResult, rule, userFacts) {
    if (!ruleResult || !ruleResult.eligible) return 'unlikely';
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

// ─── No-resident fallback ────────────────────────────────────────────────────

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

function detectFactConflicts(userFacts) {
    const conflicts = [];
    const countFields = ['adults', 'students', 'carers', 'severely_mentally_impaired'];
    for (const field of countFields) {
        const value = userFacts[field];
        if (value === undefined) continue;
        if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
            conflicts.push({ code: 'invalid_count', field, message: `${field} must be a non-negative integer`, observed: value });
        }
    }
    if (Number.isFinite(userFacts.adults) && Number.isFinite(userFacts.students) && userFacts.students > userFacts.adults) {
        conflicts.push({ code: 'impossible_household_count', field: 'students', message: 'students cannot exceed adults', observed: { adults: userFacts.adults, students: userFacts.students } });
    }
    if (Number.isFinite(userFacts.adults) && Number.isFinite(userFacts.carers) && userFacts.carers > userFacts.adults) {
        conflicts.push({ code: 'impossible_household_count', field: 'carers', message: 'carers cannot exceed adults', observed: { adults: userFacts.adults, carers: userFacts.carers } });
    }
    if (Number.isFinite(userFacts.adults) && Number.isFinite(userFacts.severely_mentally_impaired) && userFacts.severely_mentally_impaired > userFacts.adults) {
        conflicts.push({ code: 'impossible_household_count', field: 'severely_mentally_impaired', message: 'severely_mentally_impaired cannot exceed adults', observed: { adults: userFacts.adults, severely_mentally_impaired: userFacts.severely_mentally_impaired } });
    }
    return conflicts;
}

// ─── Main resolver ────────────────────────────────────────────────────────────

function runRuntimeResolver(userFacts, rulesetId, projectionMode) {
    const rulesDoc = getDocument('rules');
    const factsDoc = getDocument('facts');
    const channelDoc = getDocument('channel_overlay');

    // Revised schema: executable_rules is a direct array on rulesDoc
    const allRules = Array.isArray(rulesDoc.executable_rules) ? rulesDoc.executable_rules : [];

    const caseCtx = buildCaseContext(userFacts);
    const candidates = [];
    const rulesUsed = [];

    for (const rule of allRules) {
        if (!OUTCOME_STAGES.has(rule.stage)) continue;

        const result = evaluateRule(rule, caseCtx);
        if (!result) continue;

        let catalogueEntry = lookupCatalogueEntry(rule, factsDoc);
        if (catalogueEntry && channelDoc) {
            catalogueEntry = enrichWithChannelOverlay(catalogueEntry, channelDoc);
        }

        const likelihood = assessLikelihood(result, rule, userFacts);
        const candidate = buildCandidate(rule, result, likelihood, catalogueEntry);
        candidate._effect = result.effect;

        candidates.push(candidate);
        if (result.eligible) rulesUsed.push(rule.rule_id);
    }

    const scoredCandidates = candidates.map(c => ({
        ...c,
        _score: (c.likelihood === 'likely' ? 10000 : c.likelihood === 'unclear' ? 5000 : 0) + effectScore(c._effect),
    }));
    scoredCandidates.sort((a, b) => b._score - a._score);

    const hasPremium = scoredCandidates.some(c => c.likelihood === 'likely' && c.mechanism === 'premium');

    const ranked = scoredCandidates.map(c => {
        const next = { ...c };
        delete next._score;
        delete next._effect;
        if (c.mechanism === 'council_tax_support') {
            next.candidateRole = 'cts_candidate';
        } else if (hasPremium && c.mechanism !== 'premium' && c.mechanism !== 'guidance') {
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
    const hasScenarioFacts = Boolean(
        userFacts.has_disabled_adaptations || userFacts.disabled_resident ||
        userFacts.property_empty || userFacts.second_home || userFacts.care_leaver ||
        (userFacts.severely_mentally_impaired > 0) || (userFacts.students > 0)
    );
    const bestOutcome = finalPool.length > 0
        ? finalPool[0]
        : (hasScenarioFacts ? ranked.filter(c => c.candidateRole === 'alternative').find(Boolean) : null) || null;

    const missingCriticalFacts = getMissingFacts(userFacts);
    const resolvedBestOutcome = bestOutcome || { ...NO_RESIDENT_GUIDANCE, outcome_state: 'guidance_fallback' };

    const result = {
        best_outcome: resolvedBestOutcome,
        why_best_outcome_won: bestOutcome
            ? `${bestOutcome.name} selected — mechanism: ${bestOutcome.mechanism}, score: highest eligible candidate`
            : 'No eligible outcome resolved from the supplied facts — owner-liability guidance returned',
        options: {
            supporting_candidates: [...finalPool.slice(1), ...ranked.filter(c => c.candidateRole === 'support_logic')],
            alternative_outcomes: ranked.filter(c => c.candidateRole === 'alternative'),
            rejected_outcomes: ranked.filter(c => c.candidateRole === 'rejected'),
            council_tax_support_options: ranked.filter(c => c.candidateRole === 'cts_candidate'),
        },
        facts: {
            input_facts: userFacts,
            derived_facts: {
                has_likely_outcome: bestOutcome !== null,
                requires_manual_review: missingCriticalFacts.length > 0,
                review_reasons: missingCriticalFacts.length > 0 ? [`Missing critical facts: ${missingCriticalFacts.length}`] : [],
            },
            normalised_household: {
                adults: Number.isFinite(userFacts.adults) ? userFacts.adults : null,
                counting_adults: caseCtx.derived.counted_adults_after_disregards,
                disregarded_adults: Number.isFinite(userFacts.adults)
                    ? Math.max(0, userFacts.adults - caseCtx.derived.counted_adults_after_disregards)
                    : null,
            },
        },
        missing_critical_facts: missingCriticalFacts,
        unresolved_conflicts: [],
        confidence: buildConfidence(bestOutcome, missingCriticalFacts),
        trace: {
            resolver_version: 'revised-schema-1.0',
            projection_mode: projectionMode,
            ruleset_id: rulesetId,
            rules_evaluated: allRules.filter(r => OUTCOME_STAGES.has(r.stage)).length,
            rules_used: rulesUsed,
            note: "This is guidance based on Gloucester City Council's approved 2026/27 council tax policy. Your actual entitlement depends on your individual circumstances and a formal assessment by the council's Revenues team.",
        },
    };

    if (result.confidence.overall <= 0.25 && result.options.council_tax_support_options.length > 2) {
        const [primary, ...secondary] = result.options.council_tax_support_options;
        result.options.council_tax_support_options = [primary];
        result.options.secondary_council_tax_support_options = secondary;
    }

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
        return createError(ERROR_CODES.SCHEMA_LOAD_FAILED, 'Revised council tax schema could not be loaded');
    }

    const { rulesetId, userFacts, projectionMode = 'runtime' } = input;

    if (!rulesetId || typeof rulesetId !== 'string') {
        return createError(ERROR_CODES.BAD_REQUEST, 'Missing or invalid "rulesetId" parameter', { availableRulesets: RULESETS });
    }
    if (!RULESETS.includes(rulesetId)) {
        return createError(ERROR_CODES.BAD_REQUEST, `Unknown ruleset "${rulesetId}"`, { availableRulesets: RULESETS });
    }
    if (!userFacts || typeof userFacts !== 'object') {
        return createError(ERROR_CODES.BAD_REQUEST, 'Missing or invalid "userFacts" parameter');
    }
    if (!PROJECTION_MODES.includes(projectionMode)) {
        return createError(ERROR_CODES.BAD_REQUEST, `Unknown projectionMode "${projectionMode}"`, { availableProjectionModes: PROJECTION_MODES });
    }

    const conflicts = detectFactConflicts(userFacts);
    if (conflicts.length > 0) {
        const missingFacts = getMissingFacts(userFacts);
        return createSuccess({
            rulesetId,
            userFacts,
            projectionMode,
            best_outcome: { ...NO_RESIDENT_GUIDANCE, outcome_state: 'validation_conflict' },
            why_best_outcome_won: 'Input validation conflicts detected — eligibility was not resolved',
            options: { supporting_candidates: [], alternative_outcomes: [], rejected_outcomes: [], council_tax_support_options: [] },
            facts: {
                input_facts: userFacts,
                derived_facts: { has_likely_outcome: false, requires_manual_review: true, review_reasons: ['Input validation conflicts must be resolved before evaluation'] },
                normalised_household: { adults: Number.isFinite(userFacts.adults) ? userFacts.adults : null, counting_adults: null, disregarded_adults: null },
            },
            missing_critical_facts: missingFacts,
            unresolved_conflicts: conflicts,
            confidence: { overall: 0, best_outcome_likelihood: 'unclear', missing_critical_facts_count: missingFacts.length },
            trace: {
                resolver_version: 'revised-schema-1.0',
                projection_mode: projectionMode,
                ruleset_id: rulesetId,
                rules_evaluated: 0,
                rules_used: [],
                note: 'Input conflicts were detected. Please correct the facts and retry before relying on this guidance.',
            },
        });
    }

    try {
        const result = runRuntimeResolver(userFacts, rulesetId, projectionMode);
        return createSuccess({ rulesetId, userFacts, projectionMode, ...result });
    } catch (err) {
        return createError(ERROR_CODES.INTERNAL_ERROR, `Evaluation failed: ${err.message}`);
    }
}

module.exports = { execute, RULESETS };
