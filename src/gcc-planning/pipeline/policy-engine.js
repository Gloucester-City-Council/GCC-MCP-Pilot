/**
 * PolicyEngine
 *
 * Runs the assessment_tests rules from the policy ruleset against canonical facts.
 * Implements the predicate evaluation logic for applicability conditions and
 * measurement/qualitative/boolean evaluations.
 *
 * Per plan Section 3.2: merits are advisory only in data_compromised state.
 * Per plan Section 3.6: material-rule register — if a material rule returns
 * cannot_assess, planning_merits.status is forced to cannot_assess.
 *
 * Returns:
 *   { meritsStatus, ruleOutcomes, manualReviewFlags, isAdvisory }
 */

'use strict';

const { ASSESSMENT_TESTS, MATERIAL_RULES_REGISTER, isMaterialRule } = require('../schema-loader');

/**
 * Assess planning merits.
 *
 * @param {object} facts        Canonical facts
 * @param {object} scope        Output of scope-engine
 * @param {object} dataQuality  { dataQualityStatus, isLawfulUseRouteBlocked }
 * @param {string} mode         strict|advisory|pre_application
 * @returns {{
 *   meritsStatus: string,
 *   ruleOutcomes: Array<object>,
 *   manualReviewFlags: Array<string>,
 *   isAdvisory: boolean
 * }}
 */
function assessMerits(facts, scope, dataQuality, mode) {
    // Advisory-only if data is compromised (plan Section 3.2)
    const isAdvisory = dataQuality.dataQualityStatus === 'conflicted' ||
                       dataQuality.dataQualityStatus === 'insufficient';

    // Only run Policy A1 for routes where it applies
    const runPolicyA1 = scope.modulesApplied.includes('policy_A1_design_and_amenity');

    if (!runPolicyA1) {
        return {
            meritsStatus: 'not_run',
            ruleOutcomes: [],
            manualReviewFlags: [],
            isAdvisory,
        };
    }

    const predicates = buildPredicates(facts);
    const ruleOutcomes = [];
    const manualReviewFlags = [];

    for (const test of ASSESSMENT_TESTS) {
        for (const rule of (test.rules || [])) {
            // Check if rule applies to this route
            if (!ruleAppliestoRoute(rule, scope.route)) {
                ruleOutcomes.push({
                    rule_id: rule.rule_id,
                    rule_name: rule.rule_name,
                    test_id: test.test_id,
                    test_name: test.test_name,
                    status: 'not_applicable',
                    reason: `Rule does not apply to route: ${scope.route}`,
                    severity: rule.severity,
                    legal_basis: rule.legal_basis,
                    effect_type: rule.effect_type,
                    threshold_status: rule.threshold_status,
                    policy_source_status: rule.policy_source_status,
                    advisory_only: false,
                });
                continue;
            }

            // Check applicability conditions
            const applicability = evaluateApplicability(rule.applicability, predicates);
            if (!applicability.applies) {
                ruleOutcomes.push({
                    rule_id: rule.rule_id,
                    rule_name: rule.rule_name,
                    test_id: test.test_id,
                    test_name: test.test_name,
                    status: 'not_applicable',
                    reason: applicability.reason || 'Applicability conditions not met.',
                    severity: rule.severity,
                    legal_basis: rule.legal_basis,
                    effect_type: rule.effect_type,
                    threshold_status: rule.threshold_status,
                    policy_source_status: rule.policy_source_status,
                    advisory_only: false,
                });
                continue;
            }

            // Evaluate the rule
            const outcome = evaluateRule(rule, predicates, isAdvisory);

            if (outcome.status === 'manual_review_required') {
                manualReviewFlags.push(`${rule.rule_id}: ${rule.rule_name} — manual officer review required.`);
            }

            ruleOutcomes.push({
                rule_id: rule.rule_id,
                rule_name: rule.rule_name,
                test_id: test.test_id,
                test_name: test.test_name,
                status: outcome.status,
                reason: outcome.reason,
                facts_missing: outcome.factsMissing || [],
                severity: rule.severity,
                legal_basis: rule.legal_basis,
                effect_type: rule.effect_type,
                threshold_status: rule.threshold_status,
                policy_source_status: rule.policy_source_status,
                officer_judgement_required: outcome.officerJudgementRequired || false,
                advisory_only: isAdvisory,
                ...(isAdvisory ? { advisory_caveat: 'Assessment is advisory only due to data quality issues.' } : {}),
            });
        }
    }

    // ── Determine overall merits status ───────────────────────────────────────
    const meritsStatus = computeMeritsStatus(ruleOutcomes);

    return {
        meritsStatus,
        ruleOutcomes,
        manualReviewFlags,
        isAdvisory,
    };
}

