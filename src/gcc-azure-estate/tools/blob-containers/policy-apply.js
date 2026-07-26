/**
 * Tool: azure_blob_container_policy_apply
 *
 * Applies a container-level policy change computed by
 * azure_blob_container_policy_plan: public access level and/or stored
 * access policies. Stored access policies can only be written via the
 * data-plane container client (setAccessPolicy) — the control-plane
 * BlobContainer model has no equivalent — so both the public access level
 * and the stored access policies are written together in one data-plane
 * call. Policies not mentioned in `storedAccessPolicies` are left
 * untouched (merge, like azure_resource_group_tags_apply).
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient, getBlobServiceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { validatePublicAccess, toDataPlanePublicAccess } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'storageAccount', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'blob-containers', 'modify');
    const client = getStorageMgmtClient(instance);

    const publicAccessValidation = validatePublicAccess(args.publicAccess);
    if (!publicAccessValidation.pass) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, publicAccessValidation.issues.join(' '));
    }

    let container;
    try {
        container = await client.blobContainers.get(args.resourceGroup, args.storageAccount, args.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Container "${args.name}" not found in storage account "${args.storageAccount}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const currentArmPublicAccess = container.publicAccess || 'None';
    const nextArmPublicAccess = args.publicAccess !== undefined ? args.publicAccess : currentArmPublicAccess;

    const containerClient = getBlobServiceClient(args.storageAccount).getContainerClient(args.name);

    let currentIdentifiers = [];
    try {
        const { signedIdentifiers } = await containerClient.getAccessPolicy();
        currentIdentifiers = signedIdentifiers || [];
    } catch (_err) {
        currentIdentifiers = [];
    }
    const mergedById = new Map(currentIdentifiers.map((si) => [si.id, si]));
    for (const requested of args.storedAccessPolicies || []) {
        mergedById.set(requested.id, {
            id: requested.id,
            accessPolicy: { permissions: requested.permissions, startsOn: requested.startsOn, expiresOn: requested.expiresOn },
        });
    }
    const mergedIdentifiers = [...mergedById.values()];

    await containerClient.setAccessPolicy(toDataPlanePublicAccess(nextArmPublicAccess), mergedIdentifiers);

    return {
        name: container.name,
        resourceGroup: args.resourceGroup,
        storageAccount: args.storageAccount,
        publicAccess: nextArmPublicAccess,
        storedAccessPolicyIds: mergedIdentifiers.map((si) => si.id),
    };
}

module.exports = { execute };
