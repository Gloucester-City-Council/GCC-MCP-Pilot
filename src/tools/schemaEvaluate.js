/**
 * schema.evaluate tool - Evaluate council tax eligibility against user facts
 * Uses executable rule slices from the 2026/27 rules document and
 * discount/exemption catalogue from the facts document.
 *
 * Currently implements: discount_eligibility ruleset
 * Covers: 20 executable rules across discounts, exemptions, disregards,
 *         reductions and premiums.
 */

const { ERROR_CODES, createError, createSuccess } = require('../util/errors');
const { getSchema, getDocument } = require('../schema/loader');

const RULESETS = ['discount_eligibility'];
const PROJECTION_MODES = ['runtime', 'trace', 'debug'];

/**
 * Find a discount item by ID from the adjustment catalogue
 */
function findDiscountItem(schema, discountId) {
    const items = schema.discounts && schema.discounts.items;
    if (!Array.isArray(items)) return null;
    return items.find(item => item.id === discountId) || null;
}

/**
 * Find an exemption item by ID from the adjustment catalogue
 */
function findExemptionItem(schema, exemptionId) {
    const items = schema.exemptions && schema.exemptions.items;
    if (!Array.isArray(items)) return null;
    return items.find(item => item.id === exemptionId) || null;
}

/**
 * Get the executable rules from the rules document
 */
function getExecutableRules() {
    const rulesDoc = getDocument('rules');
    if (!rulesDoc || !rulesDoc.executable_rule_slices) return [];
    return rulesDoc.executable_rule_slices.rules || [];
}

/**
 * Evaluate single person discount
 */
function evaluateSinglePersonDiscount(facts) {
    const reasons = [];
    let likelihood = 'unclear';

    if (facts.adults === 1) {
        likelihood = 'likely';
        reasons.push('Only 1 adult in the household — you are likely entitled to the 25% single person discount');
    } else if (facts.adults === 0) {
        likelihood = 'unclear';
        reasons.push('Zero adults are recorded in this household — if the property has no adult residents, the owner is typically liable and different rules may apply. Please verify the number of adults.');
    } else if (facts.adults > 1) {
        const disregarded = (facts.students || 0) + (facts.carers || 0) + (facts.severely_mentally_impaired || 0) + (facts.apprentice ? 1 : 0);
        const countingAdults = facts.adults - disregarded;

        if (countingAdults === 1) {
            likelihood = 'likely';
            reasons.push(`${disregarded} adult(s) in your household may be disregarded for council tax purposes (students, carers, SMI, apprentices), leaving 1 counting adult`);
        } else if (countingAdults === 0) {
            likelihood = 'unlikely';
            reasons.push('All adults may be disregarded — full exemption routes usually take precedence over single person discount');
        } else {
            likelihood = 'unlikely';
            reasons.push(`${countingAdults} counting adults in the household — the single person discount requires only 1 counting adult`);
        }
    }

    return {
        id: 'single-person-discount',
        ruleId: 'rule.discount.single_person',
        name: 'Single Person Discount',
        amount: '25% off your bill',
        mechanism: 'discount',
        legalBasis: 'Local Government Finance Act 1992, s.11',
        likelihood,
        jsonPath: '/discounts/items/0',
        reasons,
        howToApply: 'Apply online at gloucester.gov.uk or call the Revenues team',
        evidence: 'No formal evidence required but the council may verify your household composition'
    };
}

/**
 * Evaluate student discount/exemption
 */
function evaluateStudentDiscount(facts) {
    if (facts.students === undefined || facts.students === 0) return null;

    const reasons = [];
    let likelihood = 'unclear';
    let name = 'Student Exemption/Discount';
    let amount = 'Up to 100%';
    let mechanism = 'exemption';
    let candidateRole = 'final_outcome';

    if (facts.adults === facts.students) {
        likelihood = 'likely';
        name = 'Student Household Exemption (Class N)';
        amount = '100% exemption';
        reasons.push('All adults in the household are full-time students — you are likely exempt from council tax entirely under Class N');
    } else if (facts.students > 0 && facts.adults === 2 && facts.students === 1) {
        likelihood = 'likely';
        name = 'Student Disregard Logic';
        amount = 'Supports 25% single person discount assessment';
        mechanism = 'disregard';
        candidateRole = 'support_logic';
        reasons.push('One full-time student with one non-student — the student is disregarded for counting-adult logic');
    } else if (facts.students > 0) {
        likelihood = 'unclear';
        reasons.push('Some household members are students — we need to assess the full household to determine whether a discount or exemption applies');
    }

    return {
        id: 'student-discount',
        ruleId: 'rule.exemption.student.all_residents',
        name,
        amount,
        mechanism,
        legalBasis: 'Council Tax (Exempt Dwellings) Order 1992, Class N; LGFA 1992 Sch 1 para 4',
        likelihood,
        jsonPath: '/exemptions',
        reasons,
        candidateRole,
        howToApply: 'Apply online. You will need your student certificate or UCAS confirmation',
        evidence: 'Student certificate from your university or college confirming full-time status'
    };
}