/**
 * Compute planning_merits.status from rule outcomes.
 * Applies material-rule register override (plan Section 3.6).
 */
function computeMeritsStatus(ruleOutcomes) {
    const substantive = ruleOutcomes.filter(r =>
        r.status !== 'not_applicable' && r.status !== 'not_run'
    );

    if (substantive.length === 0) return 'not_run';

    // Material-rule override: if any material rule returns cannot_assess → cannot_assess overall
    const materialCannotAssess = substantive.some(r =>
        r.status === 'cannot_assess' && isMaterialRule(r.rule_id)
    );
    if (materialCannotAssess) return 'cannot_assess';

    const hasFail = substantive.some(r => r.status === 'fail');
    if (hasFail) return 'fail';

    const hasCannotAssess = substantive.some(r => r.status === 'cannot_assess');
    if (hasCannotAssess) return 'cannot_assess';

    const hasConcern = substantive.some(r => r.status === 'concern');
    if (hasConcern) return 'concerns';

    const hasManualReview = substantive.some(r => r.status === 'manual_review_required');
    if (hasManualReview) return 'manual_review_required';

    return 'pass';
}

/**
 * Build a flat predicates map from canonical facts for rule evaluation.
 * Field names map to the predicate_mapping in the facts schema.
 */
function buildPredicates(facts) {
    const app      = facts.application || {};
    const site     = facts.site        || {};
    const proposal = facts.proposal    || {};
    const proposalTypes = Array.isArray(proposal.proposal_type) ? proposal.proposal_type : [];

    // Map proposal_type array to ruleset extension_type predicates
    const extensionTypes = proposalTypes.map(pt => mapProposalTypeToExtensionType(pt));

    return {
        // Site
        dwelling_type: site.dwelling_type,
        conservation_area: site.conservation_area,
        listed_building: site.listed_building,
        or_listed_building_within_setting: site.listed_building_within_setting,
        flood_zone: site.flood_zone,
        within_8m_of_watercourse: site.within_8m_of_watercourse,
        street_character: site.street_character,
        plot_width: site.plot_width_mm,
        within_aqma: site.within_aqma,
        classified_road: site.classified_road,
        // Proposal
        extension_type: extensionTypes,         // array, but some rules test single type membership
        proposal_type: proposalTypes,
        setback_from_front_building_line: proposal.setback_from_front_building_line_mm,
        extension_ridge_height: proposal.extension_ridge_height_mm,
        existing_ridge_height: proposal.existing_ridge_height_mm,
        extension_eaves_height: proposal.extension_eaves_height_mm,
        existing_eaves_height: proposal.existing_eaves_height_mm,
        extension_width_as_percentage_of_existing: proposal.extension_width_percent_of_existing,
        extension_depth_from_existing_rear_wall: proposal.extension_depth_from_existing_rear_wall_mm,
        extension_depth_from_existing_front: proposal.extension_depth_from_existing_front_mm,
        remaining_rear_garden_depth: proposal.remaining_rear_garden_depth_m != null
            ? proposal.remaining_rear_garden_depth_m * 1000  // convert m → mm for consistency
            : undefined,
        distance_to_boundary: proposal.distance_to_boundary_mm,
        close_to_boundary: proposal.close_to_boundary,
        has_habitable_room_windows: proposal.has_habitable_room_windows,
        windows_facing_boundary: proposal.windows_facing_boundary,
        rear_facing_windows_or_openings: proposal.rear_facing_windows_or_openings,
        side_window_to_boundary_distance: proposal.side_window_to_boundary_distance_mm,
        distance_to_facing_habitable_window: proposal.distance_to_facing_habitable_window_m != null
            ? proposal.distance_to_facing_habitable_window_m * 1000
            : undefined,
        overlooking_distance_to_garden: proposal.overlooking_distance_to_garden_m != null
            ? proposal.overlooking_distance_to_garden_m * 1000
            : undefined,
        parking_affected: proposal.parking_affected,
        parking_spaces_retained: proposal.parking_spaces_retained,
        materials_match: proposal.materials_match_existing,
        design_reflects_context: proposal.design_reflects_context,
        accessible_design_considered: proposal.accessible_design_considered,
    };
}

