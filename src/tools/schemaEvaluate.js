/**
 * schema.evaluate tool - Evaluate rules against user facts
 * Currently implements: discount_eligibility ruleset
 */

const { ERROR_CODES, createError, createSuccess } = require('../util/errors');
const { getSchema } = require('../schema/loader');

/**
 * Available rulesets
 */
const RULESETS = ['discount_eligibility'];

/**
 * Evaluate single person discount eligibility
 * @param {object} facts - User facts
 * @returns {object} Candidate result
 */
function evaluateSinglePersonDiscount(facts) {
    const reasons = [];
    let likelihood = 'unclear';

    if (facts.adults === 1) {
        likelihood = 'likely';
        reasons.push('Only 1 adult in household qualifies for single person discount');
    } else if (facts.adults === 0) {
        likelihood = 'unclear';
        reasons.push('No adults specified - cannot determine eligibility');
    } else if (facts.adults > 1) {
        // Check for disregarded persons
        const disregarded = (facts.students || 0) + (facts.carers || 0) + (facts.severely_mentally_impaired || 0);
        const countingAdults = facts.adults - disregarded;

        if (countingAdults === 1) {
            likelihood = 'likely';
            reasons.push(`${disregarded} adult(s) may be disregarded, leaving 1 counting adult`);
        } else if (countingAdults === 0) {
            likelihood = 'likely';
            reasons.push('All adults may be disregarded - may qualify for exemption instead');
        } else {
            likelihood = 'unlikely';
            reasons.push(`${countingAdults} counting adults - single person discount requires only 1`);
        }
    }

    return {
        id: 'single-person-discount',
        name: 'Single Person Discount',
        amount: '25%',
        likelihood,
        jsonPath: '/discounts/person_based_discounts/0',
        reasons
    };
}

/**
 * Evaluate student exemption/discount eligibility
 * @param {object} facts - User facts
 * @returns {object|null} Candidate result or null
 */
function evaluateStudentDiscount(facts) {
    if (facts.students === undefined || facts.students === 0) {
        return null;
    }

    const reasons = [];
    let likelihood = 'unclear';

    if (facts.adults === facts.students) {
        likelihood = 'likely';
        reasons.push('All adults are students - may qualify for Class N exemption (100%)');
    } else if (facts.students > 0 && facts.adults === 2 && facts.students === 1) {
        likelihood = 'likely';
        reasons.push('One student with one non-student - student is disregarded, may get 25% discount');
    } else if (facts.students > 0) {
        likelihood = 'unclear';
        reasons.push('Some household members are students - need to assess full household composition');
    }

    return {
        id: 'student-discount',
        name: 'Student Exemption/Discount',
        amount: 'Up to 100%',
        likelihood,
        jsonPath: '/discounts/student_discounts/0',
        reasons
    };
}

/**
 * Evaluate disabled band reduction eligibility
 * @param {object} facts - User facts
 * @returns {object|null} Candidate result or null
 */
function evaluateDisabledBandReduction(facts) {
    if (!facts.has_disabled_adaptations && !facts.disabled_resident) {
        return null;
    }

    const reasons = [];
    let likelihood = 'unclear';

    if (facts.has_disabled_adaptations && facts.disabled_resident) {
        likelihood = 'likely';
        reasons.push('Property has disabled adaptations and disabled resident - likely eligible');
    } else if (facts.has_disabled_adaptations) {
        likelihood = 'unclear';
        reasons.push('Property has adaptations but need to confirm disabled resident lives there');
    } else if (facts.disabled_resident) {
        likelihood = 'unclear';
        reasons.push('Disabled resident present but need qualifying adaptations (bathroom, wheelchair space, etc.)');
    }

    return {
        id: 'disabled-band-reduction',
        name: 'Disabled Band Reduction',
        amount: 'One band lower',
        likelihood,
        jsonPath: '/discounts/property_based_discounts/0',
        reasons
    };
}

/**
 * Evaluate care leaver discount eligibility
 * @param {object} facts - User facts
 * @returns {object|null} Candidate result or null
 */
function evaluateCareLeaverDiscount(facts) {
    if (!facts.care_leaver) {
        return null;
    }

    const reasons = [];
    let likelihood = 'unclear';

    if (facts.care_leaver && facts.age >= 18 && facts.age < 25) {
        likelihood = 'likely';
        reasons.push('Gloucestershire care leaver aged 18-24 - likely eligible for 100% discount');
    } else if (facts.care_leaver && facts.age >= 25) {
        likelihood = 'unlikely';
        reasons.push('Care leaver aged 25+ - discount ends on 25th birthday');
    } else if (facts.care_leaver) {
        likelihood = 'unclear';
        reasons.push('Care leaver status confirmed but need to verify age and GCC care history');
    }

    return {
        id: 'care-leavers-discount',
        name: 'Care Leavers Discount',
        amount: '100%',
        likelihood,
        jsonPath: '/discounts/person_based_discounts/2',
        reasons
    };
}

