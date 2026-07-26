'use strict';

describe('Azure Estate instance registry (config/azure-instances.yaml)', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('loads and exposes the azure-prod instance with required fields', () => {
        const { listInstances, getInstance } = require('../src/gcc-azure-estate/lib/instances');

        const instances = listInstances();
        expect(Array.isArray(instances)).toBe(true);
        expect(instances.length).toBeGreaterThan(0);

        const prod = getInstance('azure-prod');
        expect(prod.environment).toBe('production');
        expect(typeof prod.subscriptionId).toBe('string');
        expect(prod.permissions).toBeTruthy();
        expect(Array.isArray(prod.permissions['resource-groups'])).toBe(true);
    });

    it('throws a clear error for an unknown instance name', () => {
        const { getInstance } = require('../src/gcc-azure-estate/lib/instances');
        expect(() => getInstance('does-not-exist')).toThrow(/Unknown instance/);
    });
});
