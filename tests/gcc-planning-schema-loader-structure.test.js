'use strict';

const path = require('path');

function buildFsMock({ ruleset }) {
    const enums = {
        $id: 'enums',
        properties: {
            decision_mode: { enum: ['delegated', 'committee'] },
        },
    };

    const facts = { $id: 'facts' };
    const result = { $id: 'result' };

    return {
        readFileSync: jest.fn((filepath) => {
            const file = path.basename(filepath);
            if (file.includes('enums')) return JSON.stringify(enums);
            if (file.includes('application-facts')) return JSON.stringify(facts);
            if (file.includes('assessment-result')) return JSON.stringify(result);
            if (file.includes('policy-ruleset')) return JSON.stringify(ruleset);
            throw new Error(`Unexpected file requested in test: ${file}`);
        }),
    };
}

describe('gcc-planning schema-loader ruleset validation', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('throws a descriptive error when assessment_tests is missing', () => {
        const invalidRuleset = {
            model_version: 'v-test',
            validation_modules: {},
        };

        jest.doMock('fs', () => buildFsMock({ ruleset: invalidRuleset }));

        expect(() => {
            jest.isolateModules(() => {
                require('../src/gcc-planning/schema-loader');
            });
        }).toThrow('assessment_tests must be an array');
    });

    test('loads when ruleset has required core structures', () => {
        const validRuleset = {
            model_version: 'v-test',
            validation_modules: {
                admin: {
                    requirement_a: {
                        requirement_id: 'A1',
                        item_number: 1,
                    },
                },
            },
            assessment_tests: [
                {
                    test_id: 'T1',
                    test_name: 'test',
                    rules: [{ rule_id: 'A1.2.1' }],
                },
            ],
            consultation_matrix: {},
            cil_assessment: {},
            applicability_framework: {},
        };

        jest.doMock('fs', () => buildFsMock({ ruleset: validRuleset }));

        let loader;
        jest.isolateModules(() => {
            loader = require('../src/gcc-planning/schema-loader');
        });

        expect(loader.ASSESSMENT_TESTS).toHaveLength(1);
        expect(loader.findRule('A1.2.1')).not.toBeNull();
    });
});
