'use strict';

const { run } = require('../src/gcc-planning/pipeline/pipeline-orchestrator');
const { assemble } = require('../src/gcc-planning/pipeline/result-assembler');
const { assessMerits } = require('../src/gcc-planning/pipeline/policy-engine');

describe('planning result schema compatibility', () => {
    it('returns recommendation.reason_summary as an array for assembled results', () => {
        const result = assemble({
            facts: {
                application: { application_reference: 'REF-1', application_route: 'householder_planning_permission' },
                site: { address: '1 Test Street' },
                proposal: {},
            },
            dataQuality: { dataQualityStatus: 'sufficient', dataQualityIssues: [], isLawfulUseRouteBlocked: false },
            scope: { route: 'householder_planning_permission', modulesConsidered: [], modulesApplied: [], modulesSkipped: [] },
            validation: { validationStatus: 'valid', requirements: [], blockingIssues: [] },
            merits: { meritsStatus: 'pass', ruleOutcomes: [], manualReviewFlags: [], isAdvisory: false },
            mode: 'strict',
            processingState: 'full_assessment',
        });

        expect(Array.isArray(result.recommendation.reason_summary)).toBe(true);
        expect(result.recommendation.reason_summary.length).toBeGreaterThan(0);
    });

    it('evaluates extension_type rules when facts use proposal.extension_types (short-form) directly', () => {
        // Regression: buildPredicates only read proposal.proposal_type; facts submitted with
        // proposal.extension_types caused extensionTypes=[] and all in-checks returned not_applicable.
        const facts = {
            application: { application_reference: 'REF-X', application_route: 'householder_planning_permission' },
            site: { address: '1 Test Street', dwelling_type: 'semi_detached' },
            proposal: {
                extension_types: ['two_storey_rear'],  // short-form, no proposal_type
                extension_ridge_height_mm: 7000,
                existing_ridge_height_mm: 6000,
            },
        };
        const scope = {
            route: 'householder_planning_permission',
            modulesConsidered: ['policy_A1_design_and_amenity'],
            modulesApplied: ['policy_A1_design_and_amenity'],
            modulesSkipped: [],
        };
        const dq = { dataQualityStatus: 'sufficient', isLawfulUseRouteBlocked: false };
        const { ruleOutcomes } = assessMerits(facts, scope, dq, 'strict');
        const ridgeRule = ruleOutcomes.find(r => r.rule_id === 'A1.1.2');
        // Rule A1.1.2 applies to two_storey_rear; it should not be not_applicable
        expect(ridgeRule).toBeDefined();
        expect(ridgeRule.status).not.toBe('not_applicable');
    });

    it('returns recommendation.reason_summary as an array for schema-invalid pipeline output', () => {
        const { result, processingState } = run({}, 'strict');

        expect(processingState).toBe('schema_invalid');
        expect(Array.isArray(result.recommendation.reason_summary)).toBe(true);
        expect(result.recommendation.reason_summary[0]).toContain('Required top-level sections missing');
    });
});