/**
 * Evaluate disabled band reduction
 */
function evaluateDisabledBandReduction(facts) {
    if (!facts.has_disabled_adaptations && !facts.disabled_resident) return null;

    const reasons = [];
    let likelihood = 'unclear';

    if (facts.has_disabled_adaptations && facts.disabled_resident) {
        likelihood = 'likely';
        reasons.push('Your property has qualifying disabled adaptations and a disabled person lives there — you are likely eligible for the disabled band reduction');
    } else if (facts.has_disabled_adaptations) {
        likelihood = 'unclear';
        reasons.push('Your property has adaptations but we need to confirm a disabled person lives there as their main home');
    } else if (facts.disabled_resident) {
        likelihood = 'unclear';
        reasons.push('A disabled person lives at the property — we need to check for qualifying adaptations (extra bathroom or kitchen, wheelchair room, or extra space essential for wellbeing)');
    }

    return {
        id: 'disabled-band-reduction',
        ruleId: 'rule.reduction.disabled_band',
        name: 'Disabled Band Reduction',
        amount: 'Bill reduced to one band lower (Band A gets a 1/9 reduction)',
        mechanism: 'reduction',
        legalBasis: 'Local Government Finance Act 1992, s.13; Council Tax (Reductions for Disabilities) Regulations 1992',
        likelihood,
        jsonPath: '/discounts/items',
        reasons,
        howToApply: 'Apply to Gloucester City Council Revenues team. A visit to confirm adaptations may be required',
        evidence: 'Details of the adaptation (extra bathroom, wheelchair room, etc.) and confirmation the disabled person uses it'
    };
}

/**
 * Evaluate care leaver discount
 */
function evaluateCareLeaverDiscount(facts) {
    if (!facts.care_leaver) return null;

    const reasons = [];
    let likelihood = 'unclear';

    if (facts.care_leaver && facts.age >= 18 && facts.age < 25) {
        likelihood = 'likely';
        reasons.push('You are a care leaver aged 18-24 — Gloucester City Council offers a 100% council tax discount for care leavers of any English local authority up to age 25');
    } else if (facts.care_leaver && facts.age >= 25) {
        likelihood = 'unlikely';
        reasons.push('The care leaver discount ends on your 25th birthday. You may still be eligible for other discounts or council tax support');
    } else if (facts.care_leaver) {
        likelihood = 'unclear';
        reasons.push('Care leaver status confirmed — we need your age to determine eligibility (must be 18-24)');
    }

    return {
        id: 'care-leavers-discount',
        ruleId: 'rule.discount.care_leaver',
        name: 'Care Leavers Discount',
        amount: '100% discount',
        mechanism: 'discount',
        legalBasis: 'LGFA 1992 s.13A(1)(c) — local discretionary scheme. Cabinet approved 10 January 2024, extended to age 24 and to care leavers of any English LA',
        likelihood,
        jsonPath: '/discounts/items',
        reasons,
        howToApply: 'Contact Gloucester City Council Revenues team with evidence of your care history',
        evidence: 'Confirmation of care leaver status from your leaving care team or personal adviser',
        schemeUrl: 'https://www.gloucester.gov.uk/media/psgjmws5/council-tax-discount-scheme-for-care-leavers.pdf'
    };
}

/**
 * Evaluate severely mentally impaired discount
 */
