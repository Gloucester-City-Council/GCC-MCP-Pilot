/**
 * Tool: azure_resource_group_tags_apply
 *
 * Applies a tag update computed by azure_resource_group_tags_plan.
 * Merges (does not replace) — existing tags not mentioned in `tags` are
 * left untouched.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getResourceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'tags']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'resource-groups', 'modify');
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

    const mergedTags = { ...(rg.tags || {}), ...args.tags };
    const updated = await client.resourceGroups.update(args.resourceGroup, { tags: mergedTags });

    return { resourceGroup: updated.name, tags: updated.tags || {} };
}

module.exports = { execute };
