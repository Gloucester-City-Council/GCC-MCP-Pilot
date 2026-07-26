/**
 * Tool: azure_resource_group_tags_plan
 *
 * Computes what a tag update would change without applying it. Diffs
 * requested tags against the resource group's current tags.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getResourceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'tags']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'resource-groups', 'plan');
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

    const current = rg.tags || {};
    const requested = args.tags;

    const toAdd = {};
    const toChange = {};
    const unchanged = {};

    for (const [key, value] of Object.entries(requested)) {
        if (!(key in current)) toAdd[key] = value;
        else if (current[key] !== value) toChange[key] = { from: current[key], to: value };
        else unchanged[key] = value;
    }

    return {
        resourceGroup: rg.name,
        currentTags: current,
        requestedTags: requested,
        plan: { toAdd, toChange, unchanged },
        requiredPermission: { resourceFamily: 'resource-groups', operationClass: 'modify' },
        willChange: Object.keys(toAdd).length > 0 || Object.keys(toChange).length > 0,
    };
}

module.exports = { execute };
