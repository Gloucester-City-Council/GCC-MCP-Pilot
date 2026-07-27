/**
 * Tool: azure_cosmos_database_throughput_plan
 *
 * Dry-run for azure_cosmos_database_throughput_apply. Diffs the requested
 * throughputModel against the database's current shared throughput
 * setting. DEPENDENCY_MISSING if the database has no database-level
 * throughput to change (serverless account, or per-container/dedicated
 * throughput only).
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, buildThroughputResource, describeThroughputResource } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'databaseName', 'throughputModel']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'plan');
    const client = getCosmosClient(instance);

    const built = buildThroughputResource(args.throughputModel);
    if (built.error) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, built.error);
    }
    if (args.throughputModel.mode === 'Serverless') {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'Cannot plan a throughput change to "Serverless" — capacity mode is set at account creation, not per-database.');
    }

    let currentThroughput;
    try {
        currentThroughput = await client.sqlResources.getSqlDatabaseThroughput(args.resourceGroup, args.accountName, args.databaseName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(
                ERROR_CODES.DEPENDENCY_MISSING,
                `Database "${args.databaseName}" has no database-level (shared) throughput to change — it is either serverless or uses dedicated per-container throughput.`,
                { databaseName: args.databaseName }
            );
        }
        throw err;
    }

    const current = describeThroughputResource((currentThroughput || {}).resource);
    const requiresMigration = current.mode !== args.throughputModel.mode;

    return {
        databaseName: args.databaseName,
        current,
        requested: { mode: args.throughputModel.mode, throughput: args.throughputModel.throughput ?? null, maxThroughput: args.throughputModel.maxThroughput ?? null },
        requiresMigration,
        willChange: requiresMigration
            || current.throughput !== (args.throughputModel.throughput ?? null)
            || current.maxThroughput !== (args.throughputModel.maxThroughput ?? null),
        requiredPermission: { resourceFamily: 'cosmos', operationClass: 'modify' },
    };
}

module.exports = { execute };
