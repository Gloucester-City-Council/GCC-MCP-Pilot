'use strict';

function asyncIterable(items) {
    return {
        [Symbol.asyncIterator]: async function* () {
            for (const item of items) yield item;
        },
    };
}

function poller(result) {
    return { pollUntilDone: async () => result };
}

describe('Azure Estate function-apps family', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function mockWebSiteClient({
        sites = [],
        slotsBySite = {},
        configBySite = {},
        settingsBySite = {},
        plans = [],
        getImpl,
        getSlotImpl,
        updateImpl,
        createOrUpdateImpl,
        createOrUpdateSlotImpl,
        updateConfigurationImpl,
        updateApplicationSettingsImpl,
        swapSlotWithProductionImpl,
        swapSlotImpl,
    } = {}) {
        const webAppsGet = getImpl || jest.fn(async (rg, name) => {
            const found = sites.find((s) => s.name === name);
            if (!found) {
                const err = new Error('not found');
                err.statusCode = 404;
                throw err;
            }
            return found;
        });

        const getSlot = getSlotImpl || jest.fn(async (rg, name, slot) => {
            const slots = slotsBySite[name] || [];
            const found = slots.find((s) => s.name === slot);
            if (!found) {
                const err = new Error('not found');
                err.statusCode = 404;
                throw err;
            }
            return found;
        });

        return {
            webApps: {
                listByResourceGroup: () => asyncIterable(sites),
                get: webAppsGet,
                getSlot,
                listSlots: (rg, name) => asyncIterable(slotsBySite[name] || []),
                getConfiguration: jest.fn(async (rg, name) => configBySite[name] || {}),
                updateConfiguration: updateConfigurationImpl || jest.fn(async (rg, name, cfg) => cfg),
                listApplicationSettings: jest.fn(async (rg, name) => ({ properties: settingsBySite[name] || {} })),
                updateApplicationSettings: updateApplicationSettingsImpl || jest.fn(async (rg, name, dict) => dict),
                update: updateImpl || jest.fn(async (rg, name, patch) => ({ name, ...patch })),
                createOrUpdate: createOrUpdateImpl || jest.fn(async (rg, name, envelope) => poller({ name, ...envelope })),
                createOrUpdateSlot: createOrUpdateSlotImpl || jest.fn(async (rg, name, slot, envelope) => poller({ name: slot, ...envelope })),
                swapSlotWithProduction: swapSlotWithProductionImpl || jest.fn(async () => poller(undefined)),
                swapSlot: swapSlotImpl || jest.fn(async () => poller(undefined)),
            },
            appServicePlans: {
                get: jest.fn(async (rg, name) => {
                    const found = plans.find((p) => p.name === name);
                    if (!found) {
                        const err = new Error('not found');
                        err.statusCode = 404;
                        throw err;
                    }
                    return found;
                }),
            },
        };
    }

    function mockResourceClient({ groups = [] } = {}) {
        return {
            resourceGroups: {
                get: jest.fn(async (name) => {
                    const found = groups.find((g) => g.name === name);
                    if (!found) {
                        const err = new Error('not found');
                        err.statusCode = 404;
                        throw err;
                    }
                    return found;
                }),
            },
        };
    }

    function mockStorageClient({ accounts = [] } = {}) {
        return {
            storageAccounts: {
                getProperties: jest.fn(async (rg, name) => {
                    const found = accounts.find((a) => a.name === name);
                    if (!found) {
                        const err = new Error('not found');
                        err.statusCode = 404;
                        throw err;
                    }
                    return found;
                }),
                listKeys: jest.fn(async () => ({ keys: [{ keyName: 'key1', value: 'fake-storage-key' }] })),
            },
        };
    }

    function mockAppInsightsClient({ components = [] } = {}) {
        return {
            components: {
                get: jest.fn(async (rg, name) => {
                    const found = components.find((c) => c.name === name);
                    if (!found) {
                        const err = new Error('not found');
                        err.statusCode = 404;
                        throw err;
                    }
                    return found;
                }),
            },
        };
    }

    function setupClients({
        webSiteClient, resourceClient, storageClient, appInsightsClient,
    } = {}) {
        jest.doMock('@azure/arm-appservice', () => ({
            WebSiteManagementClient: jest.fn().mockImplementation(() => webSiteClient || mockWebSiteClient()),
        }));
        jest.doMock('@azure/arm-resources', () => ({
            ResourceManagementClient: jest.fn().mockImplementation(() => resourceClient || mockResourceClient()),
        }));
        jest.doMock('@azure/arm-storage', () => ({
            StorageManagementClient: jest.fn().mockImplementation(() => storageClient || mockStorageClient()),
        }));
        jest.doMock('@azure/arm-appinsights', () => ({
            ApplicationInsightsManagementClient: jest.fn().mockImplementation(() => appInsightsClient || mockAppInsightsClient()),
        }));
        jest.doMock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
    }

    it('azure_function_apps_list returns only Function App sites with hostnames/tags', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [
                    { name: 'func-one', location: 'uksouth', kind: 'functionapp,linux', state: 'Running', hostNames: ['func-one.azurewebsites.net'], tags: { environment: 'production' } },
                    { name: 'web-one', location: 'uksouth', kind: 'app', state: 'Running', hostNames: [], tags: {} },
                ],
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/list');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-funcs' });

        expect(result.totalCount).toBe(1);
        expect(result.functionApps[0]).toMatchObject({ name: 'func-one', kind: 'functionapp,linux', hostNames: ['func-one.azurewebsites.net'] });
    });

    it('azure_function_app_inspect never returns raw app-setting values, only names + classification', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [{
                    name: 'func-one',
                    location: 'uksouth',
                    kind: 'functionapp,linux',
                    reserved: true,
                    httpsOnly: true,
                    serverFarmId: '/subscriptions/sub/resourceGroups/rg-funcs/providers/Microsoft.Web/serverfarms/plan-one',
                    identity: { type: 'SystemAssigned', principalId: 'principal-123' },
                    tags: {},
                }],
                configBySite: {
                    'func-one': {
                        linuxFxVersion: 'NODE|18', minTlsVersion: '1.2', cors: { allowedOrigins: ['https://example.com'] }, healthCheckPath: '/health', alwaysOn: true,
                    },
                },
                settingsBySite: {
                    'func-one': {
                        AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=funcstore;AccountKey=SUPERSECRETKEY123',
                        APPINSIGHTS_INSTRUMENTATIONKEY: 'fake-ikey',
                        MY_KEYVAULT_SETTING: '@Microsoft.KeyVault(SecretUri=https://vault.vault.azure.net/secrets/foo)',
                        FEATURE_FLAG: 'enabled',
                    },
                },
                slotsBySite: { 'func-one': [{ name: 'staging' }] },
                plans: [{ name: 'plan-one', sku: { name: 'EP1', tier: 'ElasticPremium' }, reserved: true }],
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/inspect');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-funcs', name: 'func-one' });

        const serialized = JSON.stringify(result);
        expect(serialized).not.toMatch(/SUPERSECRETKEY123/);
        expect(serialized).not.toMatch(/SecretUri=/);

        expect(result.appSettings.settings).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'AzureWebJobsStorage', classification: 'secret-like' }),
            expect.objectContaining({ name: 'FEATURE_FLAG', classification: 'plain' }),
            expect.objectContaining({ name: 'MY_KEYVAULT_SETTING', keyVaultReference: true }),
        ]));
        expect(result.storageDependency).toEqual({ accountName: 'funcstore', configured: true });
        expect(result.runtime).toMatchObject({ osType: 'Linux', runtimeName: 'node', runtimeVersion: '18' });
        expect(result.deploymentSlots).toEqual(['staging']);
        expect(result.managedIdentity).toEqual({ type: 'SystemAssigned', principalId: 'principal-123' });
        expect(result.hostingPlan).toMatchObject({ available: true, skuName: 'EP1' });
    });

    it('azure_function_app_diagnose returns FINDINGS with the expected checklist shape', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [{
                    name: 'func-insecure', location: 'uksouth', kind: 'functionapp,linux', reserved: true, httpsOnly: false, identity: { type: 'None' },
                }],
                configBySite: {
                    'func-insecure': { minTlsVersion: '1.0', cors: { allowedOrigins: ['*'] } },
                },
                settingsBySite: { 'func-insecure': { AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=missingstore;AccountKey=xxx' } },
            }),
            storageClient: mockStorageClient({ accounts: [] }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/diagnose');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-funcs', name: 'func-insecure' });

        expect(result.overallStatus).toBe('FINDINGS');
        expect(result.failedChecks).toEqual(expect.arrayContaining([
            'tlsMinVersion', 'httpsOnly', 'corsWildcard', 'applicationInsights', 'managedIdentity', 'storageAccountReachable', 'healthCheck',
        ]));
        expect(result.findings.tlsMinVersion).toHaveProperty('pass', false);
        expect(result.findings.corsWildcard).toHaveProperty('pass', false);
        expect(result.findings.storageAccountReachable).toMatchObject({ pass: false, accountName: 'missingstore' });
    });

    it('azure_function_app_diagnose returns PASS when everything is configured well', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [{
                    name: 'func-good', location: 'uksouth', kind: 'functionapp,linux', reserved: true, httpsOnly: true, identity: { type: 'SystemAssigned' },
                }],
                configBySite: {
                    'func-good': { minTlsVersion: '1.2', cors: { allowedOrigins: ['https://example.com'] }, healthCheckPath: '/health' },
                },
                settingsBySite: {
                    'func-good': {
                        AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=goodstore;AccountKey=xxx',
                        APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=fake',
                    },
                },
            }),
            storageClient: mockStorageClient({ accounts: [{ name: 'goodstore' }] }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/diagnose');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-funcs', name: 'func-good' });

        expect(result.overallStatus).toBe('PASS');
        expect(result.failedChecks).toEqual([]);
    });

    it('azure_function_app_create_plan makes each dependency explicit as present/missing', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [],
                plans: [{ name: 'plan-existing', sku: { name: 'EP1' }, reserved: true }],
            }),
            resourceClient: mockResourceClient({ groups: [{ name: 'rg-funcs', location: 'uksouth' }] }),
            storageClient: mockStorageClient({ accounts: [] }),
            appInsightsClient: mockAppInsightsClient({ components: [] }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/create-plan');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-funcs',
            name: 'func-new',
            location: 'uksouth',
            hostingPlanName: 'plan-existing',
            storageAccountName: 'storage-does-not-exist',
            runtime: { name: 'node', version: '18' },
            osType: 'Linux',
        });

        expect(result.dependencies.resourceGroup).toMatchObject({ present: true });
        expect(result.dependencies.hostingPlan).toMatchObject({ present: true, name: 'plan-existing' });
        expect(result.dependencies.storageAccount).toMatchObject({ present: false });
        expect(result.dependencies.applicationInsights).toMatchObject({ present: false, optional: true });
        expect(result.missingDependencies).toContain('storageAccount');
        expect(result.readyToCreate).toBe(false);
        expect(result.willCreate).toBeNull();
    });

    it('azure_function_app_create_plan reports readyToCreate:true when every required dependency is present', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [],
                plans: [{ name: 'plan-existing', sku: { name: 'EP1' }, reserved: true }],
            }),
            resourceClient: mockResourceClient({ groups: [{ name: 'rg-funcs', location: 'uksouth' }] }),
            storageClient: mockStorageClient({ accounts: [{ name: 'storage-exists' }] }),
            appInsightsClient: mockAppInsightsClient({ components: [] }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/create-plan');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-funcs',
            name: 'func-new',
            location: 'uksouth',
            hostingPlanName: 'plan-existing',
            storageAccountName: 'storage-exists',
            runtime: { name: 'node', version: '18' },
            osType: 'Linux',
        });

        expect(result.missingDependencies).toEqual([]);
        expect(result.readyToCreate).toBe(true);
        expect(result.willCreate).not.toBeNull();
    });

    it('azure_function_app_create fails with DEPENDENCY_MISSING when the storage account does not exist', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [],
                plans: [{ name: 'plan-existing', sku: { name: 'EP1' }, reserved: true }],
            }),
            resourceClient: mockResourceClient({ groups: [{ name: 'rg-funcs', location: 'uksouth' }] }),
            storageClient: mockStorageClient({ accounts: [] }),
            appInsightsClient: mockAppInsightsClient({ components: [] }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/create');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-funcs',
            name: 'func-new',
            location: 'uksouth',
            hostingPlanName: 'plan-existing',
            storageAccountName: 'storage-missing',
            runtime: { name: 'node', version: '18' },
        })).rejects.toMatchObject({ code: ERROR_CODES.DEPENDENCY_MISSING });
    });

    it('azure_function_app_settings_plan computes add/change/unchanged and redacts secret-like values', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [{ name: 'func-one', location: 'uksouth', kind: 'functionapp,linux' }],
                settingsBySite: {
                    'func-one': {
                        FEATURE_FLAG: 'off', AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=x;AccountKey=oldsecret',
                    },
                },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/settings-plan');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-funcs',
            name: 'func-one',
            appSettings: {
                FEATURE_FLAG: 'on', NEW_SETTING: 'hello', AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=x;AccountKey=newsecret',
            },
        });

        expect(result.plan.toAdd).toEqual({ NEW_SETTING: 'hello' });
        expect(result.plan.toChange.FEATURE_FLAG).toEqual({ from: 'off', to: 'on' });
        expect(result.plan.toChange.AzureWebJobsStorage.from).toMatch(/redacted/);
        expect(result.plan.toChange.AzureWebJobsStorage.to).toMatch(/redacted/);
        expect(JSON.stringify(result)).not.toMatch(/oldsecret|newsecret/);
        expect(result.willChange).toBe(true);
    });

    it('azure_function_app_settings_apply merges settings and only reports setting names', async () => {
        const updateSpy = jest.fn(async (rg, name, dict) => dict);
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [{ name: 'func-one', location: 'uksouth', kind: 'functionapp,linux' }],
                settingsBySite: { 'func-one': { EXISTING: 'value' } },
                updateApplicationSettingsImpl: updateSpy,
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/settings-apply');
        const result = await execute({
            instance: 'azure-prod', resourceGroup: 'rg-funcs', name: 'func-one', appSettings: { NEW_ONE: 'v1' },
        });

        expect(updateSpy).toHaveBeenCalledWith('rg-funcs', 'func-one', { properties: { EXISTING: 'value', NEW_ONE: 'v1' } });
        expect(result.appSettingNames).toEqual(expect.arrayContaining(['EXISTING', 'NEW_ONE']));
        expect(result.updatedNames).toEqual(['NEW_ONE']);
    });

    it('azure_function_app_identity_apply enables SystemAssigned identity via webApps.update', async () => {
        const updateSpy = jest.fn(async (rg, name, patch) => ({ name, identity: { type: patch.identity.type, principalId: 'new-principal' } }));
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [{ name: 'func-one', location: 'uksouth', kind: 'functionapp,linux', identity: { type: 'None' } }],
                updateImpl: updateSpy,
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/identity-apply');
        const result = await execute({
            instance: 'azure-prod', resourceGroup: 'rg-funcs', name: 'func-one', systemAssigned: true,
        });

        expect(updateSpy).toHaveBeenCalledWith('rg-funcs', 'func-one', { identity: { type: 'SystemAssigned' } });
        expect(result.identity).toEqual({ type: 'SystemAssigned', principalId: 'new-principal', userAssignedResourceIds: [] });
    });

    it('azure_function_app_config_plan diffs minTlsVersion/httpsOnly/cors against current state', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [{
                    name: 'func-one', location: 'uksouth', kind: 'functionapp,linux', httpsOnly: false,
                }],
                configBySite: { 'func-one': { minTlsVersion: '1.0', cors: { allowedOrigins: [] } } },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/config-plan');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-funcs',
            name: 'func-one',
            config: { minTlsVersion: '1.2', httpsOnly: true },
        });

        expect(result.plan.toChange.minTlsVersion).toEqual({ from: '1.0', to: '1.2' });
        expect(result.plan.toChange.httpsOnly).toEqual({ from: false, to: true });
        expect(result.willChange).toBe(true);
    });

    it('azure_function_slot_swap_plan describes a slot-to-production swap', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [{ name: 'func-one', location: 'uksouth', kind: 'functionapp,linux', hostNames: ['func-one.azurewebsites.net'], state: 'Running' }],
                slotsBySite: { 'func-one': [{ name: 'staging', hostNames: ['func-one-staging.azurewebsites.net'], state: 'Running' }] },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/slot-swap-plan');
        const result = await execute({
            instance: 'azure-prod', resourceGroup: 'rg-funcs', name: 'func-one', sourceSlot: 'staging',
        });

        expect(result.targetSlot).toBe('production');
        expect(result.operation).toBe('swapSlotWithProduction');
        expect(result.current.source.hostNames).toEqual(['func-one-staging.azurewebsites.net']);
        expect(result.current.target.hostNames).toEqual(['func-one.azurewebsites.net']);
    });

    it('azure_function_slot_swap_plan throws NOT_FOUND when the source slot does not exist', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [{ name: 'func-one', location: 'uksouth', kind: 'functionapp,linux' }],
                slotsBySite: { 'func-one': [] },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/slot-swap-plan');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            instance: 'azure-prod', resourceGroup: 'rg-funcs', name: 'func-one', sourceSlot: 'staging',
        })).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    });

    it('azure_function_slot_swap performs swapSlotWithProduction when targetSlot is production', async () => {
        const swapSpy = jest.fn(async () => poller(undefined));
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: [{ name: 'func-one', location: 'uksouth', kind: 'functionapp,linux' }],
                slotsBySite: { 'func-one': [{ name: 'staging' }] },
                swapSlotWithProductionImpl: swapSpy,
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/slot-swap');
        const result = await execute({
            instance: 'azure-prod', resourceGroup: 'rg-funcs', name: 'func-one', sourceSlot: 'staging',
        });

        expect(swapSpy).toHaveBeenCalledWith('rg-funcs', 'func-one', { targetSlot: 'staging', preserveVnet: true });
        expect(result).toMatchObject({ sourceSlot: 'staging', targetSlot: 'production', swapped: true });
    });
});
