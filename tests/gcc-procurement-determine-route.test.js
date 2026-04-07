'use strict';

const { execute } = require('../src/gcc-procurement/tools/determine-route');

function requiredNoticeCodes(procurementRoute) {
    const res = execute({
        value_gbp: 1000000,
        contract_type: 'services',
        procurement_route: procurementRoute,
        response_format: 'json',
    });

    expect(res.ok).toBe(true);
    return res.result.required_notices.map(n => n.code);
}

describe('gcc-procurement determine-route notice derivation', () => {
    test('treats transparency route as a direct-award style route', () => {
        const directCodes = requiredNoticeCodes('direct_award');
        const transparencyCodes = requiredNoticeCodes('transparency');

        expect(transparencyCodes).toEqual(directCodes);
    });

    test('keeps competitive route notice set distinct from direct-award style routes', () => {
        const competitiveCodes = requiredNoticeCodes('competitive');
        const transparencyCodes = requiredNoticeCodes('transparency');

        expect(competitiveCodes).not.toEqual(transparencyCodes);
    });
});
