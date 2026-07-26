/**
 * Tool: azure_storage_account_create_plan
 *
 * Dry-run: validates the SKU/kind/access-tier combination and checks for a
 * name collision (storage account names are globally unique across all of
 * Azure, not just the resource group). Never calls a write API.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { validateAccountConfig } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'location', 'sku', 'kind']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'storage', 'plan');
    const client = getStorageMgmtClient(instance);

    const validation = validateAccountConfig({
        name: args.name, sku: args.sku, kind: args.kind, accessTier: args.accessTier,
    });

    const conflicts = [];

    let existing = null;
    try {
        existing = await client.storageAccounts.getProperties(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    if (existing) {
        conflicts.push(`Storage account "${args.name}" already exists in resource group "${args.resourceGroup}"`);
    }

    if (!existing && typeof client.storageAccounts.checkNameAvailability === 'function') {
        const availability = await client.storageAccounts.checkNameAvailability({
            name: args.name,
            type: 'Microsoft.Storage/storageAccounts',
        });
        if (availability && availability.nameAvailable === false) {
            conflicts.push(`Storage account name "${args.name}" is not available globally: ${availability.message || availability.reason}`);
        }
    }

    const willCreate = validation.pass && conflicts.length === 0;

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        location: args.location,
        sku: args.sku,
        kind: args.kind,
        accessTier: args.accessTier || null,
        validation,
        conflicts,
        willCreate,
        requiredPermission: { resourceFamily: 'storage', operationClass: 'create' },
    };
}

module.exports = { execute };
