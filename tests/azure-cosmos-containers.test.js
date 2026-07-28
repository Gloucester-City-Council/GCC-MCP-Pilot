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

function notFound() {
    const err = new Error('not found');
    err.statusCode = 404;
    return err;
}

const VALID_INDEXING_POLICY = {
    automatic: true,
    indexingMode: 'consistent',
    includedPaths: [{ path: '/*' }],
    excludedPaths: [],
};

describe('Azure Estate cosmos-containers family', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function mockCosmosClient({
        containers = [],
        throughputByContainer = {},
        getSqlContainerImpl,
        getSqlContainerThroughputImpl,
        createUpdateSqlContainerImpl,
        updateSqlContainerThroughputImpl,
        migrateToAutoscaleImpl,
        migrateToManualImpl,
        // Every create/create_plan test in this file targets an existing,
        // provisioned (non-serverless) account and database by default —
        // override these to test the dependency-missing / serverless-
        // mismatch paths specifically.
        accountExists = true,
        accountIsServerless = false,
        databaseExists = true,
        getDatabaseAccountImpl,
        getSqlDatabaseImpl,
    } = {}) {
        const getSqlContainer = getSqlContainerImpl || jest.fn(async (rg, acct, db, containerName) => {
            const found = containers.find((c) => (c.resource || {}).id === containerName);
            if (!found) throw notFound();
            return found;
        });

        const getSqlContainerThroughput = getSqlContainerThroughputImpl || jest.fn(async (rg, acct, db, containerName) => {
            if (!(containerName in throughputByContainer)) throw notFound();
            return { resource: throughputByContainer[containerName] };
        });

        const getDatabaseAccount = getDatabaseAccountImpl || jest.fn(async () => {
            if (!accountExists) throw notFound();
            return accountIsServerless ? { capabilities: [{ name: 'EnableServerless' }] } : { capabilities: [] };
        });

        const getSqlDatabase = getSqlDatabaseImpl || jest.fn(async () => {
            if (!databaseExists) throw notFound();
            return { resource: { id: 'orders' } };
        });

        return {
            databaseAccounts: { get: getDatabaseAccount },
            sqlResources: {
                listSqlContainers: () => asyncIterable(containers),
                getSqlContainer,
                getSqlDatabase,
                createUpdateSqlContainer: createUpdateSqlContainerImpl || jest.fn((rg, acct, db, containerName, body) => poller({ resource: { id: containerName, ...body.resource } })),
                getSqlContainerThroughput,
                updateSqlContainerThroughput: updateSqlContainerThroughputImpl || jest.fn((rg, acct, db, containerName, body) => poller({ resource: body.resource })),
                migrateSqlContainerToAutoscale: migrateToAutoscaleImpl || jest.fn(() => poller({ resource: { autoscaleSettings: { maxThroughput: 4000 } } })),
                migrateSqlContainerToManualThroughput: migrateToManualImpl || jest.fn(() => poller({ resource: { throughput: 400 } })),
            },
        };
    }

    function setupClients(cosmosClient) {
        jest.doMock('@azure/arm-cosmosdb', () => ({
            CosmosDBManagementClient: jest.fn().mockImplementation(() => cosmosClient),
        }));
        jest.doMock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
    }

    const BASE_ARGS = { instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod', databaseName: 'orders' };

    it('azure_cosmos_containers_list returns containers with partition key info', async () => {
        setupClients(mockCosmosClient({
            containers: [{ resource: { id: 'orderItems', partitionKey: { paths: ['/tenantId'], kind: 'Hash', version: 2 }, defaultTtl: 86400 } }],
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/list');
        const result = await execute({ ...BASE_ARGS });

        expect(result.totalCount).toBe(1);
        expect(result.containers[0]).toMatchObject({ name: 'orderItems', partitionKeyPaths: ['/tenantId'], partitionKeyVersion: 2, defaultTtl: 86400 });
    });

    it('azure_cosmos_container_inspect returns partition key, indexing, unique key, TTL, and throughput', async () => {
        setupClients(mockCosmosClient({
            containers: [{
                resource: {
                    id: 'orderItems',
                    partitionKey: { paths: ['/tenantId'], kind: 'Hash', version: 2 },
                    indexingPolicy: VALID_INDEXING_POLICY,
                    uniqueKeyPolicy: { uniqueKeys: [{ paths: ['/sku'] }] },
                    defaultTtl: 86400,
                    analyticalStorageTtl: -1,
                },
            }],
            throughputByContainer: { orderItems: { throughput: 400 } },
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/inspect');
        const result = await execute({ ...BASE_ARGS, containerName: 'orderItems' });

        expect(result.partitionKey).toEqual({ paths: ['/tenantId'], kind: 'Hash', version: 2 });
        expect(result.uniqueKeyPolicy.uniqueKeys).toEqual([{ paths: ['/sku'] }]);
        expect(result.defaultTtl).toBe(86400);
        expect(result.analyticalStore.enabled).toBe(true);
        expect(result.throughput).toEqual({ mode: 'Manual', throughput: 400, maxThroughput: null });
    });

    it('azure_cosmos_container_inspect throws NOT_FOUND for a missing container', async () => {
        setupClients(mockCosmosClient({ containers: [] }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/inspect');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ ...BASE_ARGS, containerName: 'missing' }))
            .rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    });

    it('azure_cosmos_container_diagnose flags a missing TTL on an audit-log-named container as informational', async () => {
        setupClients(mockCosmosClient({
            containers: [{ resource: { id: 'auditLogEvents', partitionKey: { paths: ['/id'] }, indexingPolicy: VALID_INDEXING_POLICY, defaultTtl: null } }],
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/diagnose');
        const result = await execute({ ...BASE_ARGS, containerName: 'auditLogEvents' });

        expect(result.findings.noTtlOnAuditLikeContainer.pass).toBe(false);
        expect(result.findings.noTtlOnAuditLikeContainer.applicable).toBe(true);
        expect(result.overallStatus).toBe('FINDINGS');
    });

    it('azure_cosmos_container_diagnose does not flag missing unique key policy and does not flag TTL on a non-audit container', async () => {
        setupClients(mockCosmosClient({
            containers: [{ resource: { id: 'orderItems', partitionKey: { paths: ['/tenantId'] }, indexingPolicy: VALID_INDEXING_POLICY, defaultTtl: null } }],
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/diagnose');
        const result = await execute({ ...BASE_ARGS, containerName: 'orderItems' });

        expect(result.findings.uniqueKeyPolicy).toBeUndefined();
        expect(result.findings.noTtlOnAuditLikeContainer.pass).toBe(true);
        expect(result.findings.noTtlOnAuditLikeContainer.applicable).toBe(false);
        expect(result.overallStatus).toBe('PASS');
    });

    it('azure_cosmos_container_diagnose flags "index everything" only at high provisioned scale', async () => {
        setupClients(mockCosmosClient({
            containers: [{ resource: { id: 'events', partitionKey: { paths: ['/id'] }, indexingPolicy: VALID_INDEXING_POLICY, defaultTtl: 3600 } }],
            throughputByContainer: { events: { throughput: 20000 } },
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/diagnose');
        const result = await execute({ ...BASE_ARGS, containerName: 'events' });

        expect(result.findings.indexEverythingOnHighScale.pass).toBe(false);
        expect(result.findings.indexEverythingOnHighScale.applicable).toBe(true);
    });

    it('azure_cosmos_container_create_plan rejects when partitionKey is missing', async () => {
        setupClients(mockCosmosClient({ containers: [] }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/create-plan');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            ...BASE_ARGS,
            containerName: 'newContainer',
            throughputModel: { mode: 'Manual', throughput: 400 },
            indexingPolicy: VALID_INDEXING_POLICY,
            uniqueKeyPolicy: { uniqueKeys: [] },
            defaultTtl: null,
            analyticalStore: { enabled: false },
            // partitionKey intentionally omitted
        })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
    });

    it('azure_cosmos_container_create_plan surfaces PARTITION_KEY_IMMUTABLE as a blocker without throwing (dry-run)', async () => {
        setupClients(mockCosmosClient({
            containers: [{ resource: { id: 'orderItems', partitionKey: { paths: ['/tenantId'], kind: 'Hash', version: 2 } } }],
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/create-plan');
        const result = await execute({
            ...BASE_ARGS,
            containerName: 'orderItems',
            partitionKey: { paths: ['/customerId'], kind: 'Hash', version: 2 },
            throughputModel: { mode: 'Manual', throughput: 400 },
            indexingPolicy: VALID_INDEXING_POLICY,
            uniqueKeyPolicy: { uniqueKeys: [] },
            defaultTtl: null,
            analyticalStore: { enabled: false },
        });

        expect(result.canApply).toBe(false);
        expect(result.blockers).toContain('partitionKeyImmutable');
        expect(result.partitionKeyImmutabilityViolation).toEqual({
            existing: { paths: ['/tenantId'], kind: 'Hash', version: 2 },
            requested: { paths: ['/customerId'], kind: 'Hash', version: 2 },
        });
    });

    // --- THE most important test in this assignment ---
    it('azure_cosmos_container_create throws AzureEstateError PARTITION_KEY_IMMUTABLE when an existing container has a different partition key', async () => {
        setupClients(mockCosmosClient({
            containers: [{ resource: { id: 'orderItems', partitionKey: { paths: ['/tenantId'], kind: 'Hash', version: 2 } } }],
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/create');
        const { AzureEstateError, ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        const call = execute({
            ...BASE_ARGS,
            containerName: 'orderItems',
            partitionKey: { paths: ['/customerId'], kind: 'Hash', version: 2 }, // different from existing "/tenantId"
            throughputModel: { mode: 'Manual', throughput: 400 },
            indexingPolicy: VALID_INDEXING_POLICY,
            uniqueKeyPolicy: { uniqueKeys: [] },
            defaultTtl: null,
            analyticalStore: { enabled: false },
        });

        await expect(call).rejects.toBeInstanceOf(AzureEstateError);
        await expect(call).rejects.toMatchObject({
            code: ERROR_CODES.PARTITION_KEY_IMMUTABLE,
            details: {
                existingPartitionKey: { paths: ['/tenantId'], kind: 'Hash', version: 2 },
                requestedPartitionKey: { paths: ['/customerId'], kind: 'Hash', version: 2 },
            },
        });
    });

    it('azure_cosmos_container_create succeeds (no immutability error) when the requested partition key matches the existing one exactly', async () => {
        const createSpy = jest.fn((rg, acct, db, containerName, body) => poller({ resource: { id: containerName, ...body.resource } }));
        setupClients(mockCosmosClient({
            containers: [{ resource: { id: 'orderItems', partitionKey: { paths: ['/tenantId'], kind: 'Hash', version: 2 } } }],
            createUpdateSqlContainerImpl: createSpy,
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/create');
        const result = await execute({
            ...BASE_ARGS,
            containerName: 'orderItems',
            partitionKey: { paths: ['/tenantId'], kind: 'Hash', version: 2 }, // identical
            throughputModel: { mode: 'Manual', throughput: 400 },
            indexingPolicy: VALID_INDEXING_POLICY,
            uniqueKeyPolicy: { uniqueKeys: [] },
            defaultTtl: null,
            analyticalStore: { enabled: false },
        });

        expect(result.updated).toBe(true);
        expect(createSpy).toHaveBeenCalled();
    });

    it('azure_cosmos_container_create creates a brand-new container with the requested partition key', async () => {
        const createSpy = jest.fn((rg, acct, db, containerName, body) => poller({ resource: { id: containerName, ...body.resource } }));
        setupClients(mockCosmosClient({ containers: [], createUpdateSqlContainerImpl: createSpy }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/create');
        const result = await execute({
            ...BASE_ARGS,
            containerName: 'newContainer',
            partitionKey: { paths: ['/id'], kind: 'Hash', version: 2 },
            throughputModel: { mode: 'Autoscale', maxThroughput: 4000 },
            indexingPolicy: VALID_INDEXING_POLICY,
            uniqueKeyPolicy: { uniqueKeys: [] },
            defaultTtl: null,
            analyticalStore: { enabled: true, ttl: -1 },
        });

        expect(result.created).toBe(true);
        expect(createSpy).toHaveBeenCalledWith('rg-cosmos', 'gcc-cosmos-prod', 'orders', 'newContainer', {
            resource: {
                id: 'newContainer',
                partitionKey: { paths: ['/id'], kind: 'Hash', version: 2 },
                indexingPolicy: VALID_INDEXING_POLICY,
                uniqueKeyPolicy: { uniqueKeys: [] },
                defaultTtl: null,
                analyticalStorageTtl: -1,
            },
            options: { autoscaleSettings: { maxThroughput: 4000 } },
        });
    });

    it('azure_cosmos_container_create fails fast with DEPENDENCY_MISSING when the database does not exist, instead of reaching Azure as a slow async operation', async () => {
        setupClients(mockCosmosClient({ containers: [], databaseExists: false, accountIsServerless: true }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/create');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            ...BASE_ARGS,
            containerName: 'worlds',
            partitionKey: { paths: ['/worldId'], kind: 'Hash' },
            throughputModel: { mode: 'Serverless' },
            indexingPolicy: VALID_INDEXING_POLICY,
            uniqueKeyPolicy: { uniqueKeys: [] },
            defaultTtl: null,
            analyticalStore: { enabled: false },
        })).rejects.toMatchObject({ code: ERROR_CODES.DEPENDENCY_MISSING, details: { missingDependency: 'database' } });
    });

    it('azure_cosmos_container_create fails fast with DEPENDENCY_MISSING when the account does not exist', async () => {
        setupClients(mockCosmosClient({ containers: [], accountExists: false }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/create');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            ...BASE_ARGS,
            containerName: 'worlds',
            partitionKey: { paths: ['/worldId'], kind: 'Hash' },
            throughputModel: { mode: 'Serverless' },
            indexingPolicy: VALID_INDEXING_POLICY,
            uniqueKeyPolicy: { uniqueKeys: [] },
            defaultTtl: null,
            analyticalStore: { enabled: false },
        })).rejects.toMatchObject({ code: ERROR_CODES.DEPENDENCY_MISSING, details: { missingDependency: 'account' } });
    });

    it('azure_cosmos_container_create rejects a Serverless throughputModel against a provisioned (non-serverless) account', async () => {
        setupClients(mockCosmosClient({ containers: [], accountIsServerless: false }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/create');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            ...BASE_ARGS,
            containerName: 'worlds',
            partitionKey: { paths: ['/worldId'], kind: 'Hash' },
            throughputModel: { mode: 'Serverless' },
            indexingPolicy: VALID_INDEXING_POLICY,
            uniqueKeyPolicy: { uniqueKeys: [] },
            defaultTtl: null,
            analyticalStore: { enabled: false },
        })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
    });

    it('azure_cosmos_container_create_plan reports account/database-missing and throughput-mismatch as blockers rather than throwing', async () => {
        setupClients(mockCosmosClient({ containers: [], accountExists: false }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/create-plan');
        const result = await execute({
            ...BASE_ARGS,
            containerName: 'worlds',
            partitionKey: { paths: ['/worldId'], kind: 'Hash' },
            throughputModel: { mode: 'Serverless' },
            indexingPolicy: VALID_INDEXING_POLICY,
            uniqueKeyPolicy: { uniqueKeys: [] },
            defaultTtl: null,
            analyticalStore: { enabled: false },
        });

        expect(result.canApply).toBe(false);
        expect(result.blockers).toContain('account');
        expect(result.dependencies.account.satisfied).toBe(false);
    });

    it('azure_cosmos_container_throughput_plan reports DEPENDENCY_MISSING when there is no container-level throughput', async () => {
        setupClients(mockCosmosClient({
            containers: [{ resource: { id: 'orderItems', partitionKey: { paths: ['/tenantId'] } } }],
            throughputByContainer: {},
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/throughput-plan');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ ...BASE_ARGS, containerName: 'orderItems', throughputModel: { mode: 'Manual', throughput: 1000 } }))
            .rejects.toMatchObject({ code: ERROR_CODES.DEPENDENCY_MISSING });
    });

    it('azure_cosmos_container_throughput_apply updates throughput without migrating when the mode is unchanged', async () => {
        const migrateToManual = jest.fn();
        const updateThroughput = jest.fn((rg, acct, db, containerName, body) => poller({ resource: body.resource }));
        setupClients(mockCosmosClient({
            containers: [{ resource: { id: 'orderItems', partitionKey: { paths: ['/tenantId'] } } }],
            throughputByContainer: { orderItems: { throughput: 400 } },
            migrateToManualImpl: migrateToManual,
            updateSqlContainerThroughputImpl: updateThroughput,
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/throughput-apply');
        const result = await execute({ ...BASE_ARGS, containerName: 'orderItems', throughputModel: { mode: 'Manual', throughput: 1000 } });

        expect(migrateToManual).not.toHaveBeenCalled();
        expect(updateThroughput).toHaveBeenCalledWith('rg-cosmos', 'gcc-cosmos-prod', 'orders', 'orderItems', { resource: { throughput: 1000 } });
        expect(result.migrated).toBe(false);
        expect(result.applied.throughput).toBe(1000);
    });

    it('azure_cosmos_container_indexing_plan diffs requested vs current indexing policy and preserves the partition key', async () => {
        setupClients(mockCosmosClient({
            containers: [{ resource: { id: 'orderItems', partitionKey: { paths: ['/tenantId'] }, indexingPolicy: VALID_INDEXING_POLICY } }],
        }));

        const newPolicy = { automatic: true, indexingMode: 'consistent', includedPaths: [{ path: '/tenantId/?' }], excludedPaths: [{ path: '/*' }] };
        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/indexing-plan');
        const result = await execute({ ...BASE_ARGS, containerName: 'orderItems', indexingPolicy: newPolicy });

        expect(result.willChange).toBe(true);
        expect(result.partitionKeyPreserved).toEqual({ paths: ['/tenantId'] });
    });

    it('azure_cosmos_container_indexing_apply preserves the partition key while changing the indexing policy', async () => {
        const createSpy = jest.fn((rg, acct, db, containerName, body) => poller({ resource: { id: containerName, ...body.resource } }));
        setupClients(mockCosmosClient({
            containers: [{
                resource: {
                    id: 'orderItems',
                    partitionKey: { paths: ['/tenantId'], kind: 'Hash', version: 2 },
                    indexingPolicy: VALID_INDEXING_POLICY,
                    uniqueKeyPolicy: { uniqueKeys: [] },
                    defaultTtl: null,
                },
            }],
            createUpdateSqlContainerImpl: createSpy,
        }));

        const newPolicy = { automatic: true, indexingMode: 'consistent', includedPaths: [{ path: '/tenantId/?' }], excludedPaths: [{ path: '/*' }] };
        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-containers/indexing-apply');
        const result = await execute({ ...BASE_ARGS, containerName: 'orderItems', indexingPolicy: newPolicy });

        expect(result.partitionKeyUnchanged).toBe(true);
        expect(createSpy).toHaveBeenCalledWith('rg-cosmos', 'gcc-cosmos-prod', 'orders', 'orderItems', {
            resource: {
                id: 'orderItems',
                partitionKey: { paths: ['/tenantId'], kind: 'Hash', version: 2 },
                uniqueKeyPolicy: { uniqueKeys: [] },
                defaultTtl: null,
                indexingPolicy: newPolicy,
            },
        });
    });
});
