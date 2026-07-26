/**
 * Tool: azure_cosmos_container_indexing_apply
 *
 * Applies an indexing policy change computed by
 * azure_cosmos_container_indexing_plan. Rebuilds the full container
 * resource from the container's current state (Cosmos ARM requires the
 * whole resource on update) but only ever overrides `indexingPolicy` —
 * the partition key, unique key policy, TTL, and analytical store
 * settings are carried through unchanged. This tool never modifies a
 * partition key, implicitly or otherwise.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName', 'indexingPolicy']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'modify');
    const client = getCosmosClient(instance);

    let container;
    try {
        container = await client.sqlResources.getSqlContainer(args.resourceGroup, args.accountName, args.databaseName, args.containerName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Container "${args.containerName}" not found in database "${args.databaseName}" (account "${args.accountName}", instance "${instance.name}")`);
        }
        throw err;
    }

    const existingResource = container.resource || {};

    const resource = {
        id: existingResource.id,
        partitionKey: existingResource.partitionKey,
        uniqueKeyPolicy: existingResource.uniqueKeyPolicy,
        defaultTtl: existingResource.defaultTtl,
        indexingPolicy: args.indexingPolicy,
    };
    if (existingResource.analyticalStorageTtl !== undefined) {
        resource.analyticalStorageTtl = existingResource.analyticalStorageTtl;
    }

    const poller = client.sqlResources.createUpdateSqlContainer(args.resourceGroup, args.accountName, args.databaseName, args.containerName, { resource });
    const result = await poller.pollUntilDone();

    return {
        containerName: args.containerName,
        indexingPolicy: (result.resource || {}).indexingPolicy || args.indexingPolicy,
        partitionKeyUnchanged: JSON.stringify((result.resource || {}).partitionKey) === JSON.stringify(existingResource.partitionKey),
    };
}

module.exports = { execute };