function evaluateSMIDiscount(facts) {
    if (!facts.severely_mentally_impaired || facts.severely_mentally_impaired === 0) return null;

    const reasons = [];
    let likelihood = 'unclear';
    let amount = '25% or 100%';

    if (facts.severely_mentally_impaired >= 1) {
        if (facts.adults === facts.severely_mentally_impaired) {
            likelihood = 'likely';
            amount = '100% discount';
            reasons.push('All adults in the household are certified as severely mentally impaired — you may qualify for a full 100% discount');
        } else if (facts.adults === 2 && facts.severely_mentally_impaired === 1) {
            likelihood = 'likely';
            amount = '25% discount';
            reasons.push('One person with SMI certification and one other adult — the SMI person is disregarded, which may qualify you for the 25% single person discount');
        } else {
            likelihood = 'unclear';
            reasons.push('A person in the household has severe mental impairment — we need to verify the medical certificate and qualifying benefit to determine the discount level');
        }
    }

    return {
        id: 'smi-discount',
        ruleId: 'rule.discount.smi_household',
        name: 'Severely Mentally Impaired Discount',
        amount,
        mechanism: 'discount',
        legalBasis: 'LGFA 1992 Sch 1 para 2; Council Tax (Reductions for Disabilities) Regulations 1992',
        likelihood,
        jsonPath: '/discounts/items',
        reasons,
        howToApply: 'Apply to Gloucester City Council with the required medical evidence',
        evidence: 'Medical certificate from a registered medical practitioner confirming severe mental impairment, plus proof of a qualifying benefit (PIP, DLA, Attendance Allowance, ESA, UC limited capability, or IS with disability premium)'
    };
}

/**
 * Evaluate empty property premium
 */
function evaluateEmptyPropertyPremium(facts) {
    if (!facts.property_empty) return null;

    const reasons = [];
    let likelihood = 'unclear';
    let amount = '';
    const years = facts.property_empty_years || 0;

    if (years >= 10) {
        likelihood = 'likely';
        amount = '300% premium (total 400% of standard charge)';
        reasons.push(`Your property has been empty for ${years} years — a 300% premium applies to properties empty for 10 or more years`);
    } else if (years >= 5) {
        likelihood = 'likely';
        amount = '200% premium (total 300% of standard charge)';
        reasons.push(`Your property has been empty for ${years} years — a 200% premium applies to properties empty for 5 to 9 years`);
    } else if (years >= 2) {
        likelihood = 'likely';
        amount = '100% premium (total 200% of standard charge)';
        reasons.push(`Your property has been empty for ${years} years — a 100% premium applies to properties empty for 2 to 4 years`);
    } else if (years >= 1) {
        likelihood = 'unlikely';
        reasons.push('Your property has been empty for less than 2 years — the premium starts after 2 years of being unoccupied and substantially unfurnished');
        amount = 'No premium yet (starts at 2 years)';
    } else {
        likelihood = 'unclear';
        amount = 'Depends on duration';
        reasons.push('Your property is empty — if it remains empty and substantially unfurnished for 2+ years, a premium will apply. Consider whether the property qualifies for an exemption in the meantime');
    }

    return {
        id: 'empty-property-premium',
        ruleId: 'rule.premium.empty_property_long_term',
        name: 'Long-term Empty Property Premium',
        amount,
        mechanism: 'premium',
        legalBasis: 'LGFA 1992 s.11B as amended by Rating (Property in Common Occupation) and Council Tax (Empty Dwellings) Act 2018 and Levelling-up and Regeneration Act 2023',
        likelihood,
        jsonPath: '/property_premiums/empty_homes_premium',
        reasons
    };
}

/**
 * Evaluate second home premium
 */
function evaluateSecondHomePremium(facts) {
    if (!facts.second_home) return null;

    return {
        id: 'second-home-premium',
        ruleId: 'rule.premium.second_home',
        name: 'Second Homes Premium',
        amount: '100% premium (total 200% of standard charge)',
        mechanism: 'premium',
        legalBasis: 'Levelling-up and Regeneration Act 2023, s.80',
        likelihood: 'likely',
        jsonPath: '/property_premiums/second_homes_premium',
        reasons: ['Your property is a furnished second home — from 1 April 2025, billing authorities may charge a 100% premium on second homes. Check with Gloucester City Council whether this applies in your case']
    };
}

/**
 * Determine which facts are missing for better evaluation
 */
