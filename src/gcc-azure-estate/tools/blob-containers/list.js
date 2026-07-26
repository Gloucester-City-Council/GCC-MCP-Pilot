/**
 * Tool: azure_blob_containers_list
 *
 * Container-level metadata only — never blob content. Lists containers in
 * a storage account: name, public access level, last-modified time, and
 * metadata.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'storageAccount']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'blob-containers', 'inspect');
    const client = getStorageMgmtClient(instance);

    const containers = [];
    for await (const item of client.blobContainers.list(args.resourceGroup, args.storageAccount)) {
        containers.push({
            name: item.name,
            publicAccess: item.publicAccess || 'None',
            lastModified: item.lastModifiedTime || null,
            metadata: item.metadata || {},
            metadataKeys: Object.keys(item.metadata || {}),
        });
    }

    return {
        resourceGroup: args.resourceGroup,
        storageAccount: args.storageAccount,
        containers,
        totalCount: containers.length,
    };
}

module.exports = { execute };