function mapProposalTypeToExtensionType(pt) {
    const map = {
        single_storey_rear_extension: 'single_storey_rear',
        two_storey_rear_extension:    'two_storey_rear',
        single_storey_side_extension: 'single_storey_side',
        two_storey_side_extension:    'two_storey_side',
        front_extension:              'front_extension',
        front_porch:                  'front_porch',
        roof_extension:               'roof_extension',
        dormer:                       'dormer',
        conservatory:                 'conservatory',
        wraparound_extension:         'wraparound',
        annexe:                       'annexe',
        outbuilding:                  'outbuilding',
        garage:                       'garage',
        loft_conversion:              'loft_conversion',
        balcony_or_roof_terrace:      'balcony',
    };
    return map[pt] || pt;
}

/**
 * Evaluate applicability conditions (all/any/expression_text).
 */
function evaluateApplicability(applicability, predicates) {
    if (!applicability) return { applies: true };

    const allConds = applicability.all || [];
    for (const cond of allConds) {
        if (!evaluateCondition(cond, predicates)) {
            return { applies: false, reason: `Condition not met: ${JSON.stringify(cond)}` };
        }
    }

    const anyConds = applicability.any || [];
    if (anyConds.length > 0) {
        const anyMet = anyConds.some(c => evaluateCondition(c, predicates));
        if (!anyMet) {
            return { applies: false, reason: 'None of the "any" conditions were met.' };
        }
    }

    return { applies: true };
}

/**
 * Evaluate a single applicability condition.
 */
function evaluateCondition(cond, predicates) {
    const fieldVal = getPredicateValue(cond.field, predicates);

    // Cannot evaluate if field not present
    if (fieldVal === undefined || fieldVal === null) return false;

    switch (cond.op) {
        case 'eq':
        case '==':
        case '=':   // ruleset uses single = throughout (13 conditions)
            return fieldVal === cond.value;
        case 'ne':
        case '!=':
            return fieldVal !== cond.value;
        case 'in':
            if (Array.isArray(fieldVal)) {
                return fieldVal.some(v => cond.value.includes(v));
            }
            return Array.isArray(cond.value) && cond.value.includes(fieldVal);
        case 'not_in':
            if (Array.isArray(fieldVal)) {
                return !fieldVal.some(v => cond.value.includes(v));
            }
            return Array.isArray(cond.value) && !cond.value.includes(fieldVal);
        case 'truthy':
        case 'is_true':
            return fieldVal === true;
        case 'falsy':
        case 'is_false':
            return fieldVal === false;
        case 'gte':
        case '>=':
            return typeof fieldVal === 'number' && fieldVal >= cond.value;
        case 'lte':
        case '<=':
            return typeof fieldVal === 'number' && fieldVal <= cond.value;
        case 'gt':
        case '>':
            return typeof fieldVal === 'number' && fieldVal > cond.value;
        case 'lt':
        case '<':
            return typeof fieldVal === 'number' && fieldVal < cond.value;
        default:
            return false;
    }
}

/**
 * Get a predicate value by field name (supports dot notation and aliasing).
 */
function getPredicateValue(field, predicates) {
    if (Object.prototype.hasOwnProperty.call(predicates, field)) {
        return predicates[field];
    }
    // Try array membership check (e.g. extension_type "in" a list)
    return undefined;
}

/**
 * Evaluate a rule against predicates.
 */
