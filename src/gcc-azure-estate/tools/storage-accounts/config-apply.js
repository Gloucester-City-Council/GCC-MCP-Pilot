/**
 * Tool: azure_storage_account_config_apply
 *
 * Applies an account-level configuration update computed by
 * azure_storage_account_config_plan (minTlsVersion, allowSharedKeyAccess,
 * publicNetworkAccess, HTTPS-only).
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

const FIELD_TO_UPDATE_KEY = {
    minimumTlsVersion: 'minimumTlsVersion',
    allowSharedKeyAccess: 'allowSharedKeyAccess',
    publicNetworkAccess: 'publicNetworkAccess',
    httpsOnly: 'enableHttpsTrafficOnly',
};

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'config']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'storage', 'modify');
    const client = getStorageMgmtClient(instance);

    let existing;
    try {
        existing = await client.storageAccounts.getProperties(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Storage account "${args.name}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const updateParameters = {};
    for (const [key, value] of Object.entries(args.config || {})) {
        if (!(key in FIELD_TO_UPDATE_KEY)) {
            throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `Unknown config field: "${key}". Valid fields: ${Object.keys(FIELD_TO_UPDATE_KEY).join(', ')}.`);
        }
        updateParameters[FIELD_TO_UPDATE_KEY[key]] = value;
    }

    const updated = await client.storageAccounts.update(args.resourceGroup, args.name, updateParameters);

    return {
        name: updated.name || existing.name,
        resourceGroup: args.resourceGroup,
        minimumTlsVersion: updated.minimumTlsVersion || null,
        allowSharedKeyAccess: updated.allowSharedKeyAccess !== false,
        publicNetworkAccess: updated.publicNetworkAccess || null,
        httpsOnly: updated.enableHttpsTrafficOnly !== false,
    };
}

module.exports = { execute };
