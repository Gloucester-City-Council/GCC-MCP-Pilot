/**
 * Tool: azure_static_web_app_create_plan
 *
 * Validates a proposed Static Web App spec and returns a dependency
 * explicit plan — the resource group must exist first, the name must not
 * already be taken, and any follow-on configuration (custom domain,
 * backend link, application settings) is called out as a separate,
 * ordered step with its own tool. No write API is called.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient, getResourceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

const ALLOWED_SKUS = ['Free', 'Standard'];

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'name', 'resourceGroup', 'location']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'static-web-apps', 'plan');
    const webSiteClient = getWebSiteClient(instance);
    const resourceClient = getResourceClient(instance);

    const sku = args.sku || 'Free';
    const skuValid = ALLOWED_SKUS.includes(sku);

    let resourceGroupExists = false;
    try {
        await resourceClient.resourceGroups.get(args.resourceGroup);
        resourceGroupExists = true;
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }

    let nameConflict = false;
    if (resourceGroupExists) {
        try {
            await webSiteClient.staticSites.getStaticSite(args.resourceGroup, args.name);
            nameConflict = true;
        } catch (err) {
            if (err.statusCode !== 404) throw err;
        }
    }

    const steps = [
        {
            step: 1,
            action: 'Ensure resource group exists',
            resourceGroup: args.resourceGroup,
            status: resourceGroupExists ? 'satisfied' : 'missing',
            note: resourceGroupExists ? undefined : `Resource group "${args.resourceGroup}" does not exist — create it first (azure_resource_group_create).`,
        },
        {
            step: 2,
            action: 'Create the Static Web App resource',
            tool: 'azure_static_web_app_create',
            dependsOn: [1],
            status: nameConflict ? 'blocked' : 'ready',
            note: nameConflict ? `A Static Web App named "${args.name}" already exists in "${args.resourceGroup}".` : undefined,
        },
        {
            step: 3,
            action: 'Optionally attach a custom domain',
            tool: 'azure_static_web_app_domain_plan / azure_static_web_app_domain_apply',
            dependsOn: [2],
            status: 'optional',
        },
        {
            step: 4,
            action: 'Optionally link a Function App backend',
            tool: 'azure_static_web_app_backend_link_plan / azure_static_web_app_backend_link_apply',
            dependsOn: [2],
            status: 'optional',
        },
        {
            step: 5,
            action: 'Optionally set application settings',
            tool: 'azure_static_web_app_settings_plan / azure_static_web_app_settings_apply',
            dependsOn: [2],
            status: 'optional',
        },
    ];

    const blockers = [];
    if (!resourceGroupExists) blockers.push(`resourceGroup "${args.resourceGroup}" does not exist`);
    if (nameConflict) blockers.push(`a Static Web App named "${args.name}" already exists in "${args.resourceGroup}"`);
    if (!skuValid) blockers.push(`sku "${sku}" is not one of ${ALLOWED_SKUS.join(', ')}`);

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        location: args.location,
        sku,
        repositoryUrl: args.repositoryUrl || null,
        branch: args.branch || 'main',
        canCreate: blockers.length === 0,
        blockers,
        steps,
        requiredPermission: { resourceFamily: 'static-web-apps', operationClass: 'create' },
        note: args.repositoryUrl
            ? 'A repositoryToken is required by Azure to wire up GitHub Actions for this repo. Supply it directly to azure_static_web_app_create — this MCP never stores, logs, or returns it.'
            : undefined,
    };
}

module.exports = { execute };
