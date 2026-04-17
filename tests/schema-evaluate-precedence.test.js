'use strict';

const { execute } = require('../src/tools/schemaEvaluate');

describe('schemaEvaluate resolver precedence', () => {
    it('2 full-time students -> Class N exemption must win', () => {
        const result = execute({ rulesetId: 'discount_eligibility', projectionMode: 'runtime', userFacts: { adults: 2, students: 2 } });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('student-discount');
        expect(result.result.best_outcome.name).toContain('Student Household Exemption');
    });

    it('1 adult only -> single person discount must win', () => {
        const result = execute({ rulesetId: 'discount_eligibility', projectionMode: 'runtime', userFacts: { adults: 1 } });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('single-person-discount');
    });

    it('1 care leaver aged 23 living alone -> care leaver discount must win', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 1, care_leaver: true, age: 23 }
        });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('care-leavers-discount');
    });

    it('2 adults + disabled adaptations -> disabled band reduction must win', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 2, has_disabled_adaptations: true, disabled_resident: true }
        });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('disabled-band-reduction');
    });

    it('empty 2 years -> empty property premium must win', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { property_empty: true, property_empty_years: 2, adults: 1 }
        });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('empty-property-premium');
    });

    it('SMI + one non-disregarded adult -> smi discount should beat generic SPD', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 2, severely_mentally_impaired: 1 }
        });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('smi-discount');
    });

    it('manual review consistency provides reasons when required', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 2, students: 1, care_leaver: true }
        });

        expect(result.ok).toBe(true);
        const derived = result.result.facts.derived_facts;
        if (derived.requires_manual_review) {
            expect(Array.isArray(derived.review_reasons)).toBe(true);
            expect(derived.review_reasons.length).toBeGreaterThan(0);
        }
    });
});