function getMissingFacts(facts) {
    const missing = [];

    if (facts.adults === undefined) {
        missing.push('adults — how many adults (aged 18+) live at the property?');
    }

    if (facts.students === undefined && facts.adults >= 1) {
        missing.push('students — are any adults full-time students? (affects Class N exemption and disregard logic)');
    }

    if (facts.age === undefined && facts.care_leaver) {
        missing.push('age — how old are you? (care leaver discount is for ages 18-24)');
    }

    if (facts.disabled_resident === undefined && facts.has_disabled_adaptations) {
        missing.push('disabled_resident — does a disabled person live at the property?');
    }

    if (facts.has_disabled_adaptations === undefined && facts.disabled_resident) {
        missing.push('has_disabled_adaptations — does the property have qualifying adaptations (extra bathroom, wheelchair room, etc.)?');
    }

    if (facts.property_empty !== undefined && facts.property_empty && facts.property_empty_years === undefined) {
        missing.push('property_empty_years — how long has the property been empty? (affects premium level)');
    }

    return missing;
}

/**
 * Execute the discount_eligibility ruleset
 */
function evaluateDiscountEligibility(facts) {
    const candidates = [];

    // Always evaluate single person discount
    candidates.push(evaluateSinglePersonDiscount(facts));

    // Conditional evaluations based on provided facts
    const studentResult = evaluateStudentDiscount(facts);
    if (studentResult) candidates.push(studentResult);

    const disabledResult = evaluateDisabledBandReduction(facts);
    if (disabledResult) candidates.push(disabledResult);

    const careLeaverResult = evaluateCareLeaverDiscount(facts);
    if (careLeaverResult) candidates.push(careLeaverResult);

    const smiResult = evaluateSMIDiscount(facts);
    if (smiResult) candidates.push(smiResult);

    const emptyPremiumResult = evaluateEmptyPropertyPremium(facts);
    if (emptyPremiumResult) candidates.push(emptyPremiumResult);

    const secondHomeResult = evaluateSecondHomePremium(facts);
    if (secondHomeResult) candidates.push(secondHomeResult);

    // Sort by likelihood (likely first)
    const likelihoodOrder = { 'likely': 0, 'unclear': 1, 'unlikely': 2 };
    candidates.sort((a, b) => likelihoodOrder[a.likelihood] - likelihoodOrder[b.likelihood]);

    return candidates;
}

const LIKELIHOOD_SCORE = { likely: 80, unclear: 20, unlikely: -120 };
const ROLE_SCORE = { final_outcome: 30, fallback: 20, support_logic: 0, rejected: -20 };
const MECHANISM_BASE_SCORE = {
    exemption: 600,
    premium: 500,
    reduction: 400,
    discount_full: 350,
    discount_partial: 300,
    discount: 250,
    disregard: 100,
    unknown: 50
};

function extractPercent(amount) {
    if (typeof amount !== 'string') return 0;
    const matches = [...amount.matchAll(/(\d+)\s*%/g)].map(m => Number(m[1]));
    if (matches.length === 0) return 0;
    return Math.max(...matches);
}

function getSpecificityScore(candidate, facts) {
    const id = candidate.id;
    if (id === 'care-leavers-discount') return facts.age !== undefined ? 40 : 20;
    if (id === 'student-discount' && candidate.name.includes('Household Exemption')) return 45;
    if (id === 'disabled-band-reduction') return 35;
    if (id === 'empty-property-premium') return facts.property_empty_years !== undefined ? 45 : 25;
    if (id === 'smi-discount') return 40;
    if (id === 'single-person-discount') return 10;
    return 15;
}

function getMechanismBucket(candidate) {
    if (candidate.mechanism === 'exemption') return 'exemption';
    if (candidate.mechanism === 'premium') return 'premium';
    if (candidate.mechanism === 'reduction') return 'reduction';
    if (candidate.mechanism === 'disregard') return 'disregard';
    if (candidate.mechanism === 'discount') {
        const percent = extractPercent(candidate.amount);
        if (percent >= 100) return 'discount_full';
        if (percent > 0 && percent < 100) return 'discount_partial';
        return 'discount';
    }
    return 'unknown';
}

