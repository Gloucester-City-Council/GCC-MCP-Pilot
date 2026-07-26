/**
 * Tool: azure_cosmos_account_config_plan
 *
 * Dry-run for azure_cosmos_account_config_apply. Diffs a requested
 * `config` object (any subset of: consistencyPolicy, regions,
 * automaticFailoverEnabled, multipleWriteRegionsEnabled,
 * publicNetworkAccess, ipRules, disableLocalAuth, backupPolicy, identity,
 * tags) against the account's current configuration without applying it.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, summarizeRegions } = require('../../lib/cosmos-helpers');

const CONFIGURABLE_FIELDS = [
    'consistencyPolicy', 'regions', 'automaticFailoverEnabled', 'multipleWriteRegionsEnabled',
    'publicNetworkAccess', 'ipRules', 'disableLocalAuth', 'backupPolicy', 'identity', 'tags',
];

function currentValue(account, field) {
    switch (field) {
        case 'consistencyPolicy': return account.consistencyPolicy || null;
        case 'regions': return summarizeRegions(account.locations);
        case 'automaticFailoverEnabled': return !!account.enableAutomaticFailover;
        case 'multipleWriteRegionsEnabled': return !!account.enableMultipleWriteLocations;
        case 'publicNetworkAccess': return account.publicNetworkAccess || null;
        case 'ipRules': return (account.ipRules || []).map((r) => r.ipAddressOrRange);
        case 'disableLocalAuth': return !!account.disableLocalAuth;
        case 'backupPolicy': return account.backupPolicy || null;
        case 'identity': return account.identity || null;
        case 'tags': return account.tags || {};
        default: return undefined;
    }
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

    const instance = assertPermitted(args.instance, 'cosmos', 'plan');
    const client = getCosmosClient(instance);

    let account;
    try {
        account = await client.databaseAccounts.get(args.resourceGroup, args.accountName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Cosmos DB account "${args.accountName}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const diff = {};
    for (const field of requestedFields) {
        const current = currentValue(account, field);
        const requested = args.config[field];
        if (JSON.stringify(current) !== JSON.stringify(requested)) {
            diff[field] = { from: current, to: requested };
        }
    }

    return {
        accountName: account.name,
        requestedChanges: args.config,
        diff,
        willChange: Object.keys(diff).length > 0,
        requiredPermission: { resourceFamily: 'cosmos', operationClass: 'modify' },
    };
}

module.exports = { execute };
