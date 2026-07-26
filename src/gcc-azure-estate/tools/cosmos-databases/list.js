/**
 * Tool: azure_cosmos_databases_list
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'inspect');
    const client = getCosmosClient(instance);

    let iterator;
    try {
        iterator = client.sqlResources.listSqlDatabases(args.resourceGroup, args.accountName);
        // Force at least the first page fetch inside the try so a missing
        // account (404) surfaces here rather than as an unhandled rejection
        // during iteration below.
        const databases = [];
        for await (const db of iterator) {
            const resource = db.resource || {};
            databases.push({
                name: resource.id,
                throughputMode: (db.options || {}).autoscaleSettings ? 'Autoscale' : ((db.options || {}).throughput !== undefined ? 'Manual' : 'Unknown'),
                throughput: (db.options || {}).throughput ?? null,
                maxThroughput: ((db.options || {}).autoscaleSettings || {}).maxThroughput ?? null,
            });
        }
        return { databases, totalCount: databases.length };
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Cosmos DB account "${args.accountName}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }
}

module.exports = { execute };
