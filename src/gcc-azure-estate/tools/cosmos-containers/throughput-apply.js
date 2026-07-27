/**
 * Tool: azure_cosmos_container_throughput_apply
 *
 * Applies a throughput change computed by azure_cosmos_container_throughput_plan.
 * If the requested mode differs from the current mode, migrates first
 * (migrateSqlContainerToAutoscale/ToManualThroughput), then sets the
 * requested value via updateSqlContainerThroughput.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, buildThroughputResource, describeThroughputResource } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName', 'throughputModel']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'modify');
    const client = getCosmosClient(instance);

    const built = buildThroughputResource(args.throughputModel);
    if (built.error) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, built.error);
    if (args.throughputModel.mode === 'Serverless') {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'Cannot change throughput to "Serverless" — capacity mode is set at account creation, not per-container.');
    }

    let currentThroughput;
    try {
        currentThroughput = await client.sqlResources.getSqlContainerThroughput(args.resourceGroup, args.accountName, args.databaseName, args.containerName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(
                ERROR_CODES.DEPENDENCY_MISSING,
                `Container "${args.containerName}" has no container-level (dedicated) throughput to change.`,
                { containerName: args.containerName }
            );
        }
        throw err;
    }

    const current = describeThroughputResource((currentThroughput || {}).resource);

    if (current.mode !== args.throughputModel.mode) {
        const migratePoller = args.throughputModel.mode === 'Autoscale'
            ? client.sqlResources.migrateSqlContainerToAutoscale(args.resourceGroup, args.accountName, args.databaseName, args.containerName)
            : client.sqlResources.migrateSqlContainerToManualThroughput(args.resourceGroup, args.accountName, args.databaseName, args.containerName);
        await migratePoller.pollUntilDone();
    }

    const updatePoller = client.sqlResources.updateSqlContainerThroughput(
        args.resourceGroup, args.accountName, args.databaseName, args.containerName,
        { resource: built.resource }
    );
    const result = await updatePoller.pollUntilDone();

    const applied = describeThroughputResource((result || {}).resource);

    return {
        containerName: args.containerName,
        migrated: current.mode !== args.throughputModel.mode,
        applied,
    };
}

module.exports = { execute };
