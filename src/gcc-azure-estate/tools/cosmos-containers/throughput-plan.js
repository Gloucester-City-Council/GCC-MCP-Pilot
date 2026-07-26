/**
 * Tool: azure_cosmos_container_throughput_plan
 *
 * Dry-run for azure_cosmos_container_throughput_apply. Diffs the
 * requested throughputModel against the container's current dedicated
 * throughput setting. DEPENDENCY_MISSING if the container has no
 * container-level throughput to change (serverless account, or the
 * database carries shared throughput instead).
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, buildThroughputResource, describeThroughputResource } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName', 'throughputModel']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'plan');
    const client = getCosmosClient(instance);

    const built = buildThroughputResource(args.throughputModel);
    if (built.error) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, built.error);
    if (args.throughputModel.mode === 'Serverless') {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'Cannot plan a throughput change to "Serverless" — capacity mode is set at account creation, not per-container.');
    }

    let currentThroughput;
    try {
        currentThroughput = await client.sqlResources.getSqlContainerThroughput(args.resourceGroup, args.accountName, args.databaseName, args.containerName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(
                ERROR_CODES.DEPENDENCY_MISSING,
                `Container "${args.containerName}" has no container-level (dedicated) throughput to change — it is either serverless or uses the database's shared throughput.`,
                { containerName: args.containerName }
            );
        }
        throw err;
    }

    const current = describeThroughputResource((currentThroughput || {}).resource);
    const requiresMigration = current.mode !== args.throughputModel.mode;

    return {
        containerName: args.containerName,
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
