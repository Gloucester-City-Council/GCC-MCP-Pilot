/**
 * Tool: azure_cosmos_container_inspect
 *
 * Partition key path + version, indexing policy summary, unique key
 * policy, default TTL, analytical store status, and current throughput
 * for a single Cosmos SQL container.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, summarizeIndexingPolicy, describeThroughputResource } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'inspect');
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

    let throughputDetail = { mode: null, throughput: null, maxThroughput: null };
    try {
        const throughputSettings = await client.sqlResources.getSqlContainerThroughput(args.resourceGroup, args.accountName, args.databaseName, args.containerName);
        throughputDetail = describeThroughputResource((throughputSettings || {}).resource);
    } catch (err) {
        if (!isNotFoundError(err)) throw err;
        // No dedicated container-level throughput — this container shares the database's throughput (or the account is serverless).
    }

    return {
        name: resource.id,
        databaseName: args.databaseName,
        accountName: args.accountName,
        partitionKey: {
            paths: (resource.partitionKey || {}).paths || [],
            kind: (resource.partitionKey || {}).kind || 'Hash',
            version: (resource.partitionKey || {}).version ?? null,
        },
        indexingPolicy: summarizeIndexingPolicy(resource.indexingPolicy),
        uniqueKeyPolicy: resource.uniqueKeyPolicy || { uniqueKeys: [] },
        defaultTtl: resource.defaultTtl ?? null,
        analyticalStore: {
            enabled: resource.analyticalStorageTtl !== undefined && resource.analyticalStorageTtl !== null,
            analyticalStorageTtl: resource.analyticalStorageTtl ?? null,
        },
        throughput: throughputDetail,
    };
}

module.exports = { execute };
