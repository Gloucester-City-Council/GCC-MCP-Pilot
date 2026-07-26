/**
 * Tool: azure_cosmos_database_create_plan
 *
 * Dry-run for azure_cosmos_database_create. throughputModel is a required
 * input — { mode: 'Autoscale'|'Manual'|'Serverless', maxThroughput?,
 * throughput? } — never guessed. Serverless mode is only valid against a
 * serverless account; anything else against a serverless account is
 * rejected rather than silently coerced.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, isServerless, buildThroughputResource } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'databaseName', 'throughputModel']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'plan');
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
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `throughputModel.mode is "Serverless" but account "${args.accountName}" is provisioned capacity — a serverless database can only exist on a serverless account.`);
    }
    if (args.throughputModel.mode !== 'Serverless' && accountIsServerless) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `Account "${args.accountName}" is a serverless account — it cannot host a database with explicit (${args.throughputModel.mode}) throughput.`);
    }

    let databaseExists = false;
    try {
        await client.sqlResources.getSqlDatabase(args.resourceGroup, args.accountName, args.databaseName);
        databaseExists = true;
    } catch (err) {
        if (!isNotFoundError(err)) throw err;
    }

    return {
        databaseName: args.databaseName,
        accountName: args.accountName,
        databaseAlreadyExists: databaseExists,
        proposedThroughput: built.resource,
        canApply: !databaseExists,
        blockers: databaseExists ? ['databaseAlreadyExists'] : [],
        requiredPermission: { resourceFamily: 'cosmos', operationClass: 'create' },
    };
}

module.exports = { execute };
