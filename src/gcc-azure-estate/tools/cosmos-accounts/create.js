/**
 * Tool: azure_cosmos_account_create
 *
 * Creates a Cosmos DB account. Fails with DEPENDENCY_MISSING if the target
 * resource group doesn't exist, and CONFLICT if an account of this name
 * already exists in that resource group. apiType, consistencyPolicy,
 * regions, and capacityMode are required inputs — none are defaulted.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient, getResourceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { buildAccountCreateBody, isNotFoundError } = require('../../lib/cosmos-helpers');

const REQUIRED_FIELDS = ['instance', 'resourceGroup', 'accountName', 'location', 'apiType', 'consistencyPolicy', 'regions', 'capacityMode'];

async function execute(args = {}) {
    const missing = validateRequired(args, REQUIRED_FIELDS);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'create');
    const cosmosClient = getCosmosClient(instance);
    const resourceClient = getResourceClient(instance);

    const built = buildAccountCreateBody(args);
    if (built.error) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, built.error);
    }

    try {
        await resourceClient.resourceGroups.get(args.resourceGroup);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(
                ERROR_CODES.DEPENDENCY_MISSING,
                `Resource group "${args.resourceGroup}" does not exist in instance "${instance.name}" — create it before creating the account.`,
                { missingDependency: 'resourceGroup', resourceGroup: args.resourceGroup }
            );
        }
        throw err;
    }

    try {
        await cosmosClient.databaseAccounts.get(args.resourceGroup, args.accountName);
        throw new AzureEstateError(
            ERROR_CODES.CONFLICT,
            `Cosmos DB account "${args.accountName}" already exists in resource group "${args.resourceGroup}" (instance "${instance.name}"). Use azure_cosmos_account_config_plan/apply to modify it.`
        );
    } catch (err) {
        if (err instanceof AzureEstateError) throw err;
        if (!isNotFoundError(err)) throw err;
    }

    const poller = cosmosClient.databaseAccounts.createOrUpdate(args.resourceGroup, args.accountName, built.body);
    const result = await poller.pollUntilDone();

    return {
        created: true,
        name: result.name,
        location: result.location,
        resourceGroup: args.resourceGroup,
        provisioningState: result.provisioningState || null,
        warnings: built.warnings,
    };
}

module.exports = { execute };
