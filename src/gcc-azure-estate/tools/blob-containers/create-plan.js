/**
 * Tool: azure_blob_container_create_plan
 *
 * Dry-run: validates the proposed container name against Azure's naming
 * rules, checks for a name collision within the storage account, and
 * echoes the requested public-access level. Never calls a write API.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { validateContainerName, validatePublicAccess } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'storageAccount', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'blob-containers', 'plan');
    const client = getStorageMgmtClient(instance);

    const nameValidation = validateContainerName(args.name);
    const publicAccessValidation = validatePublicAccess(args.publicAccess);
    const validation = {
        pass: nameValidation.pass && publicAccessValidation.pass,
        issues: [...nameValidation.issues, ...publicAccessValidation.issues],
    };

    const conflicts = [];
    try {
        await client.blobContainers.get(args.resourceGroup, args.storageAccount, args.name);
        conflicts.push(`Container "${args.name}" already exists in storage account "${args.storageAccount}"`);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        storageAccount: args.storageAccount,
        requestedPublicAccess: args.publicAccess || 'None',
        validation,
        conflicts,
        willCreate: validation.pass && conflicts.length === 0,
        requiredPermission: { resourceFamily: 'blob-containers', operationClass: 'create' },
    };
}

module.exports = { execute };
