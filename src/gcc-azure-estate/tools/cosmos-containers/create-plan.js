/**
 * Tool: azure_cosmos_container_create_plan
 *
 * Dry-run for azure_cosmos_container_create. The creation contract
 * requires ALL of: database, containerName, partitionKey (paths[],
 * version where relevant), throughputModel, indexingPolicy,
 * uniqueKeyPolicy, defaultTtl, analyticalStore — none are guessed. Most
 * importantly: partition keys are immutable. If a container of this name
 * already exists, its current partition key is compared to the requested
 * one and ANY difference is a hard PARTITION_KEY_IMMUTABLE failure, never
 * a silent no-op or a warning.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, buildThroughputResource, partitionKeysEqual } = require('../../lib/cosmos-helpers');

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
    // defaultTtl and analyticalStore are part of the creation contract but are
    // legitimately allowed to be `null`/`false` — validateRequired would reject
    // `null`, so they're checked for presence (key exists) rather than truthiness.
    if (!('defaultTtl' in args)) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'Missing required field: defaultTtl (pass null explicitly for "no TTL")');
    if (!('analyticalStore' in args)) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'Missing required field: analyticalStore (pass { enabled: false } explicitly if not wanted)');

    const partitionKeyError = validatePartitionKey(args.partitionKey);
    if (partitionKeyError) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, partitionKeyError);

    const instance = assertPermitted(args.instance, 'cosmos', 'plan');
    const client = getCosmosClient(instance);

    const built = buildThroughputResource(args.throughputModel);
    if (built.error) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, built.error);

    let existingContainer = null;
    try {
        const existing = await client.sqlResources.getSqlContainer(args.resourceGroup, args.accountName, args.databaseName, args.containerName);
        existingContainer = existing.resource || {};
    } catch (err) {
        if (!isNotFoundError(err)) throw err;
    }

    const blockers = [];
    let partitionKeyImmutabilityViolation = null;

    if (existingContainer) {
        const existingPartitionKey = existingContainer.partitionKey || {};
        if (!partitionKeysEqual(existingPartitionKey, args.partitionKey)) {
            partitionKeyImmutabilityViolation = {
                existing: existingPartitionKey,
                requested: args.partitionKey,
            };
            blockers.push('partitionKeyImmutable');
        }
    }

    return {
        containerName: args.containerName,
        databaseName: args.databaseName,
        containerAlreadyExists: !!existingContainer,
        partitionKeyImmutabilityViolation,
        proposedConfiguration: {
            partitionKey: args.partitionKey,
            throughput: built.resource,
            indexingPolicy: args.indexingPolicy,
            uniqueKeyPolicy: args.uniqueKeyPolicy,
            defaultTtl: args.defaultTtl,
            analyticalStore: args.analyticalStore,
        },
        canApply: blockers.length === 0,
        blockers,
        requiredPermission: { resourceFamily: 'cosmos', operationClass: 'create' },
    };
}

module.exports = { execute };
