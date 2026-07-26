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

describe('Azure Estate cosmos-databases family', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    const ACCOUNT = { name: 'gcc-cosmos-prod', capabilities: [] };
    const SERVERLESS_ACCOUNT = { name: 'gcc-cosmos-serverless', capabilities: [{ name: 'EnableServerless' }] };

    function mockCosmosClient({
        account = ACCOUNT,
        databases = [],
        throughputByDb = {},
        getSqlDatabaseImpl,
        getSqlDatabaseThroughputImpl,
        createUpdateSqlDatabaseImpl,
        updateSqlDatabaseThroughputImpl,
        migrateToAutoscaleImpl,
        migrateToManualImpl,
    } = {}) {
        const getSqlDatabase = getSqlDatabaseImpl || jest.fn(async (rg, acct, dbName) => {
            const found = databases.find((d) => (d.resource || {}).id === dbName);
            if (!found) throw notFound();
            return found;
        });

        const getSqlDatabaseThroughput = getSqlDatabaseThroughputImpl || jest.fn(async (rg, acct, dbName) => {
            if (!(dbName in throughputByDb)) throw notFound();
            return { resource: throughputByDb[dbName] };
        });

        return {
            databaseAccounts: {
                get: jest.fn(async () => account),
            },
            sqlResources: {
                listSqlDatabases: () => asyncIterable(databases),
                getSqlDatabase,
                createUpdateSqlDatabase: createUpdateSqlDatabaseImpl || jest.fn((rg, acct, dbName, body) => poller({ resource: { id: dbName, ...body.resource } })),
                getSqlDatabaseThroughput,
                updateSqlDatabaseThroughput: updateSqlDatabaseThroughputImpl || jest.fn((rg, acct, dbName, body) => poller({ resource: body.resource })),
                migrateSqlDatabaseToAutoscale: migrateToAutoscaleImpl || jest.fn(() => poller({ resource: { autoscaleSettings: { maxThroughput: 4000 } } })),
                migrateSqlDatabaseToManualThroughput: migrateToManualImpl || jest.fn(() => poller({ resource: { throughput: 400 } })),
            },
        };
    }

    function setupClients(cosmosClient) {
        jest.doMock('@azure/arm-cosmosdb', () => ({
            CosmosDBManagementClient: jest.fn().mockImplementation(() => cosmosClient),
        }));
        jest.doMock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
    }

    it('azure_cosmos_databases_list returns databases with throughput mode', async () => {
        setupClients(mockCosmosClient({
            databases: [{ resource: { id: 'orders' }, options: { throughput: 400 } }],
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-databases/list');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod' });

        expect(result.totalCount).toBe(1);
        expect(result.databases[0]).toMatchObject({ name: 'orders', throughputMode: 'Manual', throughput: 400 });
    });

    it('azure_cosmos_database_inspect reports Serverless mode for a serverless account', async () => {
        setupClients(mockCosmosClient({
            account: SERVERLESS_ACCOUNT,
            databases: [{ resource: { id: 'orders' } }],
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-databases/inspect');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-serverless', databaseName: 'orders' });

        expect(result.throughputMode).toBe('Serverless');
        expect(result.currentThroughput).toBeNull();
    });

    it('azure_cosmos_database_inspect reports Shared (Autoscale) mode with maxThroughput when DB-level throughput exists', async () => {
        setupClients(mockCosmosClient({
            databases: [{ resource: { id: 'orders' } }],
            throughputByDb: { orders: { autoscaleSettings: { maxThroughput: 4000 } } },
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-databases/inspect');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod', databaseName: 'orders' });

        expect(result.throughputMode).toBe('Shared (Autoscale)');
        expect(result.currentMaxThroughput).toBe(4000);
    });

    it('azure_cosmos_database_inspect throws NOT_FOUND for a missing database', async () => {
        setupClients(mockCosmosClient({ databases: [] }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-databases/inspect');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod', databaseName: 'missing' }))
            .rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    });

    it('azure_cosmos_database_create_plan rejects an invalid throughputModel', async () => {
        setupClients(mockCosmosClient({ databases: [] }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-databases/create-plan');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod', databaseName: 'newdb',
            throughputModel: { mode: 'Autoscale' }, // missing maxThroughput
        })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
    });

    it('azure_cosmos_database_create_plan rejects a Serverless throughputModel against a provisioned account', async () => {
        setupClients(mockCosmosClient({ databases: [] }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-databases/create-plan');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod', databaseName: 'newdb',
            throughputModel: { mode: 'Serverless' },
        })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
    });

    it('azure_cosmos_database_create creates a database with autoscale throughput', async () => {
        const createSpy = jest.fn((rg, acct, dbName, body) => poller({ resource: { id: dbName, ...body.resource } }));
        setupClients(mockCosmosClient({ databases: [], createUpdateSqlDatabaseImpl: createSpy }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-databases/create');
        const result = await execute({
            instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod', databaseName: 'newdb',
            throughputModel: { mode: 'Autoscale', maxThroughput: 4000 },
        });

        expect(result.created).toBe(true);
        expect(createSpy).toHaveBeenCalledWith('rg-cosmos', 'gcc-cosmos-prod', 'newdb', {
            resource: { id: 'newdb' },
            options: { autoscaleSettings: { maxThroughput: 4000 } },
        });
    });

    it('azure_cosmos_database_create fails with CONFLICT if the database already exists', async () => {
        setupClients(mockCosmosClient({ databases: [{ resource: { id: 'orders' } }] }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-databases/create');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod', databaseName: 'orders',
            throughputModel: { mode: 'Manual', throughput: 400 },
        })).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    });

    it('azure_cosmos_database_throughput_plan reports DEPENDENCY_MISSING when there is no DB-level throughput', async () => {
        setupClients(mockCosmosClient({ databases: [{ resource: { id: 'orders' } }], throughputByDb: {} }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-databases/throughput-plan');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({
            instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod', databaseName: 'orders',
            throughputModel: { mode: 'Manual', throughput: 1000 },
        })).rejects.toMatchObject({ code: ERROR_CODES.DEPENDENCY_MISSING });
    });

    it('azure_cosmos_database_throughput_apply migrates mode then applies the new value', async () => {
        const migrateToAutoscale = jest.fn(() => poller({ resource: { autoscaleSettings: { maxThroughput: 4000 } } }));
        const updateThroughput = jest.fn((rg, acct, dbName, body) => poller({ resource: body.resource }));
        setupClients(mockCosmosClient({
            databases: [{ resource: { id: 'orders' } }],
            throughputByDb: { orders: { throughput: 400 } },
            migrateToAutoscaleImpl: migrateToAutoscale,
            updateSqlDatabaseThroughputImpl: updateThroughput,
        }));

        const { execute } = require('../src/gcc-azure-estate/tools/cosmos-databases/throughput-apply');
        const result = await execute({
            instance: 'azure-prod', resourceGroup: 'rg-cosmos', accountName: 'gcc-cosmos-prod', databaseName: 'orders',
            throughputModel: { mode: 'Autoscale', maxThroughput: 5000 },
        });

        expect(migrateToAutoscale).toHaveBeenCalled();
        expect(updateThroughput).toHaveBeenCalledWith('rg-cosmos', 'gcc-cosmos-prod', 'orders', { resource: { autoscaleSettings: { maxThroughput: 5000 } } });
        expect(result.migrated).toBe(true);
        expect(result.applied.maxThroughput).toBe(5000);
    });
});