/**
 * Evaluate severely mentally impaired discount eligibility
 * @param {object} facts - User facts
 * @returns {object|null} Candidate result or null
 */
function evaluateSMIDiscount(facts) {
    if (!facts.severely_mentally_impaired || facts.severely_mentally_impaired === 0) {
        return null;
    }

    const reasons = [];
    let likelihood = 'unclear';

    if (facts.severely_mentally_impaired >= 1) {
        if (facts.adults === facts.severely_mentally_impaired) {
            likelihood = 'likely';
            reasons.push('All adults are SMI - may qualify for 100% discount');
        } else if (facts.adults === 2 && facts.severely_mentally_impaired === 1) {
            likelihood = 'likely';
            reasons.push('One SMI person with one other adult - may qualify for 25% discount');
        } else {
            likelihood = 'unclear';
            reasons.push('SMI person in household - need doctor certificate and qualifying benefit proof');
        }
    }

    return {
        id: 'smi-discount',
        name: 'Severely Mentally Impaired Discount',
        amount: '25% or 100%',
        likelihood,
        jsonPath: '/discounts/person_based_discounts/1',
        reasons
    };
}

/**
 * Determine which facts are missing for better evaluation
 * @param {object} facts - Provided facts
 * @returns {string[]} Array of missing fact names
 */
function getMissingFacts(facts) {
    const missing = [];

    if (facts.adults === undefined) {
        missing.push('adults');
    }

    // Contextual missing facts
    if (facts.students === undefined && facts.adults > 1) {
        missing.push('students (number of full-time students)');
    }

    if (facts.age === undefined && facts.care_leaver) {
        missing.push('age (for care leaver eligibility)');
    }

    if (facts.disabled_resident === undefined && facts.has_disabled_adaptations) {
        missing.push('disabled_resident (true/false)');
    }

    return missing;
}

/**
 * Execute the discount_eligibility ruleset
 * @param {object} facts - User facts
 * @returns {object} Evaluation result
 */
function evaluateDiscountEligibility(facts) {
    const candidates = [];

    // Always evaluate single person discount
    candidates.push(evaluateSinglePersonDiscount(facts));

    // Conditional evaluations
    const studentResult = evaluateStudentDiscount(facts);
    if (studentResult) candidates.push(studentResult);

    const disabledResult = evaluateDisabledBandReduction(facts);
    if (disabledResult) candidates.push(disabledResult);

    const careLeaverResult = evaluateCareLeaverDiscount(facts);
    if (careLeaverResult) candidates.push(careLeaverResult);

    const smiResult = evaluateSMIDiscount(facts);
    if (smiResult) candidates.push(smiResult);

    // Sort by likelihood (likely first)
    const likelihoodOrder = { 'likely': 0, 'unclear': 1, 'unlikely': 2 };
    candidates.sort((a, b) => likelihoodOrder[a.likelihood] - likelihoodOrder[b.likelihood]);

    return {
        candidates,
        missingFacts: getMissingFacts(facts),
        note: 'Advisory only - actual eligibility depends on full assessment and evidence'
    };
}

/**
 * Execute the schema.evaluate tool
 * @param {object} input - Tool input
 * @param {string} input.rulesetId - Ruleset to evaluate (e.g., "discount_eligibility")
 * @param {object} input.userFacts - Facts about the user/household
 * @returns {object} Tool result
 */
function execute(input = {}) {
    const schema = getSchema();

    if (!schema) {
        return createError(
            ERROR_CODES.SCHEMA_LOAD_FAILED,
            'Schema could not be loaded'
        );
    }

    const { rulesetId, userFacts } = input;

    // Validate rulesetId
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

    // Validate userFacts
    if (!userFacts || typeof userFacts !== 'object') {
        return createError(
            ERROR_CODES.BAD_REQUEST,
            'Missing or invalid "userFacts" parameter'
        );
    }

    try {
        let result;

        if (rulesetId === 'discount_eligibility') {
            result = evaluateDiscountEligibility(userFacts);
        }

        return createSuccess({
            rulesetId,
            userFacts,
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
