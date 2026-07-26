/**
 * Tool: azure_blob_container_policy_plan
 *
 * Dry-run: computes what a container-level policy change (public access
 * level and/or stored access policies) would add/change/leave unchanged,
 * mirroring azure_resource_group_tags_plan's diff shape. Never applies
 * anything.
 *
 * Stored access policies are read via the data-plane container client
 * (getAccessPolicy) since the control-plane BlobContainer model does not
 * expose them at all.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient, getBlobServiceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { validatePublicAccess } = require('./_shared');

function accessPoliciesEqual(a, b) {
    if (!a || !b) return false;
    return a.permissions === b.permissions && a.startsOn === b.startsOn && a.expiresOn === b.expiresOn;
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'storageAccount', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'blob-containers', 'plan');
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

    const currentPublicAccess = container.publicAccess || 'None';
    const publicAccessChange = args.publicAccess !== undefined && args.publicAccess !== currentPublicAccess
        ? { from: currentPublicAccess, to: args.publicAccess }
        : null;

    let currentIdentifiers = [];
    try {
        const containerClient = getBlobServiceClient(args.storageAccount).getContainerClient(args.name);
        const { signedIdentifiers } = await containerClient.getAccessPolicy();
        currentIdentifiers = signedIdentifiers || [];
    } catch (_err) {
        currentIdentifiers = [];
    }
    const currentById = new Map(currentIdentifiers.map((si) => [si.id, si.accessPolicy]));

    const toAdd = {};
    const toChange = {};
    const unchanged = {};
    for (const requested of args.storedAccessPolicies || []) {
        const current = currentById.get(requested.id);
        const requestedPolicy = { permissions: requested.permissions, startsOn: requested.startsOn, expiresOn: requested.expiresOn };
        if (!current) toAdd[requested.id] = requestedPolicy;
        else if (!accessPoliciesEqual(current, requestedPolicy)) toChange[requested.id] = { from: current, to: requestedPolicy };
        else unchanged[requested.id] = requestedPolicy;
    }

    return {
        name: container.name,
        resourceGroup: args.resourceGroup,
        storageAccount: args.storageAccount,
        currentPublicAccess,
        publicAccessPlan: publicAccessChange,
        storedAccessPolicyIds: [...currentById.keys()],
        storedAccessPolicyPlan: { toAdd, toChange, unchanged },
        requiredPermission: { resourceFamily: 'blob-containers', operationClass: 'modify' },
        willChange: !!publicAccessChange || Object.keys(toAdd).length > 0 || Object.keys(toChange).length > 0,
    };
}

module.exports = { execute };
