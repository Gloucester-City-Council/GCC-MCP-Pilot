/**
 * Tool: azure_resource_group_inspect
 *
 * Basic detail for a single resource group — the operational boundary.
 * For the full summarised view (types, regions, tags, identities,
 * exposure, diagnostics, findings) use azure_resource_group_inventory.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getResourceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'resource-groups', 'inspect');
    const client = getResourceClient(instance);

    let rg;
    try {
        rg = await client.resourceGroups.get(args.resourceGroup);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Resource group "${args.resourceGroup}" not found in instance "${instance.name}"`);
        }
        throw err;
    }

    let resourceCount = 0;
    for await (const _r of client.resources.listByResourceGroup(args.resourceGroup)) {
        resourceCount += 1;
    }

    return {
        name: rg.name,
        id: rg.id,
        location: rg.location,
        tags: rg.tags || {},
        provisioningState: rg.properties && rg.properties.provisioningState,
        managedBy: rg.managedBy || null,
        resourceCount,
    };
}

module.exports = { execute };
