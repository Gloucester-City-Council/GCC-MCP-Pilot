/**
 * Tool: azure_resource_group_create
 *
 * Creates a resource group. No resource-group deletion tool exists in
 * this MCP by design — deletion is too broad and destructive to expose.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getResourceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'name', 'location']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'resource-groups', 'create');
    const client = getResourceClient(instance);

    let existing = null;
    try {
        existing = await client.resourceGroups.get(args.name);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }

    if (existing) {
        throw new AzureEstateError(
            ERROR_CODES.CONFLICT,
            `Resource group "${args.name}" already exists in instance "${instance.name}" (location: ${existing.location})`,
            { existingLocation: existing.location }
        );
    }

    const rg = await client.resourceGroups.createOrUpdate(args.name, {
        location: args.location,
        tags: args.tags || {},
    });

    return { created: true, name: rg.name, location: rg.location, tags: rg.tags || {} };
}

module.exports = { execute };
