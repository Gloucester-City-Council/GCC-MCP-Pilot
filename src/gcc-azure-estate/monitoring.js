/**
 * Monitoring family — creates the Log Analytics workspace and
 * workspace-based Application Insights component that Function Apps log
 * to. Create-only: no delete tool exists.
 */

'use strict';

const workspaceCreate = require('./tools/monitoring/workspace-create');
const appInsightsCreate = require('./tools/monitoring/app-insights-create');

const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };

const TARGET = {
    instance: { type: 'string', description: 'Registered instance name (see azure_instances_list), e.g. "azure-prod".' },
    resourceGroup: { type: 'string', description: 'Resource group name.' },
};

const TOOLS = [
    {
        name: 'azure_log_analytics_workspace_create',
        description: 'Creates a Log Analytics workspace (PerGB2018). Fails with CONFLICT if one of that name exists. Needed before azure_app_insights_create.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...TARGET,
                name: { type: 'string', description: 'Workspace name.' },
                location: { type: 'string', description: 'Azure region, e.g. "uksouth".' },
                retentionInDays: { type: 'number', description: 'Data retention in days. Default 30.' },
                tags: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['instance', 'resourceGroup', 'name', 'location'],
        },
    },
    {
        name: 'azure_app_insights_create',
        description: 'Creates a workspace-based Application Insights component linked to an existing Log Analytics workspace. Fails with DEPENDENCY_MISSING if the workspace is absent and CONFLICT if the component exists. Does not return the connection string.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...TARGET,
                name: { type: 'string', description: 'Application Insights name.' },
                location: { type: 'string', description: 'Azure region, e.g. "uksouth".' },
                workspaceName: { type: 'string', description: 'Name of the existing Log Analytics workspace to link.' },
                workspaceResourceGroup: { type: 'string', description: 'Resource group of the workspace, if different from `resourceGroup`.' },
                tags: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['instance', 'resourceGroup', 'name', 'location', 'workspaceName'],
        },
    },
];

const TOOL_HANDLERS = {
    azure_log_analytics_workspace_create: workspaceCreate.execute,
    azure_app_insights_create: appInsightsCreate.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
