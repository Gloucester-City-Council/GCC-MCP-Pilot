/**
 * Tool: azure_cosmos_containers_list
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'databaseName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'inspect');
    const client = getCosmosClient(instance);

    try {
        const containers = [];
        for await (const c of client.sqlResources.listSqlContainers(args.resourceGroup, args.accountName, args.databaseName)) {
            const resource = c.resource || {};
            containers.push({
                name: resource.id,
                partitionKeyPaths: (resource.partitionKey || {}).paths || [],
                partitionKeyVersion: (resource.partitionKey || {}).version ?? null,
                defaultTtl: resource.defaultTtl ?? null,
                analyticalStorageTtl: resource.analyticalStorageTtl ?? null,
            });
        }
        return { containers, totalCount: containers.length };
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Database "${args.databaseName}" not found in Cosmos account "${args.accountName}" (instance "${instance.name}")`);
        }
        throw err;
    }
}

module.exports = { execute };
