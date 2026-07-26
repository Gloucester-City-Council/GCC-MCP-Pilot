'use strict';

describe('Azure Estate permission gate (lib/permissions.js)', () => {
    afterEach(() => {
        jest.resetModules();
    });

    it('allows an operation class that is granted to the instance', () => {
        const { assertPermitted } = require('../src/gcc-azure-estate/lib/permissions');
        const instance = assertPermitted('azure-prod', 'resource-groups', 'inspect');
        expect(instance.name).toBe('azure-prod');
    });

    it('throws FORBIDDEN for an operation class that is not granted', () => {
        const { assertPermitted } = require('../src/gcc-azure-estate/lib/permissions');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        expect(() => assertPermitted('azure-prod', 'static-web-apps', 'create'))
            .toThrow(/not permitted/);

        try {
            assertPermitted('azure-prod', 'static-web-apps', 'create');
            throw new Error('expected assertPermitted to throw');
        } catch (err) {
            expect(err.code).toBe(ERROR_CODES.FORBIDDEN);
        }
    });

    it('rejects an unrecognised operation class as BAD_REQUEST', () => {
        const { assertPermitted } = require('../src/gcc-azure-estate/lib/permissions');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        try {
            assertPermitted('azure-prod', 'resource-groups', 'not-a-real-class');
            throw new Error('expected assertPermitted to throw');
        } catch (err) {
            expect(err.code).toBe(ERROR_CODES.BAD_REQUEST);
        }
    });
});
