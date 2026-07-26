/**
 * Tool: azure_cosmos_container_indexing_plan
 *
 * Dry-run for azure_cosmos_container_indexing_apply. Diffs a requested
 * indexingPolicy against the container's current one. This tool never
 * touches the partition key — indexing changes are applied on top of the
 * container's existing partition key, which is preserved verbatim.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, summarizeIndexingPolicy } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName', 'indexingPolicy']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'plan');
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

    const resource = container.resource || {};
    const currentSummary = summarizeIndexingPolicy(resource.indexingPolicy);
    const requestedSummary = summarizeIndexingPolicy(args.indexingPolicy);

    return {
        containerName: args.containerName,
        current: { policy: resource.indexingPolicy || null, summary: currentSummary },
        requested: { policy: args.indexingPolicy, summary: requestedSummary },
        partitionKeyPreserved: resource.partitionKey || null,
        willChange: JSON.stringify(resource.indexingPolicy || {}) !== JSON.stringify(args.indexingPolicy || {}),
        requiredPermission: { resourceFamily: 'cosmos', operationClass: 'modify' },
    };
}

module.exports = { execute };
