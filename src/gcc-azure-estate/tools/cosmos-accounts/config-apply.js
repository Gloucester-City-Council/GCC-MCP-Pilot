/**
 * Tool: azure_cosmos_account_config_apply
 *
 * Applies a configuration update computed by azure_cosmos_account_config_plan
 * via DatabaseAccountUpdateParameters. Only the fields present in `config`
 * are sent — everything else is left untouched by the ARM update call.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError } = require('../../lib/cosmos-helpers');

const CONFIGURABLE_FIELDS = [
    'consistencyPolicy', 'regions', 'automaticFailoverEnabled', 'multipleWriteRegionsEnabled',
    'publicNetworkAccess', 'ipRules', 'disableLocalAuth', 'backupPolicy', 'identity', 'tags',
];

function toUpdateParameters(config) {
    const body = {};
    if (config.consistencyPolicy !== undefined) body.consistencyPolicy = config.consistencyPolicy;
    if (config.regions !== undefined) {
        body.locations = config.regions.map((r) => ({
            locationName: r.locationName,
            failoverPriority: r.failoverPriority,
            isZoneRedundant: !!r.isZoneRedundant,
        }));
    }
    if (config.automaticFailoverEnabled !== undefined) body.enableAutomaticFailover = !!config.automaticFailoverEnabled;
    if (config.multipleWriteRegionsEnabled !== undefined) body.enableMultipleWriteLocations = !!config.multipleWriteRegionsEnabled;
    if (config.publicNetworkAccess !== undefined) body.publicNetworkAccess = config.publicNetworkAccess;
    if (config.ipRules !== undefined) body.ipRules = config.ipRules.map((ip) => ({ ipAddressOrRange: ip }));
    if (config.disableLocalAuth !== undefined) body.disableLocalAuth = !!config.disableLocalAuth;
    if (config.backupPolicy !== undefined) body.backupPolicy = config.backupPolicy;
    if (config.identity !== undefined) body.identity = config.identity;
    if (config.tags !== undefined) body.tags = config.tags;
    return body;
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'config']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const requestedFields = Object.keys(args.config || {});
    const unknownFields = requestedFields.filter((f) => !CONFIGURABLE_FIELDS.includes(f));
    if (unknownFields.length) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `Unsupported config field(s): ${unknownFields.join(', ')}. Supported: ${CONFIGURABLE_FIELDS.join(', ')}`);
    }
    if (requestedFields.length === 0) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'config must contain at least one field to change');
    }

    const instance = assertPermitted(args.instance, 'cosmos', 'modify');
    const client = getCosmosClient(instance);

    try {
        await client.databaseAccounts.get(args.resourceGroup, args.accountName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Cosmos DB account "${args.accountName}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const updateBody = toUpdateParameters(args.config);
    const poller = client.databaseAccounts.update(args.resourceGroup, args.accountName, updateBody);
    const result = await poller.pollUntilDone();

    return {
        accountName: result.name,
        applied: args.config,
        provisioningState: result.provisioningState || null,
    };
}

module.exports = { execute };
