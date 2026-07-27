/**
 * Tool: azure_cosmos_database_create
 *
 * Creates a Cosmos SQL database. throughputModel is required — never
 * defaulted. Fails with DEPENDENCY_MISSING if the account doesn't exist,
 * BAD_REQUEST on a throughputModel/account capacity-mode mismatch, and
 * CONFLICT if the database already exists.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, isServerless, buildThroughputResource } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'databaseName', 'throughputModel']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'create');
    const client = getCosmosClient(instance);

    const built = buildThroughputResource(args.throughputModel);
    if (built.error) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, built.error);
    }

    let account;
    try {
        account = await client.databaseAccounts.get(args.resourceGroup, args.accountName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(
                ERROR_CODES.DEPENDENCY_MISSING,
                `Cosmos DB account "${args.accountName}" does not exist in resource group "${args.resourceGroup}" (instance "${instance.name}") — create it first.`,
                { missingDependency: 'account', accountName: args.accountName }
            );
        }
        throw err;
    }

    const accountIsServerless = isServerless(account);
    if (args.throughputModel.mode === 'Serverless' && !accountIsServerless) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `throughputModel.mode is "Serverless" but account "${args.accountName}" is provisioned capacity.`);
    }
    if (args.throughputModel.mode !== 'Serverless' && accountIsServerless) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `Account "${args.accountName}" is a serverless account — it cannot host a database with explicit (${args.throughputModel.mode}) throughput.`);
    }

    try {
        await client.sqlResources.getSqlDatabase(args.resourceGroup, args.accountName, args.databaseName);
        throw new AzureEstateError(ERROR_CODES.CONFLICT, `Database "${args.databaseName}" already exists in Cosmos account "${args.accountName}" (instance "${instance.name}").`);
    } catch (err) {
        if (err instanceof AzureEstateError) throw err;
        if (!isNotFoundError(err)) throw err;
    }

    const body = {
        resource: { id: args.databaseName },
        ...(built.resource ? { options: built.resource } : {}),
    };

    const poller = client.sqlResources.createUpdateSqlDatabase(args.resourceGroup, args.accountName, args.databaseName, body);
    const result = await poller.pollUntilDone();

    return {
        created: true,
        databaseName: (result.resource || {}).id || args.databaseName,
        accountName: args.accountName,
        throughputModel: args.throughputModel,
    };
}

module.exports = { execute };
