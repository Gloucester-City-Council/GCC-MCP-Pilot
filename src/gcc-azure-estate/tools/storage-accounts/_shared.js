/**
 * Small internal helpers shared across the storage-accounts tool family.
 * Not a tool itself — no `execute` export, so it is never registered as an
 * MCP tool by the family aggregator.
 */

'use strict';

const VALID_KINDS = ['Storage', 'StorageV2', 'BlobStorage', 'FileStorage', 'BlockBlobStorage'];
const VALID_SKUS = [
    'Standard_LRS', 'Standard_GRS', 'Standard_RAGRS', 'Standard_ZRS',
    'Standard_GZRS', 'Standard_RAGZRS', 'Premium_LRS', 'Premium_ZRS',
];
const PREMIUM_SKUS = ['Premium_LRS', 'Premium_ZRS'];
const VALID_ACCESS_TIERS = ['Hot', 'Cool', 'Cold'];
const NAME_PATTERN = /^[a-z0-9]{3,24}$/;

/** Extracts the resource group name out of an ARM resource id. */
function resourceGroupFromId(id) {
    const match = /\/resourceGroups\/([^/]+)\//i.exec(id || '');
    return match ? match[1] : null;
}

/**
 * Validates a proposed storage account name/sku/kind/accessTier combination.
 * Returns { pass, issues[] } — never throws; callers decide what to do with
 * a failing validation (create_plan reports it, create rejects on it).
 */
function validateAccountConfig({ name, sku, kind, accessTier }) {
    const issues = [];

    if (!NAME_PATTERN.test(name || '')) {
        issues.push(`Storage account name "${name}" is invalid — must be 3-24 lowercase letters and numbers only.`);
    }
    if (!VALID_KINDS.includes(kind)) {
        issues.push(`Unknown kind "${kind}". Valid kinds: ${VALID_KINDS.join(', ')}.`);
    }
    if (!VALID_SKUS.includes(sku)) {
        issues.push(`Unknown SKU "${sku}". Valid SKUs: ${VALID_SKUS.join(', ')}.`);
    }
    if (kind === 'BlobStorage' && !accessTier) {
        issues.push('Kind "BlobStorage" requires an accessTier (Hot or Cool).');
    }
    if ((kind === 'BlockBlobStorage' || kind === 'FileStorage') && VALID_SKUS.includes(sku) && !PREMIUM_SKUS.includes(sku)) {
        issues.push(`Kind "${kind}" requires a premium SKU (${PREMIUM_SKUS.join(' or ')}), got "${sku}".`);
    }
    if (accessTier && !VALID_ACCESS_TIERS.includes(accessTier)) {
        issues.push(`Unknown accessTier "${accessTier}". Valid values: ${VALID_ACCESS_TIERS.join(', ')}.`);
    }

    return { pass: issues.length === 0, issues };
}

module.exports = {
    VALID_KINDS,
    VALID_SKUS,
    PREMIUM_SKUS,
    VALID_ACCESS_TIERS,
    resourceGroupFromId,
    validateAccountConfig,
};
