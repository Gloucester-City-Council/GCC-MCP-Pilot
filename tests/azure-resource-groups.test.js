'use strict';

function asyncIterable(items) {
    return {
        [Symbol.asyncIterator]: async function* () {
            for (const item of items) yield item;
        },
    };
}

describe('Azure Estate resource-groups family', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function mockResourceClient({ groups = [], resourcesByGroup = {}, getImpl, createOrUpdateImpl, updateImpl } = {}) {
        const resourceGroupsGet = getImpl || jest.fn(async (name) => {
            const found = groups.find((g) => g.name === name);
            if (!found) {
                const err = new Error('not found');
                err.statusCode = 404;
                throw err;
            }
            return found;
        });

        return {
            resourceGroups: {
                list: () => asyncIterable(groups),
                get: resourceGroupsGet,
                createOrUpdate: createOrUpdateImpl || jest.fn(async (name, body) => ({ name, ...body })),
                update: updateImpl || jest.fn(async (name, body) => ({ name, tags: body.tags })),
            },
            resources: {
                listByResourceGroup: (rgName) => asyncIterable(resourcesByGroup[rgName] || []),
            },
        };
    }

    function setupClients({ resourceClient, webSiteClient, monitorClient } = {}) {
        jest.doMock('@azure/arm-resources', () => ({
            ResourceManagementClient: jest.fn().mockImplementation(() => resourceClient),
        }));
        jest.doMock('@azure/arm-appservice', () => ({
            WebSiteManagementClient: jest.fn().mockImplementation(() => webSiteClient || {
                webApps: { listApplicationSettings: jest.fn(async () => ({ properties: {} })) },
            }),
        }));
        jest.doMock('@azure/arm-monitor', () => ({
            MonitorClient: jest.fn().mockImplementation(() => monitorClient || {
                diagnosticSettings: { list: () => asyncIterable([]) },
            }),
        }));
        jest.doMock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
    }

    it('azure_resource_groups_list returns groups with location/tags/provisioningState', async () => {
        setupClients({
            resourceClient: mockResourceClient({
                groups: [{ name: 'rg-one', location: 'uksouth', tags: { environment: 'production' }, properties: { provisioningState: 'Succeeded' } }],
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/resource-groups/list');
        const result = await execute({ instance: 'azure-prod' });

        expect(result.totalCount).toBe(1);
        expect(result.resourceGroups[0]).toMatchObject({ name: 'rg-one', location: 'uksouth', provisioningState: 'Succeeded' });
    });

    it('azure_resource_group_inspect throws NOT_FOUND for a missing resource group', async () => {
        setupClients({ resourceClient: mockResourceClient({ groups: [] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/resource-groups/inspect');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ instance: 'azure-prod', resourceGroup: 'rg-missing' }))
            .rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    });

    it('azure_resource_group_inventory flags a cosmos account with no referencing Function App as orphaned', async () => {
        const rgName = 'rg-difference-engine';
        setupClients({
            resourceClient: mockResourceClient({
                groups: [{ name: rgName, location: 'uksouth', tags: {} }],
                resourcesByGroup: {
                    [rgName]: [
                        { id: `/rg/${rgName}/func`, name: 'func-app', type: 'Microsoft.Web/sites', kind: 'functionapp,linux', location: 'uksouth', tags: {} },
                        { id: `/rg/${rgName}/store`, name: 'referencedstore', type: 'Microsoft.Storage/storageAccounts', location: 'uksouth', tags: {} },
                        { id: `/rg/${rgName}/cosmos`, name: 'orphancosmos', type: 'Microsoft.DocumentDB/databaseAccounts', location: 'uksouth', tags: {} },
                    ],
                },
            }),
            webSiteClient: {
                webApps: {
                    listApplicationSettings: jest.fn(async () => ({
                        properties: { AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=referencedstore;AccountKey=xxx' },
                    })),
                },
            },
        });

        const { execute } = require('../src/gcc-azure-estate/tools/resource-groups/inventory');
        const result = await execute({ instance: 'azure-prod', resourceGroup: rgName });

        expect(result.resourceCount).toBe(3);
        expect(result.orphanedResources).toHaveLength(1);
        expect(result.orphanedResources[0].name).toBe('orphancosmos');
        expect(result.summary.byType['Microsoft.Web/sites']).toBe(1);
    });

    it('azure_resource_group_diagnose flags missing required tags and non-matching naming convention', async () => {
        const rgName = 'not-following-convention';
        setupClients({
            resourceClient: mockResourceClient({
                groups: [{ name: rgName, location: 'uksouth', tags: {} }],
                resourcesByGroup: { [rgName]: [] },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/resource-groups/diagnose');
        const result = await execute({ instance: 'azure-prod', resourceGroup: rgName });

        expect(result.overallStatus).toBe('FINDINGS');
        expect(result.failedChecks).toEqual(expect.arrayContaining(['requiredTags', 'namingConvention']));
        expect(result.findings.policyCompliance.available).toBe(false);
    });

    it('azure_resource_group_create fails with CONFLICT when the group already exists', async () => {
        setupClients({
            resourceClient: mockResourceClient({
                groups: [{ name: 'rg-exists', location: 'uksouth', tags: {} }],
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/resource-groups/create');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ instance: 'azure-prod', name: 'rg-exists', location: 'uksouth' }))
            .rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    });

    it('azure_resource_group_tags_plan computes add/change/unchanged without writing', async () => {
        const updateSpy = jest.fn();
        setupClients({
            resourceClient: mockResourceClient({
                groups: [{ name: 'rg-tags', location: 'uksouth', tags: { environment: 'production', owner: 'gcc' } }],
                updateImpl: updateSpy,
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/resource-groups/tags-plan');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-tags',
            tags: { environment: 'staging', owner: 'gcc', costCentre: 'X123' },
        });

        expect(result.plan.toChange).toEqual({ environment: { from: 'production', to: 'staging' } });
        expect(result.plan.toAdd).toEqual({ costCentre: 'X123' });
        expect(result.plan.unchanged).toEqual({ owner: 'gcc' });
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('azure_resource_group_tags_apply merges tags via resourceGroups.update', async () => {
        const updateSpy = jest.fn(async (name, body) => ({ name, tags: body.tags }));
        setupClients({
            resourceClient: mockResourceClient({
                groups: [{ name: 'rg-tags', location: 'uksouth', tags: { environment: 'production' } }],
                updateImpl: updateSpy,
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/resource-groups/tags-apply');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-tags', tags: { owner: 'gcc' } });

        expect(updateSpy).toHaveBeenCalledWith('rg-tags', { tags: { environment: 'production', owner: 'gcc' } });
        expect(result.tags).toEqual({ environment: 'production', owner: 'gcc' });
    });

    it('azure_resource_group_compare flags resources present only on one side', async () => {
        // Clients are cached per subscriptionId (lib/clients.js), so the two
        // sides need distinct subscriptionIds to get distinct mock clients —
        // pass fully-resolved instance objects rather than registry names
        // (assertPermitted accepts either).
        jest.doMock('@azure/arm-resources', () => {
            const bySubscription = {
                'sub-a': mockResourceClient({
                    groups: [{ name: 'rg-a', location: 'uksouth', tags: {} }],
                    resourcesByGroup: { 'rg-a': [{ id: '1', name: 'shared', type: 'Microsoft.Storage/storageAccounts', location: 'uksouth', tags: {} }, { id: '2', name: 'only-a', type: 'Microsoft.Storage/storageAccounts', location: 'uksouth', tags: {} }] },
                }),
                'sub-b': mockResourceClient({
                    groups: [{ name: 'rg-b', location: 'ukwest', tags: {} }],
                    resourcesByGroup: { 'rg-b': [{ id: '1', name: 'shared', type: 'Microsoft.Storage/storageAccounts', location: 'ukwest', tags: {} }] },
                }),
            };
            return {
                ResourceManagementClient: jest.fn().mockImplementation((_cred, subscriptionId) => bySubscription[subscriptionId]),
            };
        });
        jest.doMock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));

        const permissions = { 'resource-groups': ['inspect', 'diagnose', 'compare', 'plan', 'create', 'modify'] };
        const instanceA = { name: 'side-a', environment: 'production', subscriptionId: 'sub-a', permissions };
        const instanceB = { name: 'side-b', environment: 'production', subscriptionId: 'sub-b', permissions };

        const { execute } = require('../src/gcc-azure-estate/tools/resource-groups/compare');
        const result = await execute({
            left: { instance: instanceA, resourceGroup: 'rg-a' },
            right: { instance: instanceB, resourceGroup: 'rg-b' },
        });

        expect(result.resourcesOnlyInLeft).toEqual([{ type: 'Microsoft.Storage/storageAccounts', name: 'only-a' }]);
        expect(result.resourcesOnlyInRight).toEqual([]);
        expect(result.identical).toBe(false);
        expect(result.locationDrift).toEqual({ left: 'uksouth', right: 'ukwest' });
    });
});