function applyApplicabilityRules(candidates, facts, normalisedHousehold) {
    const propertyStateDominates = Boolean(normalisedHousehold.property_empty || normalisedHousehold.second_home);
    const hasLikelyFullRelief = candidates.some(candidate => {
        if (candidate.likelihood !== 'likely') return false;
        const mechanismBucket = getMechanismBucket(candidate);
        return mechanismBucket === 'exemption' || mechanismBucket === 'discount_full';
    });

    return candidates.map(candidate => {
        const next = { ...candidate };
        if (!next.candidateRole) {
            next.candidateRole = next.likelihood === 'unlikely' ? 'rejected' : 'final_outcome';
        }

        if (next.id === 'single-person-discount' && normalisedHousehold.counting_adults === 0) {
            next.candidateRole = 'rejected';
            next.likelihood = 'unlikely';
            next.reasons = [...next.reasons, 'Counting adults is zero, so single person discount is not the primary outcome route'];
        }

        if (hasLikelyFullRelief && next.id === 'single-person-discount' && next.likelihood === 'likely' && next.candidateRole !== 'rejected') {
            next.candidateRole = 'fallback';
            next.reasons = [...next.reasons, 'A likely full-relief route applies, so single person discount is treated as a lower-priority alternative'];
        }

        if (propertyStateDominates && next.mechanism !== 'premium') {
            next.candidateRole = 'rejected';
            next.likelihood = 'unlikely';
            next.reasons = [...next.reasons, 'Property-state premium rules dominate occupancy discounts/reductions for this scenario'];
        }

        return next;
    });
}

function rankCandidates(candidates, facts) {
    return candidates
        .map(candidate => {
            const percent = extractPercent(candidate.amount);
            const mechanismBucket = getMechanismBucket(candidate);
            const score =
                (MECHANISM_BASE_SCORE[mechanismBucket] || MECHANISM_BASE_SCORE.unknown) +
                (LIKELIHOOD_SCORE[candidate.likelihood] || 0) +
                (ROLE_SCORE[candidate.candidateRole] || 0) +
                getSpecificityScore(candidate, facts) +
                percent;
            return { ...candidate, _score: score, _mechanismBucket: mechanismBucket, _impactPercent: percent };
        })
        .sort((a, b) => b._score - a._score);
}

function toNormalisedHousehold(facts) {
    const adults = Number.isFinite(facts.adults) ? facts.adults : 0;
    const students = Number.isFinite(facts.students) ? facts.students : 0;
    const carers = Number.isFinite(facts.carers) ? facts.carers : 0;
    const severelyMentallyImpaired = Number.isFinite(facts.severely_mentally_impaired) ? facts.severely_mentally_impaired : 0;
    const apprentice = facts.apprentice ? 1 : 0;
    const disregardedAdults = students + carers + severelyMentallyImpaired + apprentice;
    const countingAdults = Math.max(0, adults - disregardedAdults);

    return {
        adults,
        disregarded_adults: disregardedAdults,
        counting_adults: countingAdults,
        student_adults: students,
        carer_adults: carers,
        severely_mentally_impaired_adults: severelyMentallyImpaired,
        property_empty: Boolean(facts.property_empty),
        property_empty_years: Number.isFinite(facts.property_empty_years) ? facts.property_empty_years : 0,
        second_home: Boolean(facts.second_home)
    };
}

function buildDerivedFacts(facts, candidates) {
    const likely = candidates.filter(c => c.likelihood === 'likely').map(c => c.id);
    const unclear = candidates.filter(c => c.likelihood === 'unclear').map(c => c.id);

    return {
        likely_candidate_ids: likely,
        unclear_candidate_ids: unclear,
        has_likely_outcome: likely.length > 0,
        requires_manual_review: unclear.length > 0 || getMissingFacts(facts).length > 0
    };
}

function selectBestOutcome(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    return candidates[0];
}

function splitCandidateOptions(candidates) {
    const likely = candidates.filter(c => c.likelihood === 'likely' && c.candidateRole === 'final_outcome');
    const unclear = candidates.filter(c => c.likelihood === 'unclear' || c.candidateRole === 'fallback');
    const unlikely = candidates.filter(c => c.likelihood === 'unlikely' || c.candidateRole === 'rejected');

    return {
        supporting_candidates: likely.slice(1),
        alternative_outcomes: unclear,
        rejected_outcomes: unlikely
    };
}

