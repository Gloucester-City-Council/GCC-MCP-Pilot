/**
 * Tool: azure_storage_account_create
 *
 * Creates a storage account. Fails with CONFLICT if one already exists in
 * this resource group, or BAD_REQUEST if the sku/kind/accessTier
 * combination is invalid. No delete tool exists for this family.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { validateAccountConfig } = require('./_shared');

/**
 * StorageAccountsOperations.create() is a long-running operation. Depending
 * on the installed SDK version it may resolve to a poller (with
 * pollUntilDone()) or, in simplified/mocked clients, directly to the final
 * resource — handle both without assuming either shape.
 */
async function createAndWait(client, resourceGroup, name, parameters) {
    const result = await client.storageAccounts.create(resourceGroup, name, parameters);
    if (result && typeof result.pollUntilDone === 'function') {
        return result.pollUntilDone();
    }
    return result;
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'location', 'sku', 'kind']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'storage', 'create');
    const client = getStorageMgmtClient(instance);

    const validation = validateAccountConfig({
        name: args.name, sku: args.sku, kind: args.kind, accessTier: args.accessTier,
    });
    if (!validation.pass) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `Invalid storage account configuration: ${validation.issues.join(' ')}`, { issues: validation.issues });
    }

    let existing = null;
    try {
        existing = await client.storageAccounts.getProperties(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    if (existing) {
        throw new AzureEstateError(
            ERROR_CODES.CONFLICT,
            `Storage account "${args.name}" already exists in resource group "${args.resourceGroup}" (instance "${instance.name}")`,
            { existingLocation: existing.location }
        );
    }

    const parameters = {
        sku: { name: args.sku },
        kind: args.kind,
        location: args.location,
        tags: args.tags || {},
        minimumTlsVersion: args.minimumTlsVersion || 'TLS1_2',
        allowSharedKeyAccess: args.allowSharedKeyAccess !== undefined ? args.allowSharedKeyAccess : true,
        enableHttpsTrafficOnly: args.httpsOnly !== undefined ? args.httpsOnly : true,
    };
    if (args.accessTier) parameters.accessTier = args.accessTier;
    if (args.publicNetworkAccess) parameters.publicNetworkAccess = args.publicNetworkAccess;

    const account = await createAndWait(client, args.resourceGroup, args.name, parameters);

    return {
        created: true,
        name: account.name,
        resourceGroup: args.resourceGroup,
        location: account.location,
        kind: account.kind,
        sku: account.sku ? { name: account.sku.name, tier: account.sku.tier } : null,
        accessTier: account.accessTier || null,
        provisioningState: account.provisioningState || null,
    };
}

module.exports = { execute };
