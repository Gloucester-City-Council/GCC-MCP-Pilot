'use strict';

describe('Azure Estate credential selection (lib/credential.js)', () => {
    const ORIGINAL_ENV = process.env.WEBSITE_INSTANCE_ID;

    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        if (ORIGINAL_ENV === undefined) delete process.env.WEBSITE_INSTANCE_ID;
        else process.env.WEBSITE_INSTANCE_ID = ORIGINAL_ENV;
    });

    it('uses ManagedIdentityCredential directly when running in Azure (WEBSITE_INSTANCE_ID set)', () => {
        delete process.env.WEBSITE_INSTANCE_ID;
        process.env.WEBSITE_INSTANCE_ID = 'some-instance-id';

        const ManagedIdentityCredential = jest.fn();
        const DefaultAzureCredential = jest.fn();
        jest.doMock('@azure/identity', () => ({ ManagedIdentityCredential, DefaultAzureCredential }));

        const { getCredential } = require('../src/gcc-azure-estate/lib/credential');
        getCredential();

        expect(ManagedIdentityCredential).toHaveBeenCalledTimes(1);
        expect(DefaultAzureCredential).not.toHaveBeenCalled();
    });

    it('falls back to DefaultAzureCredential locally (no WEBSITE_INSTANCE_ID)', () => {
        delete process.env.WEBSITE_INSTANCE_ID;

        const ManagedIdentityCredential = jest.fn();
        const DefaultAzureCredential = jest.fn();
        jest.doMock('@azure/identity', () => ({ ManagedIdentityCredential, DefaultAzureCredential }));

        const { getCredential } = require('../src/gcc-azure-estate/lib/credential');
        getCredential();

        expect(DefaultAzureCredential).toHaveBeenCalledTimes(1);
        expect(ManagedIdentityCredential).not.toHaveBeenCalled();
    });

    it('caches the credential instance across calls', () => {
        delete process.env.WEBSITE_INSTANCE_ID;

        const DefaultAzureCredential = jest.fn();
        jest.doMock('@azure/identity', () => ({ DefaultAzureCredential, ManagedIdentityCredential: jest.fn() }));

        const { getCredential } = require('../src/gcc-azure-estate/lib/credential');
        const a = getCredential();
        const b = getCredential();

        expect(a).toBe(b);
        expect(DefaultAzureCredential).toHaveBeenCalledTimes(1);
    });
});
