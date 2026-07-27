'use strict';

function asyncIterable(items) {
    return {
        [Symbol.asyncIterator]: async function* () {
            for (const item of items) yield item;
        },
    };
}

describe('Azure Estate blob-containers family', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function mockStorageClient({
        containers = [],
        getImpl,
        createImpl,
        updateImpl,
        blobServiceProps = null,
        managementPolicy = null,
    } = {}) {
        const get = getImpl || jest.fn(async (rg, account, name) => {
            const found = containers.find((c) => c.name === name);
            if (!found) {
                const err = new Error('not found');
                err.statusCode = 404;
                throw err;
            }
            return found;
        });

        return {
            blobContainers: {
                list: () => asyncIterable(containers),
                get,
                create: createImpl || jest.fn(async (rg, account, name, body) => ({ name, ...body })),
                update: updateImpl || jest.fn(async (rg, account, name, body) => ({ name, ...body })),
            },
            blobServices: {
                list: () => asyncIterable(blobServiceProps ? [blobServiceProps] : []),
            },
            managementPolicies: {
                get: jest.fn(async () => {
                    if (!managementPolicy) {
                        const err = new Error('not found');
                        err.statusCode = 404;
                        throw err;
                    }
                    return managementPolicy;
                }),
            },
        };
    }

    function mockBlobServiceClient({ signedIdentifiers = [], setAccessPolicySpy } = {}) {
        const containerClient = {
            getAccessPolicy: jest.fn(async () => ({ signedIdentifiers })),
            setAccessPolicy: setAccessPolicySpy || jest.fn(async () => ({})),
        };
        return {
            client: { getContainerClient: jest.fn(() => containerClient) },
            containerClient,
        };
    }

    function setupClients({ storageClient, blobServiceClient } = {}) {
        jest.doMock('@azure/arm-storage', () => ({
            StorageManagementClient: jest.fn().mockImplementation(() => storageClient),
        }));
        jest.doMock('@azure/storage-blob', () => ({
            BlobServiceClient: jest.fn().mockImplementation(() => (blobServiceClient || mockBlobServiceClient().client)),
        }));
        jest.doMock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
    }

    it('azure_blob_containers_list returns containers with publicAccess/lastModified/metadata', async () => {
        setupClients({
            storageClient: mockStorageClient({
                containers: [{ name: 'raw', publicAccess: 'None', lastModifiedTime: '2026-01-01T00:00:00Z', metadata: { owner: 'gcc' } }],
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/blob-containers/list');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-one', storageAccount: 'stone' });

        expect(result.totalCount).toBe(1);
        expect(result.containers[0]).toMatchObject({ name: 'raw', publicAccess: 'None', metadataKeys: ['owner'] });
    });

    it('azure_blob_container_inspect returns policy/metadata/lifecycle detail', async () => {
        const { client: blobServiceClient } = mockBlobServiceClient({ signedIdentifiers: [{ id: 'policy-1', accessPolicy: { permissions: 'r' } }] });
        setupClients({
            storageClient: mockStorageClient({
                containers: [{
                    name: 'raw',
                    publicAccess: 'None',
                    lastModifiedTime: '2026-01-01T00:00:00Z',
                    metadata: { owner: 'gcc' },
                    hasLegalHold: false,
                    hasImmutabilityPolicy: false,
                }],
                blobServiceProps: { containerDeleteRetentionPolicy: { enabled: true, days: 7 }, isVersioningEnabled: true },
                managementPolicy: { policy: { rules: [{ name: 'r1', definition: { filter: { prefixMatch: ['raw'] } } }] } },
            }),
            blobServiceClient,
        });

        const { execute } = require('../src/gcc-azure-estate/tools/blob-containers/inspect');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-one', storageAccount: 'stone', name: 'raw' });

        expect(result.publicAccess).toBe('None');
        expect(result.storedAccessPolicyIds).toEqual(['policy-1']);
        expect(result.accountInheritance).toEqual({ containerSoftDelete: { enabled: true, days: 7 }, versioningEnabled: true });
        expect(result.lifecycleRuleCoverage).toEqual({ covered: true, hasAccountPolicy: true });
    });

    it('azure_blob_container_inspect throws NOT_FOUND for a missing container', async () => {
        setupClients({ storageClient: mockStorageClient({ containers: [] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/blob-containers/inspect');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ instance: 'azure-prod', resourceGroup: 'rg-one', storageAccount: 'stone', name: 'missing' }))
            .rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    });

    it('azure_blob_container_diagnose flags public access and missing lifecycle coverage', async () => {
        setupClients({
            storageClient: mockStorageClient({
                containers: [{ name: 'public-raw', publicAccess: 'Container', hasLegalHold: false, hasImmutabilityPolicy: false }],
                blobServiceProps: { containerDeleteRetentionPolicy: { enabled: false }, isVersioningEnabled: false },
                managementPolicy: null,
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/blob-containers/diagnose');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-one', storageAccount: 'stone', name: 'public-raw' });

        expect(result.overallStatus).toBe('FINDINGS');
        expect(result.failedChecks).toEqual(expect.arrayContaining(['publicAccess', 'lifecycleCoverage']));
        expect(result.findings.legalHold.pass).toBe(true);
    });

    it('azure_blob_container_diagnose passes a private, covered container', async () => {
        setupClients({
            storageClient: mockStorageClient({
                containers: [{ name: 'raw', publicAccess: 'None', hasLegalHold: false, hasImmutabilityPolicy: false }],
                blobServiceProps: { containerDeleteRetentionPolicy: { enabled: true, days: 7 }, isVersioningEnabled: true },
                managementPolicy: { policy: { rules: [{ name: 'r1', definition: { filter: { prefixMatch: ['raw'] } } }] } },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/blob-containers/diagnose');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-one', storageAccount: 'stone', name: 'raw' });

        expect(result.overallStatus).toBe('PASS');
        expect(result.failedChecks).toEqual([]);
    });

    it('azure_blob_container_create_plan flags an invalid name', async () => {
        setupClients({ storageClient: mockStorageClient({ containers: [] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/blob-containers/create-plan');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-one', storageAccount: 'stone', name: 'AB' });

        expect(result.validation.pass).toBe(false);
        expect(result.willCreate).toBe(false);
    });

    it('azure_blob_container_create_plan reports no conflicts for a valid, unused name', async () => {
        setupClients({ storageClient: mockStorageClient({ containers: [] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/blob-containers/create-plan');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-one', storageAccount: 'stone', name: 'new-container' });

        expect(result.validation.pass).toBe(true);
        expect(result.conflicts).toEqual([]);
        expect(result.willCreate).toBe(true);
    });

    it('azure_blob_container_create fails with CONFLICT when the container already exists', async () => {
        setupClients({ storageClient: mockStorageClient({ containers: [{ name: 'exists', publicAccess: 'None' }] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/blob-containers/create');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ instance: 'azure-prod', resourceGroup: 'rg-one', storageAccount: 'stone', name: 'exists' }))
            .rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    });

    it('azure_blob_container_policy_plan computes add/change/unchanged for stored access policies and a public-access change', async () => {
        const { client: blobServiceClient } = mockBlobServiceClient({
            signedIdentifiers: [
                { id: 'read-only', accessPolicy: { permissions: 'r' } },
                { id: 'unchanged-policy', accessPolicy: { permissions: 'rw' } },
            ],
        });
        setupClients({
            storageClient: mockStorageClient({ containers: [{ name: 'raw', publicAccess: 'None' }] }),
            blobServiceClient,
        });

        const { execute } = require('../src/gcc-azure-estate/tools/blob-containers/policy-plan');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-one',
            storageAccount: 'stone',
            name: 'raw',
            publicAccess: 'Blob',
            storedAccessPolicies: [
                { id: 'read-only', permissions: 'rwd' },
                { id: 'unchanged-policy', permissions: 'rw' },
                { id: 'brand-new', permissions: 'r' },
            ],
        });

        expect(result.publicAccessPlan).toEqual({ from: 'None', to: 'Blob' });
        expect(result.storedAccessPolicyPlan.toChange['read-only']).toEqual({ from: { permissions: 'r' }, to: { permissions: 'rwd', startsOn: undefined, expiresOn: undefined } });
        expect(result.storedAccessPolicyPlan.toAdd['brand-new']).toBeTruthy();
        expect(result.storedAccessPolicyPlan.unchanged['unchanged-policy']).toBeTruthy();
        expect(result.willChange).toBe(true);
    });

    it('azure_blob_container_policy_apply merges stored access policies and sets public access via the data-plane client', async () => {
        const setAccessPolicySpy = jest.fn(async () => ({}));
        const { client: blobServiceClient } = mockBlobServiceClient({
            signedIdentifiers: [{ id: 'existing-policy', accessPolicy: { permissions: 'r' } }],
            setAccessPolicySpy,
        });
        setupClients({
            storageClient: mockStorageClient({ containers: [{ name: 'raw', publicAccess: 'None' }] }),
            blobServiceClient,
        });

        const { execute } = require('../src/gcc-azure-estate/tools/blob-containers/policy-apply');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-one',
            storageAccount: 'stone',
            name: 'raw',
            publicAccess: 'Container',
            storedAccessPolicies: [{ id: 'new-policy', permissions: 'r' }],
        });

        expect(setAccessPolicySpy).toHaveBeenCalledWith('container', expect.arrayContaining([
            expect.objectContaining({ id: 'existing-policy' }),
            expect.objectContaining({ id: 'new-policy' }),
        ]));
        expect(result.publicAccess).toBe('Container');
        expect(result.storedAccessPolicyIds).toEqual(expect.arrayContaining(['existing-policy', 'new-policy']));
    });

    it('rejects operations when the instance lacks the required permission', async () => {
        setupClients({ storageClient: mockStorageClient({ containers: [] }) });

        const { execute } = require('../src/gcc-azure-estate/tools/blob-containers/create');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        const readOnlyInstance = { name: 'ro', environment: 'production', subscriptionId: 'sub-ro', permissions: { 'blob-containers': ['inspect'] } };

        await expect(execute({ instance: readOnlyInstance, resourceGroup: 'rg-one', storageAccount: 'stone', name: 'new-container' }))
            .rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    });
});
