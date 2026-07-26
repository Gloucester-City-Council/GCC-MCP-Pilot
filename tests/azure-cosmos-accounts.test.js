'use strict';

function asyncIterable(items) {
    return {
        [Symbol.asyncIterator]: async function* () {
            for (const item of items) yield item;
        },
    };
}

function poller(result) {
    return { pollUntilDone: jest.fn(async () => result) };
}

describe('Azure Estate cosmos-accounts family', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function mockCosmosClient({ accounts = [], getImpl, createOrUpdateImpl, updateImpl } = {}) {
        const databaseAccountsGet = getImpl || jest.fn(async (rg, name) => {
            const found = accounts.find((a) => a.name === name);
            if (!found) {
                const err = new Error('not found');
                err.statusCode = 404;
                throw err;
            }
            return found;
        });

        return {
            databaseAccounts: {
                list: () => asyncIterable(accounts),
                listByResourceGroup: () => asyncIterable(accounts),
                get: databaseAccountsGet,
                createOrUpdate: createOrUpdateImpl || jest.fn((rg, name, body) => poller({ name, ...body })),
                update: updateImpl || jest.fn((rg, name, body) => poller({ name, ...body })),
            },
        };
    }

    function setupClients({ cosmosClient, resourceClient, monitorClient } = {}) {
        jest.doMock('@azure/arm-cosmosdb', () => ({
            CosmosDBManagementClient: jest.fn().mockImplementation(() => cosmosClient),
        }));
        jest.doMock('@azure/arm-resources', () => ({
            ResourceManagementClient: jest.fn().mockImplementation(() => resourceClient || {
                resourceGroups: { get: jest.fn(async (name) => ({ name, location: 'uksouth' })) },
            }),
        }));
        jest.doMock('@azure/arm-monitor', () => ({
            MonitorClient: jest.fn().mockImplementation(() => monitorClient || {
                diagnosticSettings: { list: () => asyncIterable([]) },
            }),
        }));
        jest.doMock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
    }

    const BASE_ACCOUNT = {
        name: 'gcc-cosmos-prod',
        id: '/subscriptions/sub/resourceGroups/rg-cosmos/providers/Microsoft.DocumentDB/databaseAccounts/gcc-cosmos-prod',
        location: 'uksouth',
        kind: 'GlobalDocumentDB',
        capabilities: [],
        consistencyPolicy: { defaultConsistencyLevel: 'Session' },
        locations: [{ locationName: 'uksouth', failoverPriority: 0, isZoneRedundant: false }],
        enableAutomaticFailover: false,
        enableMultipleWriteLocations: false,
        ipRules: [],
        publicNetworkAccess: 'Enabled',
        privateEndpointConnections: [],
        disableLocalAuth: false,
        backupPolicy: { type: 'Periodic', periodicModeProperties: { backupIntervalInMinutes: 240, backupRetentionIntervalInHours: 8, backupStorageRedundancy: 'Local' } },
        provisioningState: 'Succeeded',
    };

    it('azure_cosmos_accounts_list returns accounts with apiType and capacityMode', async () => {
        setupClients({ cosmosClient: mockCosmosClient({ accounts: [BASE_ACCOUNT] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-accounts/list');
        const result = await execute({ instance: 'azure-prod' });

        expect(result.totalCount).toBe(1);
        expect(result.accounts[0]).toMatchObject({ name: 'gcc-cosmos-prod', apiType: 'Sql', capacityMode: 'Provisioned' });
    });

    it('azure_cosmos_account_inspect returns full detail and throws NOT_FOUND for a missing account', async () => {
        setupClients({ cosmosClient: mockCosmosClient({ accounts: [BASE_ACCOUNT] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-accounts/inspect');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod' });

        expect(result.apiType).toBe('Sql');
        expect(result.consistencyPolicy).toEqual({ defaultConsistencyLevel: 'Session' });
        expect(result.automaticFailoverEnabled).toBe(false);
        expect(result.capacityMode).toBe('Provisioned');
        expect(result.backupPolicy.type).toBe('Periodic');
        expect(result.localAuthDisabled).toBe(false);

        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');
        await expect(execute({ instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'missing' }))
            .rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    });

    it('azure_cosmos_account_diagnose flags no automatic failover on a multi-region account and public access with no firewall', async () => {
        const multiRegionAccount = {
            ...BASE_ACCOUNT,
            locations: [
                { locationName: 'uksouth', failoverPriority: 0 },
                { locationName: 'ukwest', failoverPriority: 1 },
            ],
        };
        setupClients({ cosmosClient: mockCosmosClient({ accounts: [multiRegionAccount] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-accounts/diagnose');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod' });

        expect(result.overallStatus).toBe('FINDINGS');
        expect(result.failedChecks).toEqual(expect.arrayContaining(['noAutomaticFailoverMultiRegion', 'publicNetworkNoFirewall', 'missingDiagnosticSettings']));
        expect(result.findings.localAuthEnabled.pass).toBe(false);
    });

    it('azure_cosmos_account_diagnose passes a well-configured account', async () => {
        const wellConfigured = {
            ...BASE_ACCOUNT,
            disableLocalAuth: true,
            publicNetworkAccess: 'Disabled',
            backupPolicy: { type: 'Continuous', continuousModeProperties: { tier: 'Continuous30Days' } },
        };
        setupClients({
            cosmosClient: mockCosmosClient({ accounts: [wellConfigured] }),
            monitorClient: { diagnosticSettings: { list: () => asyncIterable([{ name: 'diag1' }]) } },
        });

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-accounts/diagnose');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod' });

        expect(result.overallStatus).toBe('PASS');
        expect(result.failedChecks).toEqual([]);
    });

    it('azure_cosmos_account_compare flags consistency and capacity-mode drift between two accounts', async () => {
        jest.doMock('@azure/arm-cosmosdb', () => {
            const bySubscription = {
                'sub-a': mockCosmosClient({ accounts: [{ ...BASE_ACCOUNT, name: 'acct-a' }] }),
                'sub-b': mockCosmosClient({ accounts: [{ ...BASE_ACCOUNT, name: 'acct-b', consistencyPolicy: { defaultConsistencyLevel: 'Strong' }, capabilities: [{ name: 'EnableServerless' }] }] }),
            };
            return { CosmosDBManagementClient: jest.fn().mockImplementation((_cred, subscriptionId) => bySubscription[subscriptionId]) };
        });
        jest.doMock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));

        const permissions = { cosmos: ['inspect', 'diagnose', 'compare', 'plan', 'create', 'modify'] };
        const instanceA = { name: 'side-a', environment: 'production', subscriptionId: 'sub-a', permissions };
        const instanceB = { name: 'side-b', environment: 'production', subscriptionId: 'sub-b', permissions };

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-accounts/compare');
        const result = await execute({
            left: { instance: instanceA, resourceGroup: 'rg-cosmos', accountName: 'acct-a' },
            right: { instance: instanceB, resourceGroup: 'rg-cosmos', accountName: 'acct-b' },
        });

        expect(result.identical).toBe(false);
        expect(result.drift.consistencyPolicy).toEqual({ left: { defaultConsistencyLevel: 'Session' }, right: { defaultConsistencyLevel: 'Strong' } });
        expect(result.drift.capacityMode).toEqual({ left: 'Provisioned', right: 'Serverless' });
    });

    it('azure_cosmos_account_create_plan reports DEPENDENCY blockers as canApply:false when the resource group is missing', async () => {
        setupClients({
            cosmosClient: mockCosmosClient({ accounts: [] }),
            resourceClient: {
                resourceGroups: {
                    get: jest.fn(async () => { const err = new Error('not found'); err.statusCode = 404; throw err; }),
                },
            },
        });

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-accounts/create-plan');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-missing',
            accountName: 'new-account',
            location: 'uksouth',
            apiType: 'Sql',
            consistencyPolicy: { defaultConsistencyLevel: 'Session' },
            regions: [{ locationName: 'uksouth', failoverPriority: 0 }],
            capacityMode: 'Provisioned',
        });

        expect(result.canApply).toBe(false);
        expect(result.blockers).toContain('resourceGroup');
        expect(result.dependencies.resourceGroup.satisfied).toBe(false);
    });

    it('azure_cosmos_account_create builds the correct kind/capabilities for a Cassandra serverless account and calls createOrUpdate', async () => {
        const createOrUpdateImpl = jest.fn((rg, name, body) => poller({ name, provisioningState: 'Succeeded', location: body.location }));
        setupClients({
            cosmosClient: mockCosmosClient({ accounts: [], createOrUpdateImpl }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-accounts/create');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-cosmos',
            accountName: 'new-cassandra-account',
            location: 'uksouth',
            apiType: 'Cassandra',
            consistencyPolicy: { defaultConsistencyLevel: 'Session' },
            regions: [{ locationName: 'uksouth', failoverPriority: 0 }],
            capacityMode: 'Serverless',
        });

        expect(result.created).toBe(true);
        expect(createOrUpdateImpl).toHaveBeenCalledWith(
            'rg-cosmos',
            'new-cassandra-account',
            expect.objectContaining({
                kind: 'GlobalDocumentDB',
                capabilities: expect.arrayContaining([{ name: 'EnableCassandra' }, { name: 'EnableServerless' }]),
            })
        );
    });

    it('azure_cosmos_account_create fails with CONFLICT when the account already exists', async () => {
        setupClients({ cosmosClient: mockCosmosClient({ accounts: [BASE_ACCOUNT] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-accounts/create');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-cosmos',
            accountName: 'gcc-cosmos-prod',
            location: 'uksouth',
            apiType: 'Sql',
            consistencyPolicy: { defaultConsistencyLevel: 'Session' },
            regions: [{ locationName: 'uksouth', failoverPriority: 0 }],
            capacityMode: 'Provisioned',
        })).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    });

    it('azure_cosmos_account_config_plan diffs requested vs current config without writing', async () => {
        const updateSpy = jest.fn();
        setupClients({ cosmosClient: mockCosmosClient({ accounts: [BASE_ACCOUNT], updateImpl: updateSpy }) });

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-accounts/config-plan');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-cosmos',
            accountName: 'gcc-cosmos-prod',
            config: { disableLocalAuth: true, publicNetworkAccess: 'Disabled' },
        });

        expect(result.diff.disableLocalAuth).toEqual({ from: false, to: true });
        expect(result.diff.publicNetworkAccess).toEqual({ from: 'Enabled', to: 'Disabled' });
        expect(result.willChange).toBe(true);
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('azure_cosmos_account_config_apply calls databaseAccounts.update with only the requested fields', async () => {
        const updateSpy = jest.fn((rg, name, body) => poller({ name, provisioningState: 'Succeeded' }));
        setupClients({ cosmosClient: mockCosmosClient({ accounts: [BASE_ACCOUNT], updateImpl: updateSpy }) });

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-accounts/config-apply');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-cosmos',
            accountName: 'gcc-cosmos-prod',
            config: { disableLocalAuth: true },
        });

        expect(updateSpy).toHaveBeenCalledWith('rg-cosmos', 'gcc-cosmos-prod', { disableLocalAuth: true });
        expect(result.accountName).toBe('gcc-cosmos-prod');
    });

    it('azure_cosmos_account_config_plan rejects an unsupported config field', async () => {
        setupClients({ cosmosClient: mockCosmosClient({ accounts: [BASE_ACCOUNT] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-accounts/config-plan');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod', config: { notARealField: true },
        })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
    });
});
