/**
 * Tool: azure_cosmos_database_throughput_apply
 *
 * Applies a throughput change computed by azure_cosmos_database_throughput_plan.
 * If the requested mode differs from the current mode, migrates first
 * (migrateSqlDatabaseToAutoscale/ToManualThroughput), then sets the
 * requested value via updateSqlDatabaseThroughput.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, buildThroughputResource, describeThroughputResource } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'databaseName', 'throughputModel']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'modify');
    const client = getCosmosClient(instance);

    const built = buildThroughputResource(args.throughputModel);
    if (built.error) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, built.error);
    }
    if (args.throughputModel.mode === 'Serverless') {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'Cannot change throughput to "Serverless" — capacity mode is set at account creation, not per-database.');
    }

    let currentThroughput;
    try {
        currentThroughput = await client.sqlResources.getSqlDatabaseThroughput(args.resourceGroup, args.accountName, args.databaseName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(
                ERROR_CODES.DEPENDENCY_MISSING,
                `Database "${args.databaseName}" has no database-level (shared) throughput to change.`,
                { databaseName: args.databaseName }
            );
        }
        throw err;
    }

    const current = describeThroughputResource((currentThroughput || {}).resource);

    if (current.mode !== args.throughputModel.mode) {
        const migratePoller = args.throughputModel.mode === 'Autoscale'
            ? client.sqlResources.migrateSqlDatabaseToAutoscale(args.resourceGroup, args.accountName, args.databaseName)
            : client.sqlResources.migrateSqlDatabaseToManualThroughput(args.resourceGroup, args.accountName, args.databaseName);
        await migratePoller.pollUntilDone();
    }

    const updatePoller = client.sqlResources.updateSqlDatabaseThroughput(
        args.resourceGroup, args.accountName, args.databaseName,
        { resource: built.resource }
    );
    const result = await updatePoller.pollUntilDone();

    const applied = describeThroughputResource((result || {}).resource);

    return {
        databaseName: args.databaseName,
        migrated: current.mode !== args.throughputModel.mode,
        applied,
    };
}

module.exports = { execute };