function evaluateRule(rule, predicates, isAdvisory) {
    const evaluation = rule.evaluation;

    if (!evaluation) {
        // No automated evaluation defined — qualitative manual review
        return {
            status: 'manual_review_required',
            reason: 'This rule requires qualitative officer judgement; automated evaluation is not possible.',
            officerJudgementRequired: true,
        };
    }

    switch (evaluation.kind) {
        case 'measurement':
            return evaluateMeasurement(rule, evaluation, predicates);
        case 'boolean':
        case 'presence':
            return evaluateBoolean(rule, evaluation, predicates);
        case 'qualitative':
        case 'manual':
            return {
                status: 'manual_review_required',
                reason: rule.assessment_guidance || 'Qualitative assessment required.',
                officerJudgementRequired: true,
            };
        default:
            return {
                status: 'cannot_assess',
                reason: `Evaluation kind "${evaluation.kind}" not recognised.`,
            };
    }
}

function evaluateMeasurement(rule, evaluation, predicates) {
    const metric = evaluation.metric;
    if (!metric) return { status: 'cannot_assess', reason: 'No metric defined.' };

    const fieldVal = getPredicateValue(metric.parameter, predicates);
    if (fieldVal === undefined || fieldVal === null) {
        return {
            status: 'cannot_assess',
            reason: `Required measurement "${metric.parameter}" is not provided.`,
            factsMissing: [metric.parameter],
        };
    }

    let passes;
    switch (metric.operator) {
        case '>=': passes = fieldVal >= metric.threshold; break;
        case '<=': passes = fieldVal <= metric.threshold; break;
        case '>':  passes = fieldVal >  metric.threshold; break;
        case '<':  passes = fieldVal <  metric.threshold; break;
        case '==': passes = fieldVal === metric.threshold; break;
        default:   passes = null;
    }

    if (passes === null) {
        return { status: 'cannot_assess', reason: `Unknown operator: ${metric.operator}` };
    }

    const severityToStatus = mapSeverityToOutcome(rule.severity, passes);
    const unit = metric.unit || '';
    const thresholdDesc = `${metric.threshold}${unit}`;

    return {
        status: severityToStatus,
        reason: passes
            ? `${metric.parameter} (${fieldVal}${unit}) meets threshold (${metric.operator} ${thresholdDesc}).`
            : `${metric.parameter} (${fieldVal}${unit}) does not meet threshold (${metric.operator} ${thresholdDesc}). ${rule.policy_rationale || ''}`,
    };
}

function evaluateBoolean(rule, evaluation, predicates) {
    const field = evaluation.field || (evaluation.metric && evaluation.metric.parameter);
    if (!field) return { status: 'cannot_assess', reason: 'No field defined for boolean evaluation.' };

    const fieldVal = getPredicateValue(field, predicates);
    if (fieldVal === undefined || fieldVal === null) {
        return {
            status: 'cannot_assess',
            reason: `Required fact "${field}" is not provided.`,
            factsMissing: [field],
        };
    }

    const expectedTrue = evaluation.expected !== false;
    const passes = expectedTrue ? (fieldVal === true) : (fieldVal === false);
    const severityToStatus = mapSeverityToOutcome(rule.severity, passes);

    return {
        status: severityToStatus,
        reason: passes
            ? `${field} meets requirement.`
            : `${field} does not meet requirement. ${rule.policy_rationale || ''}`,
    };
}

/**
 * Map rule severity + pass/fail → rule_status enum.
 *
 * Severity:  must / must_not / should / should_not / may / informative_only
 * Outcome:
 *   must pass     → pass / fail
 *   should pass   → pass / concern
 *   may           → pass / manual_review_required
 */
function mapSeverityToOutcome(severity, passes) {
    if (passes) return 'pass';

    switch (severity) {
        case 'must':
        case 'must_not':
            return 'fail';
        case 'should':
        case 'should_not':
            return 'concern';
        case 'may':
            return 'manual_review_required';
        case 'informative_only':
            return 'pass'; // informative rules never fail
        default:
            return 'concern';
    }
}

function ruleAppliestoRoute(rule, route) {
    const routeScope = rule.route_scope;
    if (!routeScope) return true;

    if (routeScope.applies_to_routes && Array.isArray(routeScope.applies_to_routes)) {
        if (!routeScope.applies_to_routes.includes(route)) return false;
    }
    if (routeScope.does_not_apply_to_routes && Array.isArray(routeScope.does_not_apply_to_routes)) {
        if (routeScope.does_not_apply_to_routes.includes(route)) return false;
    }
    return true;
}

module.exports = { assessMerits, computeMeritsStatus };
