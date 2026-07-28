/**
 * Tool: azure_cosmos_container_create
 *
 * Creates a Cosmos SQL container. The creation contract requires ALL of:
 * database, containerName, partitionKey (paths[], version where
 * relevant), throughputModel, indexingPolicy, uniqueKeyPolicy,
 * defaultTtl, analyticalStore — rejected with BAD_REQUEST if any are
 * missing, and the partition key is never guessed.
 *
 * CRITICAL DESIGN RULE: a container's partition key is immutable once
 * created. If a container of this name already exists, its current
 * partition key is compared against the requested one. ANY difference
 * (paths, kind, or version) is a hard PARTITION_KEY_IMMUTABLE failure —
 * never a silent no-op, never a warning, and this tool never "creates or
 * updates" a partition key implicitly.
 *
 * Fails fast with DEPENDENCY_MISSING if the database doesn't exist yet,
 * and with BAD_REQUEST on a throughputModel/account capacity-mode
 * mismatch — mirroring azure_cosmos_database_create's checks. Without
 * these, submitting a create against a missing database or a
 * serverless/provisioned mismatch still reaches Azure as an accepted
 * async operation that only fails once polled, which can take far
 * longer to surface than a same-request validation error — long enough
 * to look like a hung tool call to a client with a shorter timeout.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, isServerless, buildThroughputResource, partitionKeysEqual } = require('../../lib/cosmos-helpers');

const REQUIRED_FIELDS = [
    'instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName',
    'partitionKey', 'throughputModel', 'indexingPolicy', 'uniqueKeyPolicy',
];

function validatePartitionKey(partitionKey) {
    if (!partitionKey || !Array.isArray(partitionKey.paths) || partitionKey.paths.length === 0) {
        return 'partitionKey.paths must be a non-empty array — a container\'s partition key is never guessed.';
    }
    return null;
}

async function execute(args = {}) {
    const missing = validateRequired(args, REQUIRED_FIELDS);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);
    if (!('defaultTtl' in args)) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'Missing required field: defaultTtl (pass null explicitly for "no TTL")');
    if (!('analyticalStore' in args)) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'Missing required field: analyticalStore (pass { enabled: false } explicitly if not wanted)');

    const partitionKeyError = validatePartitionKey(args.partitionKey);
    if (partitionKeyError) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, partitionKeyError);

    const instance = assertPermitted(args.instance, 'cosmos', 'create');
    const client = getCosmosClient(instance);

    const built = buildThroughputResource(args.throughputModel);
    if (built.error) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, built.error);

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
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `Account "${args.accountName}" is a serverless account — it cannot host a container with explicit (${args.throughputModel.mode}) throughput.`);
    }

    try {
        await client.sqlResources.getSqlDatabase(args.resourceGroup, args.accountName, args.databaseName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(
                ERROR_CODES.DEPENDENCY_MISSING,
                `Database "${args.databaseName}" does not exist in Cosmos account "${args.accountName}" (instance "${instance.name}") — create it first.`,
                { missingDependency: 'database', databaseName: args.databaseName }
            );
        }
        throw err;
    }

    // Partition-key immutability check — this must run before any write.
    let existingResource = null;
    try {
        const existing = await client.sqlResources.getSqlContainer(args.resourceGroup, args.accountName, args.databaseName, args.containerName);
        existingResource = existing.resource || {};
    } catch (err) {
        if (!isNotFoundError(err)) throw err;
    }

    if (existingResource) {
        const existingPartitionKey = existingResource.partitionKey || {};
        if (!partitionKeysEqual(existingPartitionKey, args.partitionKey)) {
            throw new AzureEstateError(
                ERROR_CODES.PARTITION_KEY_IMMUTABLE,
                `Container "${args.containerName}" already exists with a different partition key. A container's partition key is immutable and is never changed implicitly by this tool.`,
                { existingPartitionKey, requestedPartitionKey: args.partitionKey }
            );
        }
    }

    const resource = {
        id: args.containerName,
        partitionKey: args.partitionKey,
        indexingPolicy: args.indexingPolicy,
        uniqueKeyPolicy: args.uniqueKeyPolicy,
        defaultTtl: args.defaultTtl,
    };
    if (args.analyticalStore && args.analyticalStore.enabled) {
        resource.analyticalStorageTtl = args.analyticalStore.ttl ?? -1;
    }

    const body = {
        resource,
        ...(built.resource ? { options: built.resource } : {}),
    };

    const poller = client.sqlResources.createUpdateSqlContainer(args.resourceGroup, args.accountName, args.databaseName, args.containerName, body);
    const result = await poller.pollUntilDone();

    return {
        created: !existingResource,
        updated: !!existingResource,
        containerName: (result.resource || {}).id || args.containerName,
        databaseName: args.databaseName,
        partitionKey: (result.resource || {}).partitionKey || args.partitionKey,
    };
}

module.exports = { execute };
