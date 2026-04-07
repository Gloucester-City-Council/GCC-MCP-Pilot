'use strict';

const { execute } = require('../src/gcc-procurement/tools/get-notices');

describe('gcc-procurement get-notices input validation and route handling', () => {
    test('rejects unknown procurement_route values', () => {
        const res = execute({
            value_gbp: 1000000,
            contract_type: 'services',
            procurement_route: 'direct-awrad',
            response_format: 'json',
        });

        expect(res.ok).toBe(false);
        expect(res.error.code).toBe('BAD_REQUEST');
        expect(res.error.message).toContain('procurement_route must be one of');
    });

    test('normalises mixed-case procurement_route input', () => {
        const res = execute({
            value_gbp: 1000000,
            contract_type: 'services',
            procurement_route: '  Direct_Award  ',
            response_format: 'json',
        });

        expect(res.ok).toBe(true);
        expect(res.result.procurement_route).toBe('direct_award');
    });
});
