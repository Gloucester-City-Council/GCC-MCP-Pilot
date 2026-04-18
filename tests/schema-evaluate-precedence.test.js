'use strict';

const { execute } = require('../src/tools/schemaEvaluate');

describe('schemaEvaluate resolver precedence', () => {
    it('2 full-time students -> Class N exemption must win', () => {
        const result = execute({ rulesetId: 'discount_eligibility', projectionMode: 'runtime', userFacts: { adults: 2, students: 2 } });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('class-n');
        expect(result.result.best_outcome.name).toMatch(/student/i);
    });

    it('1 adult who is a full-time student -> Class N exemption must win over single person discount', () => {
        const result = execute({ rulesetId: 'discount_eligibility', projectionMode: 'runtime', userFacts: { adults: 1, students: 1 } });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('class-n');
        expect(result.result.best_outcome.name).toMatch(/student/i);
    });

    it('1 adult only -> single person discount must win', () => {
        const result = execute({ rulesetId: 'discount_eligibility', projectionMode: 'runtime', userFacts: { adults: 1 } });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('single-person-discount');
    });

    it('1 adult with no student info -> students flagged as missing critical fact', () => {
        const result = execute({ rulesetId: 'discount_eligibility', projectionMode: 'runtime', userFacts: { adults: 1 } });
        expect(result.ok).toBe(true);
        const missing = result.result.missing_critical_facts;
        expect(missing.some(f => f.includes('students'))).toBe(true);
    });

    it('1 care leaver aged 23 living alone -> care leaver discount must win', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 1, care_leaver: true, age: 23 }
        });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('care-leavers');
    });

    it('care leaver full discount keeps SPD as alternative or support, not primary outcome', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 1, care_leaver: true, age: 23 }
        });
        expect(result.ok).toBe(true);
        const best = result.result.best_outcome;
        expect(best.id).toBe('care-leavers');

        // SPD should not be the best outcome
        const options = result.result.options;
        const allOtherIds = [
            ...options.supporting_candidates.map(c => c.id),
            ...options.alternative_outcomes.map(c => c.id),
        ];
        expect(allOtherIds).not.toContain('care-leavers');
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

    it('empty 2 years -> long-term empty premium must win', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { property_empty: true, property_empty_years: 2, adults: 1 }
        });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('long-term-empty');
    });

    it('SMI + one non-disregarded adult -> SMI discount should beat generic SPD', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 2, severely_mentally_impaired: 1 }
        });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('severely-mentally-impaired');
    });

    it('adults=0 -> returns no-resident guidance rather than null best_outcome', () => {
        const result = execute({ rulesetId: 'discount_eligibility', projectionMode: 'runtime', userFacts: { adults: 0 } });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome).not.toBeNull();
        expect(result.result.best_outcome.id).toBe('no-resident-guidance');
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
