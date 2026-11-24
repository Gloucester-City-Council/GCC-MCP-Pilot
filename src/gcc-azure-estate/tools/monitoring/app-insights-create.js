/**
 * Tool: azure_app_insights_create
 *
 * Creates a workspace-based Application Insights component linked to an
 * existing Log Analytics workspace. Classic (workspace-less) components
 * are deprecated and are not offered. Fails with CONFLICT if it exists.
 * The connection string is not returned; link it with the function-app
 * create/settings tools.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getAppInsightsClient, getOperationalInsightsClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'location', 'workspaceName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'monitoring', 'create');
    const client = getAppInsightsClient(instance);
    const wsClient = getOperationalInsightsClient(instance);
    const workspaceResourceGroup = args.workspaceResourceGroup || args.resourceGroup;

    let workspace;
    try {
        workspace = await wsClient.workspaces.get(workspaceResourceGroup, args.workspaceName);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(
                ERROR_CODES.DEPENDENCY_MISSING,
                `Log Analytics workspace "${args.workspaceName}" not found in resource group "${workspaceResourceGroup}". Create it first with azure_log_analytics_workspace_create.`,
                { workspaceName: args.workspaceName, workspaceResourceGroup }
            );
        }
        throw err;
    }

    let existing = null;
    try {
        existing = await client.components.get(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    if (existing) {
        throw new AzureEstateError(
            ERROR_CODES.CONFLICT,
            `Application Insights "${args.name}" already exists in resource group "${args.resourceGroup}" (instance "${instance.name}")`
        );
    }

    const component = await client.components.createOrUpdate(args.resourceGroup, args.name, {
        location: args.location,
        kind: 'web',
        applicationType: 'web',
        workspaceResourceId: workspace.id,
        tags: args.tags || {},
    });

    return {
        created: true,
        name: component.name || args.name,
        resourceGroup: args.resourceGroup,
        location: component.location || args.location,
        workspaceResourceId: workspace.id,
        connectionStringAvailable: Boolean(component.connectionString),
    };
}

module.exports = { execute };
