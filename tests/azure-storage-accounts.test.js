'use strict';

function asyncIterable(items) {
    return {
        [Symbol.asyncIterator]: async function* () {
            for (const item of items) yield item;
        },
    };
}

describe('Azure Estate storage-accounts family', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function mockStorageClient({
        accounts = [],
        getPropertiesImpl,
        createImpl,
        updateImpl,
        checkNameAvailabilityImpl,
        blobServicePropsByAccount = {},
        managementPolicyByAccount = {},
        privateEndpointConnectionsByAccount = {},
    } = {}) {
        const getProperties = getPropertiesImpl || jest.fn(async (resourceGroup, name) => {
            const found = accounts.find((a) => a.name === name);
            if (!found) {
                const err = new Error('not found');
                err.statusCode = 404;
                throw err;
            }
            return found;
        });

        return {
            storageAccounts: {
                list: () => asyncIterable(accounts),
                listByResourceGroup: () => asyncIterable(accounts),
                getProperties,
                create: createImpl || jest.fn(async (rg, name, params) => ({ name, provisioningState: 'Succeeded', ...params })),
                update: updateImpl || jest.fn(async (rg, name, params) => ({ name, ...params })),
                checkNameAvailability: checkNameAvailabilityImpl || jest.fn(async () => ({ nameAvailable: true })),
            },
            blobServices: {
                list: (rg, name) => asyncIterable(blobServicePropsByAccount[name] ? [blobServicePropsByAccount[name]] : []),
            },
            managementPolicies: {
                get: jest.fn(async (rg, name) => {
                    const policy = managementPolicyByAccount[name];
                    if (!policy) {
                        const err = new Error('not found');
                        err.statusCode = 404;
                        throw err;
                    }
                    return policy;
                }),
            },
            privateEndpointConnections: {
                list: (rg, name) => asyncIterable(privateEndpointConnectionsByAccount[name] || []),
            },
        };
    }

    function setupClients({ storageClient, monitorClient } = {}) {
        jest.doMock('@azure/arm-storage', () => ({
            StorageManagementClient: jest.fn().mockImplementation(() => storageClient),
        }));
        jest.doMock('@azure/arm-monitor', () => ({
            MonitorClient: jest.fn().mockImplementation(() => monitorClient || {
                diagnosticSettings: { list: () => asyncIterable([]) },
            }),
        }));
        jest.doMock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
    }

    it('azure_storage_accounts_list returns accounts with kind/sku/accessTier', async () => {
        setupClients({
            storageClient: mockStorageClient({
                accounts: [{
                    id: '/subscriptions/sub-1/resourceGroups/rg-one/providers/Microsoft.Storage/storageAccounts/stone',
                    name: 'stone',
                    location: 'uksouth',
                    kind: 'StorageV2',
                    sku: { name: 'Standard_LRS', tier: 'Standard' },
                    accessTier: 'Hot',
                    provisioningState: 'Succeeded',
                }],
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/storage-accounts/list');
        const result = await execute({ instance: 'azure-prod' });

        expect(result.totalCount).toBe(1);
        expect(result.storageAccounts[0]).toMatchObject({
            name: 'stone', resourceGroup: 'rg-one', kind: 'StorageV2', accessTier: 'Hot',
        });
    });

    it('azure_storage_account_inspect returns full configuration detail', async () => {
        setupClients({
            storageClient: mockStorageClient({
                accounts: [{
                    id: '/subscriptions/sub-1/resourceGroups/rg-one/providers/Microsoft.Storage/storageAccounts/stone',
                    name: 'stone',
                    location: 'uksouth',
                    kind: 'StorageV2',
                    sku: { name: 'Standard_GRS', tier: 'Standard' },
                    accessTier: 'Hot',
                    publicNetworkAccess: 'Enabled',
                    allowSharedKeyAccess: true,
                    minimumTlsVersion: 'TLS1_2',
                    enableHttpsTrafficOnly: true,
                    networkRuleSet: { defaultAction: 'Deny', ipRules: [{ value: '1.2.3.4' }], virtualNetworkRules: [] },
                    identity: { type: 'SystemAssigned', principalId: 'principal-1' },
                    encryption: { keySource: 'Microsoft.Storage' },
                    provisioningState: 'Succeeded',
                }],
                blobServicePropsByAccount: {
                    stone: { deleteRetentionPolicy: { enabled: true, days: 14 }, isVersioningEnabled: true },
                },
                managementPolicyByAccount: {
                    stone: { policy: { rules: [{ name: 'rule1', enabled: true, type: 'Lifecycle', definition: {} }] } },
                },
                privateEndpointConnectionsByAccount: {
                    stone: [{ name: 'pe-1' }],
                },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/storage-accounts/inspect');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-one', name: 'stone' });

        expect(result.sku).toEqual({ name: 'Standard_GRS', tier: 'Standard' });
        expect(result.networkAcls).toMatchObject({ defaultAction: 'Deny', ipRuleCount: 1, virtualNetworkRuleCount: 0 });
        expect(result.privateEndpointConnections).toEqual({ count: 1, names: ['pe-1'] });
        expect(result.blobService).toEqual({ softDelete: { enabled: true, days: 14 }, versioningEnabled: true });
        expect(result.lifecycleManagement).toEqual({ hasPolicy: true, ruleCount: 1 });
        expect(result.encryption).toEqual({ keySource: 'Microsoft.Storage' });
    });

    it('azure_storage_account_inspect throws NOT_FOUND for a missing account', async () => {
        setupClients({ storageClient: mockStorageClient({ accounts: [] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/storage-accounts/inspect');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ instance: 'azure-prod', resourceGroup: 'rg-one', name: 'missing' }))
            .rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    });

    it('azure_storage_account_diagnose flags an open, unrestricted, insecurely-configured account', async () => {
        setupClients({
            storageClient: mockStorageClient({
                accounts: [{
                    id: '/subscriptions/sub-1/resourceGroups/rg-one/providers/Microsoft.Storage/storageAccounts/insecure',
                    name: 'insecure',
                    location: 'uksouth',
                    kind: 'StorageV2',
                    sku: { name: 'Standard_LRS' },
                    publicNetworkAccess: 'Enabled',
                    allowSharedKeyAccess: true,
                    minimumTlsVersion: 'TLS1_0',
                    enableHttpsTrafficOnly: false,
                    networkRuleSet: { defaultAction: 'Allow', ipRules: [], virtualNetworkRules: [] },
                }],
                blobServicePropsByAccount: {
                    insecure: { deleteRetentionPolicy: { enabled: false }, isVersioningEnabled: false },
                },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/storage-accounts/diagnose');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-one', name: 'insecure' });

        expect(result.overallStatus).toBe('FINDINGS');
        expect(result.failedChecks).toEqual(expect.arrayContaining([
            'publicNetworkExposure', 'sharedKeyAccess', 'minimumTlsVersion', 'httpsOnly', 'softDelete', 'versioning', 'diagnosticSettings',
        ]));
    });

    it('azure_storage_account_diagnose passes a well-configured account', async () => {
        setupClients({
            storageClient: mockStorageClient({
                accounts: [{
                    id: '/subscriptions/sub-1/resourceGroups/rg-one/providers/Microsoft.Storage/storageAccounts/secure',
                    name: 'secure',
                    location: 'uksouth',
                    kind: 'StorageV2',
                    sku: { name: 'Standard_GRS' },
                    publicNetworkAccess: 'Disabled',
                    allowSharedKeyAccess: false,
                    minimumTlsVersion: 'TLS1_2',
                    enableHttpsTrafficOnly: true,
                    networkRuleSet: { defaultAction: 'Deny', ipRules: [], virtualNetworkRules: [] },
                }],
                blobServicePropsByAccount: {
                    secure: { deleteRetentionPolicy: { enabled: true, days: 7 }, isVersioningEnabled: true },
                },
            }),
            monitorClient: { diagnosticSettings: { list: () => asyncIterable([{ name: 'diag-1' }]) } },
        });

        const { execute } = require('../src/gcc-azure-estate/tools/storage-accounts/diagnose');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-one', name: 'secure' });

        expect(result.overallStatus).toBe('PASS');
        expect(result.failedChecks).toEqual([]);
    });

    it('azure_storage_account_create_plan flags an invalid kind/sku combination', async () => {
        setupClients({ storageClient: mockStorageClient({ accounts: [] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/storage-accounts/create-plan');
        const result = await execute({
            instance: 'azure-prod', resourceGroup: 'rg-one', name: 'newacct', location: 'uksouth', sku: 'Standard_LRS', kind: 'BlockBlobStorage',
        });

        expect(result.validation.pass).toBe(false);
        expect(result.willCreate).toBe(false);
    });

    it('azure_storage_account_create_plan reports no conflicts for a valid, available name', async () => {
        setupClients({
            storageClient: mockStorageClient({
                accounts: [],
                checkNameAvailabilityImpl: jest.fn(async () => ({ nameAvailable: true })),
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/storage-accounts/create-plan');
        const result = await execute({
            instance: 'azure-prod', resourceGroup: 'rg-one', name: 'newacct', location: 'uksouth', sku: 'Standard_LRS', kind: 'StorageV2',
        });

        expect(result.validation.pass).toBe(true);
        expect(result.conflicts).toEqual([]);
        expect(result.willCreate).toBe(true);
    });

    it('azure_storage_account_create fails with CONFLICT when the account already exists', async () => {
        setupClients({
            storageClient: mockStorageClient({
                accounts: [{ name: 'exists', location: 'uksouth' }],
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/storage-accounts/create');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            instance: 'azure-prod', resourceGroup: 'rg-one', name: 'exists', location: 'uksouth', sku: 'Standard_LRS', kind: 'StorageV2',
        })).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    });

    it('azure_storage_account_config_plan computes add/change/unchanged without writing', async () => {
        const updateSpy = jest.fn();
        setupClients({
            storageClient: mockStorageClient({
                accounts: [{
                    name: 'stone', location: 'uksouth', minimumTlsVersion: 'TLS1_1', allowSharedKeyAccess: true, publicNetworkAccess: 'Enabled', enableHttpsTrafficOnly: true,
                }],
                updateImpl: updateSpy,
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/storage-accounts/config-plan');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-one',
            name: 'stone',
            config: { minimumTlsVersion: 'TLS1_2', allowSharedKeyAccess: false, httpsOnly: true },
        });

        expect(result.plan.toChange).toEqual({
            minimumTlsVersion: { from: 'TLS1_1', to: 'TLS1_2' },
            allowSharedKeyAccess: { from: true, to: false },
        });
        expect(result.plan.unchanged).toEqual({ httpsOnly: true });
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('azure_storage_account_config_apply applies the update via storageAccounts.update', async () => {
        const updateSpy = jest.fn(async (rg, name, params) => ({ name, minimumTlsVersion: 'TLS1_2', allowSharedKeyAccess: false, enableHttpsTrafficOnly: true, publicNetworkAccess: 'Enabled', ...params }));
        setupClients({
            storageClient: mockStorageClient({
                accounts: [{ name: 'stone', location: 'uksouth', minimumTlsVersion: 'TLS1_1' }],
                updateImpl: updateSpy,
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/storage-accounts/config-apply');
        const result = await execute({
            instance: 'azure-prod', resourceGroup: 'rg-one', name: 'stone', config: { minimumTlsVersion: 'TLS1_2' },
        });

        expect(updateSpy).toHaveBeenCalledWith('rg-one', 'stone', { minimumTlsVersion: 'TLS1_2' });
        expect(result.minimumTlsVersion).toBe('TLS1_2');
    });

    it('azure_storage_account_compare flags SKU and TLS drift', async () => {
        jest.doMock('@azure/arm-storage', () => {
            const bySubscription = {
                'sub-a': mockStorageClient({ accounts: [{ name: 'acct', sku: { name: 'Standard_LRS' }, kind: 'StorageV2', minimumTlsVersion: 'TLS1_2', networkRuleSet: {} }] }),
                'sub-b': mockStorageClient({ accounts: [{ name: 'acct', sku: { name: 'Standard_GRS' }, kind: 'StorageV2', minimumTlsVersion: 'TLS1_0', networkRuleSet: {} }] }),
            };
            return { StorageManagementClient: jest.fn().mockImplementation((_cred, subscriptionId) => bySubscription[subscriptionId]) };
        });
        jest.doMock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));

        const permissions = { storage: ['inspect', 'diagnose', 'compare', 'plan', 'create', 'modify'] };
        const instanceA = { name: 'side-a', environment: 'production', subscriptionId: 'sub-a', permissions };
        const instanceB = { name: 'side-b', environment: 'production', subscriptionId: 'sub-b', permissions };

        const { execute } = require('../src/gcc-azure-estate/tools/storage-accounts/compare');
        const result = await execute({
            left: { instance: instanceA, resourceGroup: 'rg-a', name: 'acct' },
            right: { instance: instanceB, resourceGroup: 'rg-b', name: 'acct' },
        });

        expect(result.identical).toBe(false);
        expect(result.differences.skuName).toEqual({ from: 'Standard_LRS', to: 'Standard_GRS' });
        expect(result.differences.minimumTlsVersion).toEqual({ from: 'TLS1_2', to: 'TLS1_0' });
    });

    it('rejects operations when the instance lacks the required permission', async () => {
        setupClients({ storageClient: mockStorageClient({ accounts: [] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/storage-accounts/create');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        const readOnlyInstance = { name: 'ro', environment: 'production', subscriptionId: 'sub-ro', permissions: { storage: ['inspect'] } };

        await expect(execute({
            instance: readOnlyInstance, resourceGroup: 'rg-one', name: 'newacct', location: 'uksouth', sku: 'Standard_LRS', kind: 'StorageV2',
        })).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    });
});
