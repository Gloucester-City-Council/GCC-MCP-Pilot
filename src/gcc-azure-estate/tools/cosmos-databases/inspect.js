/**
 * Tool: azure_cosmos_database_inspect
 *
 * Throughput mode (shared/dedicated/serverless) and current RU/s (if
 * provisioned at the database level) for a single Cosmos SQL database.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, isServerless, describeThroughputResource } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'databaseName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'inspect');
    const client = getCosmosClient(instance);

    let database;
    try {
        database = await client.sqlResources.getSqlDatabase(args.resourceGroup, args.accountName, args.databaseName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Database "${args.databaseName}" not found in Cosmos account "${args.accountName}" (instance "${instance.name}")`);
        }
        throw err;
    }

    let account;
    try {
        account = await client.databaseAccounts.get(args.resourceGroup, args.accountName);
    } catch (err) {
        if (!isNotFoundError(err)) throw err;
    }

    const accountIsServerless = account ? isServerless(account) : false;

    let throughputMode = 'Dedicated (per-container throughput)';
    let throughputDetail = { throughput: null, maxThroughput: null };

    if (accountIsServerless) {
        throughputMode = 'Serverless';
    } else {
        try {
            const throughputSettings = await client.sqlResources.getSqlDatabaseThroughput(args.resourceGroup, args.accountName, args.databaseName);
            const described = describeThroughputResource((throughputSettings || {}).resource);
            throughputMode = `Shared (${described.mode})`;
            throughputDetail = { throughput: described.throughput, maxThroughput: described.maxThroughput };
        } catch (err) {
            if (!isNotFoundError(err)) throw err;
            // No database-level throughput — containers in this database carry their own (dedicated) throughput.
        }
    }

    const resource = database.resource || {};

    return {
        name: resource.id,
        accountName: args.accountName,
        resourceGroup: args.resourceGroup,
        throughputMode,
        currentThroughput: throughputDetail.throughput,
        currentMaxThroughput: throughputDetail.maxThroughput,
    };
}

module.exports = { execute };
