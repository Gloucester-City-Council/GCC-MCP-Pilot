'use strict';

const { run } = require('../src/gcc-planning/pipeline/pipeline-orchestrator');
const { assemble } = require('../src/gcc-planning/pipeline/result-assembler');

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

    it('returns recommendation.reason_summary as an array for schema-invalid pipeline output', () => {
        const { result, processingState } = run({}, 'strict');

        expect(processingState).toBe('schema_invalid');
        expect(Array.isArray(result.recommendation.reason_summary)).toBe(true);
        expect(result.recommendation.reason_summary[0]).toContain('Required top-level sections missing');
    });
});