function buildConfidence(bestOutcome, missingCriticalFacts) {
    const missingWeight = Math.min(0.4, missingCriticalFacts.length * 0.1);
    const base = bestOutcome ? (bestOutcome.likelihood === 'likely' ? 0.85 : bestOutcome.likelihood === 'unclear' ? 0.55 : 0.3) : 0.2;
    const overall = Math.max(0, Number((base - missingWeight).toFixed(2)));

    return {
        overall,
        best_outcome_likelihood: bestOutcome ? bestOutcome.likelihood : 'unclear',
        missing_critical_facts_count: missingCriticalFacts.length
    };
}

function buildReviewReasons(missingCriticalFacts, unresolvedConflicts, candidates) {
    const reasons = [];
    if (missingCriticalFacts.length > 0) {
        reasons.push(`Missing critical facts: ${missingCriticalFacts.length}`);
    }
    if (unresolvedConflicts.length > 0) {
        reasons.push(`Unresolved conflicts: ${unresolvedConflicts.length}`);
    }
    const unclearCandidates = candidates.filter(c => c.likelihood === 'unclear');
    if (unclearCandidates.length > 0) {
        reasons.push('One or more outcomes remain unclear and need review');
    }
    return reasons;
}

function buildBestOutcomeRationale(bestOutcome, rankedCandidates) {
    if (!bestOutcome) return 'No eligible outcome could be resolved from the supplied facts.';
    const runnerUp = rankedCandidates.find(c => c.id !== bestOutcome.id && c.candidateRole !== 'rejected');
    if (!runnerUp) {
        return `${bestOutcome.name} selected because it is the only applicable high-confidence outcome.`;
    }
    return `${bestOutcome.name} outranked ${runnerUp.name} due to precedence (${bestOutcome._mechanismBucket}), specificity and estimated bill impact.`;
}

function loadRuntimeProfiles() {
    const taxonomyDoc = getDocument('taxonomy') || {};
    const factsDoc = getDocument('facts') || {};
    const rulesDoc = getDocument('rules') || {};
    const resultsDoc = getDocument('results') || {};

    return {
        taxonomy_runtime_vocabularies: taxonomyDoc.runtime_vocabularies || {},
        facts_runtime_case_model: factsDoc.runtime_case_model || {},
        rules_runtime_resolver_contract: rulesDoc.runtime_resolver_contract || {},
        results_runtime_contract: resultsDoc.runtime_contract || {},
        results_consumer_contract: resultsDoc.consumer_contract || {},
        results_supporting_context: resultsDoc.supporting_context || {}
    };
}

function projectResult(result, projectionMode) {
    const mode = PROJECTION_MODES.includes(projectionMode) ? projectionMode : 'runtime';
    if (mode === 'trace') {
        return {
            best_outcome: result.best_outcome,
            why_best_outcome_won: result.why_best_outcome_won,
            facts: result.facts,
            missing_critical_facts: result.missing_critical_facts,
            unresolved_conflicts: result.unresolved_conflicts,
            confidence: result.confidence,
            trace: result.trace
        };
    }

    if (mode === 'debug') {
        return result;
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
            ruleset_id: result.trace.ruleset_id
        }
    };
}

