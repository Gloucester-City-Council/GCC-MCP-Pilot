/**
 * Tool: azure_resource_groups_list
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getResourceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'resource-groups', 'inspect');
    const client = getResourceClient(instance);

    const groups = [];
    for await (const rg of client.resourceGroups.list()) {
        groups.push({
            name: rg.name,
            location: rg.location,
            tags: rg.tags || {},
            provisioningState: rg.properties && rg.properties.provisioningState,
        });
    }

    return { resourceGroups: groups, totalCount: groups.length };
}

module.exports = { execute };
