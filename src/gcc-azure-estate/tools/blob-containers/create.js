/**
 * Tool: azure_blob_container_create
 *
 * Creates a container in a storage account. Fails with CONFLICT if one of
 * that name already exists, or BAD_REQUEST if the name is invalid. No
 * delete tool exists for this family, and this never touches blob content.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { validateContainerName, validatePublicAccess } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'storageAccount', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'blob-containers', 'create');
    const client = getStorageMgmtClient(instance);

    const nameValidation = validateContainerName(args.name);
    const publicAccessValidation = validatePublicAccess(args.publicAccess);
    if (!nameValidation.pass || !publicAccessValidation.pass) {
        throw new AzureEstateError(
            ERROR_CODES.BAD_REQUEST,
            `Invalid container configuration: ${[...nameValidation.issues, ...publicAccessValidation.issues].join(' ')}`,
            { issues: [...nameValidation.issues, ...publicAccessValidation.issues] }
        );
    }

    let existing = null;
    try {
        existing = await client.blobContainers.get(args.resourceGroup, args.storageAccount, args.name);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    if (existing) {
        throw new AzureEstateError(
            ERROR_CODES.CONFLICT,
            `Container "${args.name}" already exists in storage account "${args.storageAccount}" (instance "${instance.name}")`
        );
    }

    const container = await client.blobContainers.create(args.resourceGroup, args.storageAccount, args.name, {
        publicAccess: args.publicAccess || 'None',
        metadata: args.metadata || {},
    });

    return {
        created: true,
        name: container.name,
        resourceGroup: args.resourceGroup,
        storageAccount: args.storageAccount,
        publicAccess: container.publicAccess || 'None',
        metadata: container.metadata || {},
    };
}

module.exports = { execute };
