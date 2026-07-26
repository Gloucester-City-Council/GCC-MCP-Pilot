/**
 * Tool: azure_function_app_identity_apply
 *
 * Applies a managed identity change computed by
 * azure_function_app_identity_plan (SystemAssigned and/or UserAssigned).
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

function computeDesiredType(systemAssigned, userAssignedResourceIds) {
    const hasUserAssigned = !!(userAssignedResourceIds && userAssignedResourceIds.length > 0);
    if (systemAssigned && hasUserAssigned) return 'SystemAssigned, UserAssigned';
    if (systemAssigned) return 'SystemAssigned';
    if (hasUserAssigned) return 'UserAssigned';
    return 'None';
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'identity');
    const client = getWebSiteClient(instance);

    try {
        await client.webApps.get(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Function App "${args.name}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const desiredType = computeDesiredType(!!args.systemAssigned, args.userAssignedResourceIds);
    const identity = { type: desiredType };
    if (desiredType.includes('UserAssigned')) {
        identity.userAssignedIdentities = Object.fromEntries((args.userAssignedResourceIds || []).map((id) => [id, {}]));
    }

    const updated = await client.webApps.update(args.resourceGroup, args.name, { identity });

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        identity: {
            type: (updated.identity && updated.identity.type) || 'None',
            principalId: (updated.identity && updated.identity.principalId) || null,
            userAssignedResourceIds: Object.keys((updated.identity && updated.identity.userAssignedIdentities) || {}),
        },
    };
}

module.exports = { execute };
