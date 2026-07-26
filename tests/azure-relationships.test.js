'use strict';

function asyncIterable(items) {
    return { [Symbol.asyncIterator]: async function* () { for (const item of items) yield item; } };
}

describe('Azure Estate relationships (topology + application-stack tools)', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function mockClients({ resourceGroup, resources = [], appSettingsByApp = {} } = {}) {
        jest.doMock('../src/gcc-azure-estate/lib/clients', () => ({
            getResourceClient: () => ({
                resources: { listByResourceGroup: () => asyncIterable(resources) },
            }),
            getWebSiteClient: () => ({
                webApps: {
                    listApplicationSettings: jest.fn(async (rg, name) => ({ properties: appSettingsByApp[name] || {} })),
                },
            }),
        }));
    }

    it('azure_resource_group_topology builds nodes and functionApp->storage / staticWebApp->functionApp edges', async () => {
        const rgName = 'rg-difference-engine';
        mockClients({
            resourceGroup: rgName,
            resources: [
                { name: 'func-app', type: 'Microsoft.Web/sites', kind: 'functionapp,linux', location: 'uksouth' },
                { name: 'web-app', type: 'Microsoft.Web/staticSites', location: 'uksouth' },
                { name: 'storeacct', type: 'Microsoft.Storage/storageAccounts', location: 'uksouth' },
            ],
            appSettingsByApp: { 'func-app': { AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=storeacct;AccountKey=x' } },
        });

        jest.doMock('../src/gcc-azure-estate/tools/function-apps/inspect', () => ({
            execute: jest.fn(async () => ({
                storageDependency: { configured: true, accountName: 'storeacct' },
                applicationInsights: { linked: false },
                managedIdentity: { type: 'SystemAssigned' },
            })),
        }));
        jest.doMock('../src/gcc-azure-estate/tools/static-web-apps/inspect', () => ({
            execute: jest.fn(async () => ({ linkedBackends: [{ name: 'func-app' }] })),
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/relationships/resource-group-topology');
        const result = await execute({ instance: 'azure-prod', resourceGroup: rgName });

        expect(result.nodes).toHaveLength(3);
        expect(result.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ from: 'func-app', to: 'storeacct', kind: 'Microsoft.Storage/storageAccounts' }),
            expect.objectContaining({ from: 'func-app', to: 'func-app', kind: 'ManagedIdentity' }),
            expect.objectContaining({ from: 'web-app', to: 'func-app', kind: 'Microsoft.Web/sites' }),
        ]));
    });

    it('azure_resource_dependencies returns edges for a single named Function App', async () => {
        mockClients({ appSettingsByApp: {} });
        jest.doMock('../src/gcc-azure-estate/tools/function-apps/inspect', () => ({
            execute: jest.fn(async () => ({
                storageDependency: { configured: true, accountName: 'storeacct' },
                applicationInsights: { linked: true },
                managedIdentity: { type: 'None' },
            })),
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/relationships/resource-dependencies');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-a', resourceType: 'functionApp', resourceName: 'func-app' });

        expect(result.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ to: 'storeacct', kind: 'Microsoft.Storage/storageAccounts' }),
            expect.objectContaining({ kind: 'Microsoft.Insights/components' }),
        ]));
    });

    it('azure_resource_dependencies rejects an unknown resourceType', async () => {
        mockClients();
        const { execute } = require('../src/gcc-azure-estate/tools/relationships/resource-dependencies');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ instance: 'azure-prod', resourceGroup: 'rg-a', resourceType: 'cosmosAccount', resourceName: 'x' }))
            .rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
    });

    it('azure_application_stack_diagnose flags a storage-dependency mismatch as a relationship finding', async () => {
        mockClients({ appSettingsByApp: {} });
        jest.doMock('../src/gcc-azure-estate/tools/function-apps/inspect', () => ({
            execute: jest.fn(async () => ({
                storageDependency: { configured: true, accountName: 'wrong-account' },
                applicationInsights: { linked: false },
                managedIdentity: { type: 'None' },
            })),
        }));
        jest.doMock('../src/gcc-azure-estate/tools/function-apps/diagnose', () => ({
            execute: jest.fn(async () => ({ overallStatus: 'PASS', failedChecks: [] })),
        }));
        jest.doMock('../src/gcc-azure-estate/tools/storage-accounts/diagnose', () => ({
            execute: jest.fn(async () => ({ overallStatus: 'PASS', failedChecks: [] })),
        }));
        jest.doMock('../src/gcc-azure-estate/tools/storage-accounts/inspect', () => ({
            execute: jest.fn(async () => ({ name: 'expected-account' })),
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/relationships/application-stack-diagnose');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-a', functionApp: 'func-app', storageAccount: 'expected-account' });

        expect(result.overallStatus).toBe('FINDINGS');
        expect(result.relationshipFindings[0]).toMatch(/wrong-account.*not the declared "expected-account"/);
    });
});