function runRuntimeResolver(facts, rulesetId, projectionMode) {
    const runtimeProfiles = loadRuntimeProfiles();
    const normalisedHousehold = toNormalisedHousehold(facts);
    const rawCandidates = evaluateDiscountEligibility(facts);
    const applicableCandidates = applyApplicabilityRules(rawCandidates, facts, normalisedHousehold);
    const rankedCandidates = rankCandidates(applicableCandidates, facts);
    const finalOutcomePool = rankedCandidates.filter(c => c.candidateRole === 'final_outcome');
    const bestOutcome = selectBestOutcome(finalOutcomePool.length > 0 ? finalOutcomePool : rankedCandidates.filter(c => c.candidateRole !== 'rejected'));
    const missingCriticalFacts = getMissingFacts(facts);
    const unresolvedConflicts = [];
    if (rankedCandidates.length > 1 && rankedCandidates[0]._score === rankedCandidates[1]._score) {
        unresolvedConflicts.push({
            type: 'equal_rank',
            candidates: [rankedCandidates[0].id, rankedCandidates[1].id],
            note: 'Two candidates tied in resolver score'
        });
    }
    const reviewReasons = buildReviewReasons(missingCriticalFacts, unresolvedConflicts, rankedCandidates);
    const derivedFacts = {
        ...buildDerivedFacts(facts, rankedCandidates),
        review_reasons: reviewReasons
    };
    if (derivedFacts.requires_manual_review && reviewReasons.length === 0) {
        derivedFacts.review_reasons.push('Manual review triggered by policy guard rails');
    }
    const rulesUsed = rankedCandidates.map(c => c.ruleId).filter(Boolean);
    const noResidentFallback = !bestOutcome ? {
        id: 'no-resident-guidance',
        name: 'No Resident Adults — Owner Liability',
        amount: 'Standard charge applies (owner liable)',
        mechanism: 'guidance',
        likelihood: 'unclear',
        reasons: [
            'No adult residents have been recorded. Where a property has no residents, the owner is usually liable for council tax.',
            'If the property is empty, exemptions or a discount may apply depending on how long it has been unoccupied and the reason.',
            'Please provide the number of adults (18+) living at the property, or confirm the property is empty or unoccupied.'
        ],
        howToApply: 'Contact Gloucester City Council Revenues team to clarify your liability',
        legalBasis: 'Local Government Finance Act 1992, ss.6-9 (liability hierarchy)'
    } : null;

    const bestOutcomeWithoutInternals = bestOutcome ? {
        ...bestOutcome,
        _score: undefined,
        _mechanismBucket: undefined,
        _impactPercent: undefined
    } : noResidentFallback;
    const cleanedCandidates = rankedCandidates.map(c => ({
        ...c,
        _score: undefined,
        _mechanismBucket: undefined,
        _impactPercent: undefined
    }));

    const runtimeResult = {
        best_outcome: bestOutcomeWithoutInternals,
        why_best_outcome_won: buildBestOutcomeRationale(bestOutcome, rankedCandidates),
        options: splitCandidateOptions(cleanedCandidates),
        facts: {
            input_facts: facts,
            derived_facts: derivedFacts,
            normalised_household: normalisedHousehold
        },
        missing_critical_facts: missingCriticalFacts,
        unresolved_conflicts: unresolvedConflicts,
        confidence: buildConfidence(bestOutcome, missingCriticalFacts),
        trace: {
            resolver_version: '2.5.6-runtime',
            projection_mode: projectionMode,
            ruleset_id: rulesetId,
            rules_used: rulesUsed,
            runtime_profiles_loaded: Object.keys(runtimeProfiles),
            note: 'This is guidance based on Gloucester City Council\'s approved 2026/27 council tax policy. Your actual entitlement depends on your individual circumstances and a formal assessment by the council\'s Revenues team.'
        }
    };

    return projectResult(runtimeResult, projectionMode);
}

/**
 * Execute the schema.evaluate tool
 */
function execute(input = {}) {
    const schema = getSchema();

    if (!schema) {
        return createError(
            ERROR_CODES.SCHEMA_LOAD_FAILED,
            'Council tax schema could not be loaded'
        );
    }

    const { rulesetId, userFacts, projectionMode = 'runtime' } = input;

    if (!rulesetId || typeof rulesetId !== 'string') {
        return createError(
            ERROR_CODES.BAD_REQUEST,
            'Missing or invalid "rulesetId" parameter',
            { availableRulesets: RULESETS }
        );
    }

    if (!RULESETS.includes(rulesetId)) {
        return createError(
            ERROR_CODES.BAD_REQUEST,
            `Unknown ruleset "${rulesetId}"`,
            { availableRulesets: RULESETS }
        );
    }

    if (!userFacts || typeof userFacts !== 'object') {
        return createError(
            ERROR_CODES.BAD_REQUEST,
            'Missing or invalid "userFacts" parameter — tell us about your household circumstances'
        );
    }

    if (!PROJECTION_MODES.includes(projectionMode)) {
        return createError(
            ERROR_CODES.BAD_REQUEST,
            `Unknown projectionMode "${projectionMode}"`,
            { availableProjectionModes: PROJECTION_MODES }
        );
    }

    try {
        const result = runRuntimeResolver(userFacts, rulesetId, projectionMode);

        return createSuccess({
            rulesetId,
            userFacts,
            projectionMode,
            ...result
        });
    } catch (err) {
        return createError(
            ERROR_CODES.INTERNAL_ERROR,
            `Evaluation failed: ${err.message}`
        );
    }
}

module.exports = { execute, RULESETS };
