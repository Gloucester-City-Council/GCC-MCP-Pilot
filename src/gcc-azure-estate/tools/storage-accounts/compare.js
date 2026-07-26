/**
 * Tool: azure_storage_account_compare
 *
 * Compares two storage accounts (same or different instances). Diffs
 * SKU/kind/access-tier/TLS/public-access/network-rule-count.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function fetchSide(side) {
    const instance = assertPermitted(side.instance, 'storage', 'compare');
    const client = getStorageMgmtClient(instance);

    let account;
    try {
        account = await client.storageAccounts.getProperties(side.resourceGroup, side.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Storage account "${side.name}" not found in resource group "${side.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const networkRuleSet = account.networkRuleSet || {};

    return {
        instance: instance.name,
        resourceGroup: side.resourceGroup,
        name: account.name,
        skuName: account.sku && account.sku.name,
        kind: account.kind,
        accessTier: account.accessTier || null,
        minimumTlsVersion: account.minimumTlsVersion || null,
        publicNetworkAccess: account.publicNetworkAccess || null,
        networkRuleCount: (networkRuleSet.ipRules || []).length + (networkRuleSet.virtualNetworkRules || []).length,
    };
}

function diffField(field, left, right) {
    return left[field] === right[field] ? null : { from: left[field], to: right[field] };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['left', 'right']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);
    for (const side of ['left', 'right']) {
        const sideMissing = validateRequired(args[side] || {}, ['instance', 'resourceGroup', 'name']);
        if (sideMissing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `${side}.${sideMissing.replace('Missing required field: ', '')} is required`);
    }

    const [left, right] = await Promise.all([fetchSide(args.left), fetchSide(args.right)]);

    const differences = {
        skuName: diffField('skuName', left, right),
        kind: diffField('kind', left, right),
        accessTier: diffField('accessTier', left, right),
        minimumTlsVersion: diffField('minimumTlsVersion', left, right),
        publicNetworkAccess: diffField('publicNetworkAccess', left, right),
        networkRuleCount: diffField('networkRuleCount', left, right),
    };

    const changedFields = Object.entries(differences).filter(([, v]) => v !== null).map(([k]) => k);

    return {
        left,
        right,
        differences,
        changedFields,
        identical: changedFields.length === 0,
    };
}

module.exports = { execute };
