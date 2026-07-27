/**
 * Tool: azure_storage_account_config_plan
 *
 * Dry-run: computes what an account-level configuration update would
 * add/change on a storage account (minTlsVersion, allowSharedKeyAccess,
 * publicNetworkAccess, HTTPS-only) without applying it. Mirrors
 * azure_resource_group_tags_plan's add/change/unchanged diff shape.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

const CONFIG_FIELDS = {
    minimumTlsVersion: (account) => account.minimumTlsVersion || null,
    allowSharedKeyAccess: (account) => account.allowSharedKeyAccess !== false,
    publicNetworkAccess: (account) => account.publicNetworkAccess || null,
    httpsOnly: (account) => account.enableHttpsTrafficOnly !== false,
};

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'config']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'storage', 'plan');
    const client = getStorageMgmtClient(instance);

    let account;
    try {
        account = await client.storageAccounts.getProperties(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Storage account "${args.name}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const requested = args.config || {};
    const toAdd = {};
    const toChange = {};
    const unchanged = {};
    const currentValues = {};

    for (const [key, value] of Object.entries(requested)) {
        if (!(key in CONFIG_FIELDS)) {
            throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `Unknown config field: "${key}". Valid fields: ${Object.keys(CONFIG_FIELDS).join(', ')}.`);
        }
        const current = CONFIG_FIELDS[key](account);
        currentValues[key] = current;
        if (current === null || current === undefined) toAdd[key] = value;
        else if (current !== value) toChange[key] = { from: current, to: value };
        else unchanged[key] = value;
    }

    return {
        name: account.name,
        resourceGroup: args.resourceGroup,
        currentConfig: currentValues,
        requestedConfig: requested,
        plan: { toAdd, toChange, unchanged },
        requiredPermission: { resourceFamily: 'storage', operationClass: 'modify' },
        willChange: Object.keys(toAdd).length > 0 || Object.keys(toChange).length > 0,
    };
}

module.exports = { execute };
