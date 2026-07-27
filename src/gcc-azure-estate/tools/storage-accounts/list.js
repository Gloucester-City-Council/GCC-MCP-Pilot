/**
 * Tool: azure_storage_accounts_list
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { resourceGroupFromId } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'storage', 'inspect');
    const client = getStorageMgmtClient(instance);

    const iterable = args.resourceGroup
        ? client.storageAccounts.listByResourceGroup(args.resourceGroup)
        : client.storageAccounts.list();

    const accounts = [];
    for await (const account of iterable) {
        accounts.push({
            name: account.name,
            resourceGroup: resourceGroupFromId(account.id),
            location: account.location,
            kind: account.kind,
            sku: account.sku ? { name: account.sku.name, tier: account.sku.tier } : null,
            accessTier: account.accessTier || null,
            provisioningState: account.provisioningState || null,
        });
    }

    return { storageAccounts: accounts, totalCount: accounts.length };
}

module.exports = { execute };
