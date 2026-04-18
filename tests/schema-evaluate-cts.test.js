'use strict';

const { execute } = require('../src/tools/schemaEvaluate');

describe('schemaEvaluate — Council Tax Support (CTS)', () => {
    it('Pension Credit claimant → CTS council_tax_support_options contains a likely 100% outcome', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 1, receiving_pension_credit: true, savings: 5000 },
        });
        expect(result.ok).toBe(true);
        const ctsOptions = result.result.options.council_tax_support_options;
        expect(Array.isArray(ctsOptions)).toBe(true);
        const best = ctsOptions.find(c => c.likelihood === 'likely');
        expect(best).toBeDefined();
        expect(best.amount).toMatch(/100%/);
    });

    it('Benefits claimant with savings under £16,000 → CTS has likely 100% outcome', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 2, on_qualifying_benefit: true, savings: 8000 },
        });
        expect(result.ok).toBe(true);
        const ctsOptions = result.result.options.council_tax_support_options;
        const likelyCts = ctsOptions.filter(c => c.likelihood === 'likely');
        expect(likelyCts.length).toBeGreaterThan(0);
        expect(likelyCts[0].amount).toMatch(/100%/);
    });

    it('Low income (savings £5k, no specific benefit) → CTS has likely means-tested entry', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 2, savings: 5000 },
        });
        expect(result.ok).toBe(true);
        const ctsOptions = result.result.options.council_tax_support_options;
        const likelyCts = ctsOptions.find(c => c.likelihood === 'likely');
        expect(likelyCts).toBeDefined();
        expect(likelyCts.amount).toMatch(/income and savings assessment/i);
    });

    it('Savings ≥ £16,000 without Pension Credit → no likely CTS options', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 2, savings: 20000, receiving_pension_credit: false },
        });
        expect(result.ok).toBe(true);
        const ctsOptions = result.result.options.council_tax_support_options;
        const likelyCts = ctsOptions.filter(c => c.likelihood === 'likely');
        expect(likelyCts.length).toBe(0);
    });

    it('Savings ≥ £16,000 but on Pension Credit → CTS pension credit rule still fires as likely', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 1, savings: 25000, receiving_pension_credit: true },
        });
        expect(result.ok).toBe(true);
        const ctsOptions = result.result.options.council_tax_support_options;
        const likelyCts = ctsOptions.filter(c => c.likelihood === 'likely');
        expect(likelyCts.length).toBeGreaterThan(0);
        expect(likelyCts[0].amount).toMatch(/100%/);
    });

    it('CTS never displaces statutory discount as best_outcome', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 1, savings: 3000 },
        });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('single-person-discount');
        expect(result.result.best_outcome.mechanism).not.toBe('council_tax_support');
    });

    it('CTS never displaces Class N exemption as best_outcome', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 2, students: 2, savings: 2000, on_qualifying_benefit: true },
        });
        expect(result.ok).toBe(true);
        expect(result.result.best_outcome.id).toBe('class-n');
        expect(result.result.best_outcome.mechanism).not.toBe('council_tax_support');
    });

    it('savings missing for an occupied household → flagged in missing_critical_facts', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 2 },
        });
        expect(result.ok).toBe(true);
        const missing = result.result.missing_critical_facts;
        expect(missing.some(f => f.includes('savings'))).toBe(true);
    });

    it('savings not asked for empty property scenario', () => {
        const result = execute({
            rulesetId: 'discount_eligibility',
            projectionMode: 'runtime',
            userFacts: { adults: 1, property_empty: true, property_empty_years: 2 },
        });
        expect(result.ok).toBe(true);
        const missing = result.result.missing_critical_facts;
        expect(missing.some(f => f.includes('savings'))).toBe(false);
    });
});
