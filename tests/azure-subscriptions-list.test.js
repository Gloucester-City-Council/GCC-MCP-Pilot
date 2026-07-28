'use strict';

describe('azure_subscriptions_list (tools/common/subscriptions-list.js)', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        global.fetch = originalFetch;
    });

    function mockCredential(token = 'fake-token') {
        jest.doMock('../src/gcc-azure-estate/lib/credential', () => ({
            getCredential: () => ({ getToken: jest.fn(async () => ({ token })) }),
        }));
    }

    it('calls the ARM REST subscriptions endpoint with a bearer token and maps the response', async () => {
        mockCredential('the-token');
        global.fetch = jest.fn(async (url, options) => {
            expect(url).toBe('https://management.azure.com/subscriptions?api-version=2022-12-01');
            expect(options.headers.Authorization).toBe('Bearer the-token');
            return {
                ok: true,
                json: async () => ({
                    value: [
                        { subscriptionId: 'sub-1', displayName: 'Prod', state: 'Enabled', tenantId: 'tenant-1' },
                        { subscriptionId: 'sub-2', displayName: 'Dev', state: 'Enabled', tenantId: 'tenant-1' },
                    ],
                }),
            };
        });

        const { execute } = require('../src/gcc-azure-estate/tools/common/subscriptions-list');
        const result = await execute();

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.totalCount).toBe(2);
        expect(result.subscriptions).toEqual([
            { subscriptionId: 'sub-1', displayName: 'Prod', state: 'Enabled', tenantId: 'tenant-1' },
            { subscriptionId: 'sub-2', displayName: 'Dev', state: 'Enabled', tenantId: 'tenant-1' },
        ]);
    });

    it('throws a clear error when the ARM API responds with a non-2xx status', async () => {
        mockCredential();
        global.fetch = jest.fn(async () => ({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            text: async () => '{"error":{"code":"AuthorizationFailed"}}',
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/common/subscriptions-list');

        await expect(execute()).rejects.toThrow(/403.*Forbidden.*AuthorizationFailed/s);
    });

    it('returns an empty list rather than throwing when the response has no value array', async () => {
        mockCredential();
        global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));

        const { execute } = require('../src/gcc-azure-estate/tools/common/subscriptions-list');
        const result = await execute();

        expect(result).toEqual({ subscriptions: [], totalCount: 0 });
    });
});
