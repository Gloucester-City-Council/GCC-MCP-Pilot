/**
 * Tool: azure_blob_container_inspect
 *
 * Container-level metadata/policy only — never blob content. Public access
 * level, immutability policy status, legal holds, stored access policy
 * names (not their permissions/expiry — those aren't secret but aren't the
 * point of an inspect call), metadata, soft-delete/versioning inheritance
 * from the account, and lifecycle-rule coverage.
 *
 * Stored access policies are not exposed by the control-plane
 * BlobContainer model at all — they're genuinely only available via the
 * data-plane container client, so this is the one place in the family that
 * reaches for getBlobServiceClient, and even then only for policy names.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient, getBlobServiceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isCoveredByLifecycleRule } = require('./_shared');

async function getFirstBlobServiceProperties(client, resourceGroup, storageAccount) {
    for await (const props of client.blobServices.list(resourceGroup, storageAccount)) {
        return props;
    }
    return null;
}

async function getManagementPolicy(client, resourceGroup, storageAccount) {
    try {
        return await client.managementPolicies.get(resourceGroup, storageAccount, 'default');
    } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
    }
}

async function getStoredAccessPolicyIds(storageAccount, containerName) {
    try {
        const containerClient = getBlobServiceClient(storageAccount).getContainerClient(containerName);
        const { signedIdentifiers } = await containerClient.getAccessPolicy();
        return (signedIdentifiers || []).map((si) => si.id);
    } catch (_err) {
        // Best-effort — data-plane access may be unavailable in some environments.
        return [];
    }
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'storageAccount', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'blob-containers', 'inspect');
    const client = getStorageMgmtClient(instance);

    let container;
    try {
        container = await client.blobContainers.get(args.resourceGroup, args.storageAccount, args.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Container "${args.name}" not found in storage account "${args.storageAccount}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const [blobServiceProps, managementPolicy, storedAccessPolicyIds] = await Promise.all([
        getFirstBlobServiceProperties(client, args.resourceGroup, args.storageAccount),
        getManagementPolicy(client, args.resourceGroup, args.storageAccount),
        getStoredAccessPolicyIds(args.storageAccount, args.name),
    ]);

    const deleteRetention = (blobServiceProps && blobServiceProps.containerDeleteRetentionPolicy) || {};

    return {
        name: container.name,
        resourceGroup: args.resourceGroup,
        storageAccount: args.storageAccount,
        publicAccess: container.publicAccess || 'None',
        lastModified: container.lastModifiedTime || null,
        metadata: container.metadata || {},
        immutabilityPolicy: {
            present: !!container.hasImmutabilityPolicy,
            state: (container.immutabilityPolicy && container.immutabilityPolicy.state) || null,
            periodDays: (container.immutabilityPolicy && container.immutabilityPolicy.immutabilityPeriodSinceCreationInDays) || null,
        },
        legalHold: {
            present: !!container.hasLegalHold,
            tags: (container.legalHold && (container.legalHold.tags || []).map((t) => t.tag || t)) || [],
        },
        storedAccessPolicyIds,
        accountInheritance: {
            containerSoftDelete: { enabled: !!deleteRetention.enabled, days: deleteRetention.days || null },
            versioningEnabled: !!(blobServiceProps && blobServiceProps.isVersioningEnabled),
        },
        lifecycleRuleCoverage: {
            covered: isCoveredByLifecycleRule(managementPolicy, container.name),
            hasAccountPolicy: !!managementPolicy,
        },
        approximateUsage: {
            available: false,
            message: 'Per-container size/blob-count is not exposed cheaply by any control- or data-plane API without enumerating blobs, which is out of scope for this MCP.',
        },
    };
}

module.exports = { execute };
