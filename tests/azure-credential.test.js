'use strict';

describe('Azure Estate credential selection (lib/credential.js)', () => {
    const ORIGINAL_ENV = process.env.WEBSITE_INSTANCE_ID;
    const ORIGINAL_CLIENT_ID = process.env.AZURE_CLIENT_ID;

    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        if (ORIGINAL_ENV === undefined) delete process.env.WEBSITE_INSTANCE_ID;
        else process.env.WEBSITE_INSTANCE_ID = ORIGINAL_ENV;
        if (ORIGINAL_CLIENT_ID === undefined) delete process.env.AZURE_CLIENT_ID;
        else process.env.AZURE_CLIENT_ID = ORIGINAL_CLIENT_ID;
    });

    it('uses ManagedIdentityCredential directly (system-assigned) when running in Azure with no AZURE_CLIENT_ID', () => {
        delete process.env.WEBSITE_INSTANCE_ID;
        delete process.env.AZURE_CLIENT_ID;
        process.env.WEBSITE_INSTANCE_ID = 'some-instance-id';

        const ManagedIdentityCredential = jest.fn();
        const DefaultAzureCredential = jest.fn();
        jest.doMock('@azure/identity', () => ({ ManagedIdentityCredential, DefaultAzureCredential }));

        const { getCredential } = require('../src/gcc-azure-estate/lib/credential');
        getCredential();

        expect(ManagedIdentityCredential).toHaveBeenCalledTimes(1);
        expect(ManagedIdentityCredential).toHaveBeenCalledWith();
        expect(DefaultAzureCredential).not.toHaveBeenCalled();
    });

    it('passes AZURE_CLIENT_ID through as the user-assigned identity selector', () => {
        // DefaultAzureCredential reads AZURE_CLIENT_ID itself and forwards it
        // as ManagedIdentityCredential's clientId internally — constructing
        // ManagedIdentityCredential directly must preserve that, or a
        // deployment using a user-assigned identity would silently
        // authenticate as the (possibly nonexistent, or wrong) system-assigned
        // identity instead.
        delete process.env.WEBSITE_INSTANCE_ID;
        delete process.env.AZURE_CLIENT_ID;
        process.env.WEBSITE_INSTANCE_ID = 'some-instance-id';
        process.env.AZURE_CLIENT_ID = 'user-assigned-client-id';

        const ManagedIdentityCredential = jest.fn();
        const DefaultAzureCredential = jest.fn();
        jest.doMock('@azure/identity', () => ({ ManagedIdentityCredential, DefaultAzureCredential }));

        const { getCredential } = require('../src/gcc-azure-estate/lib/credential');
        getCredential();

        expect(ManagedIdentityCredential).toHaveBeenCalledWith({ clientId: 'user-assigned-client-id' });
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
