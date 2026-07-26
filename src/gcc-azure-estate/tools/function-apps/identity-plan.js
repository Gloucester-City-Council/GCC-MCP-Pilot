/**
 * Tool: azure_function_app_identity_plan
 *
 * Computes what enabling/changing managed identity would do, without
 * applying it.
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

    const instance = assertPermitted(args.instance, 'function-apps', 'plan');
    const client = getWebSiteClient(instance);

    let site;
    try {
        site = await client.webApps.get(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Function App "${args.name}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const currentType = (site.identity && site.identity.type) || 'None';
    const currentUserAssigned = Object.keys((site.identity && site.identity.userAssignedIdentities) || {});
    const desiredType = computeDesiredType(!!args.systemAssigned, args.userAssignedResourceIds);
    const desiredUserAssigned = args.userAssignedResourceIds || [];

    const userAssignedToAdd = desiredUserAssigned.filter((id) => !currentUserAssigned.includes(id));
    const userAssignedToRemove = currentUserAssigned.filter((id) => !desiredUserAssigned.includes(id));

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        current: { type: currentType, userAssignedResourceIds: currentUserAssigned },
        requested: { type: desiredType, userAssignedResourceIds: desiredUserAssigned },
        plan: { userAssignedToAdd, userAssignedToRemove, typeWillChange: currentType !== desiredType },
        requiredPermission: { resourceFamily: 'function-apps', operationClass: 'identity' },
        willChange: currentType !== desiredType || userAssignedToAdd.length > 0 || userAssignedToRemove.length > 0,
    };
}

module.exports = { execute };
