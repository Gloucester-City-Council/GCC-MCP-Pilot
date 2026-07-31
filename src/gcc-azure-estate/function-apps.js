/**
 * Function Apps family — read tools treat a Function App as the
 * operational unit (list/inspect/inventory/compare/diagnose); write tools
 * cover create, app-settings, identity, site config, and deployment
 * slots. No delete tool exists, and this family never performs a
 * data-plane code deploy — configuration/administration only.
 */

'use strict';

const list = require('./tools/function-apps/list');
const inspect = require('./tools/function-apps/inspect');
const inventory = require('./tools/function-apps/inventory');
const diagnose = require('./tools/function-apps/diagnose');
const compare = require('./tools/function-apps/compare');
const createPlan = require('./tools/function-apps/create-plan');
const create = require('./tools/function-apps/create');
const settingsPlan = require('./tools/function-apps/settings-plan');
const settingsApply = require('./tools/function-apps/settings-apply');
const identityPlan = require('./tools/function-apps/identity-plan');
const identityApply = require('./tools/function-apps/identity-apply');
const configPlan = require('./tools/function-apps/config-plan');
const configApply = require('./tools/function-apps/config-apply');
const slotCreate = require('./tools/function-apps/slot-create');
const slotSwapPlan = require('./tools/function-apps/slot-swap-plan');
const slotSwap = require('./tools/function-apps/slot-swap');
const logsQuery = require('./tools/function-apps/logs-query');
const logsRecentErrors = require('./tools/function-apps/logs-recent-errors');

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };

const INSTANCE_PROPERTY = {
    instance: { type: 'string', description: 'Registered instance name (see azure_instances_list), e.g. "azure-prod".' },
};
const RESOURCE_GROUP_TARGET = {
    ...INSTANCE_PROPERTY,
    resourceGroup: { type: 'string', description: 'Resource group name.' },
};
const FUNCTION_APP_TARGET = {
    ...RESOURCE_GROUP_TARGET,
    name: { type: 'string', description: 'Function App name.' },
};
const FUNCTION_APP_SIDE = { type: 'object', properties: { ...FUNCTION_APP_TARGET }, required: ['instance', 'resourceGroup', 'name'] };
const APP_INSIGHTS_OVERRIDE_PROPERTIES = {
    appInsightsName: { type: 'string', description: 'Application Insights resource name, if it can\'t be auto-resolved from the Function App\'s own instrumentation key/connection string setting.' },
    appInsightsResourceGroup: { type: 'string', description: 'Resource group of the Application Insights resource, if it differs from the Function App\'s own resource group. Defaults to resourceGroup.' },
};

const TOOLS = [
    {
        name: 'azure_function_apps_list',
        description: 'Lists Function Apps in a resource group with name, location, kind, state, hostnames, and tags.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...RESOURCE_GROUP_TARGET }, required: ['instance', 'resourceGroup'] },
    },
    {
        name: 'azure_function_app_inspect',
        description: '⭐ Deep single-app detail: runtime + Node version, OS/architecture, hosting plan, deployment slot names, app-setting NAMES with a coarse secret/plain classification (never setting values), Key Vault reference detection, managed identity, storage dependency (account name only), Application Insights linkage, CORS, VNet integration, health check config, TLS/HTTPS-only, and scale/availability settings.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...FUNCTION_APP_TARGET }, required: ['instance', 'resourceGroup', 'name'] },
    },
    {
        name: 'azure_function_app_inventory',
        description: 'Summarises azure_function_app_inspect\'s view across every Function App in a resource group at once — runtime/OS/plan mix, and counts of apps missing Application Insights, missing managed identity, HTTPS-only disabled, CORS wildcard, or missing health check.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...RESOURCE_GROUP_TARGET }, required: ['instance', 'resourceGroup'] },
    },
    {
        name: 'azure_function_app_diagnose',
        description: 'Deterministic checklist for a single Function App: TLS minimum version below 1.2, HTTPS-only disabled, CORS wildcard, missing Application Insights, missing managed identity, unreachable storage account, missing health check path.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...FUNCTION_APP_TARGET }, required: ['instance', 'resourceGroup', 'name'] },
    },
    {
        name: 'azure_function_app_compare',
        description: 'Compares two Function Apps (same or different instances) — runtime/OS/hosting-plan drift plus an app-settings NAME diff. Values of secret-like settings are never compared, only whether the key exists on both sides.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { left: FUNCTION_APP_SIDE, right: FUNCTION_APP_SIDE },
            required: ['left', 'right'],
        },
    },
    {
        name: 'azure_function_app_create_plan',
        description: 'Validates a proposed Function App spec and returns a dependency-explicit plan (resource group, hosting plan, storage account, Application Insights, runtime, identity, app settings each marked present/missing) without calling any write API.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...FUNCTION_APP_TARGET,
                location: { type: 'string', description: 'Azure region, e.g. "uksouth".' },
                hostingPlanName: { type: 'string', description: 'Name of an existing App Service Plan this Function App will run on.' },
                hostingPlanResourceGroup: { type: 'string', description: 'Resource group of the hosting plan, if different from `resourceGroup`.' },
                storageAccountName: { type: 'string', description: 'Name of an existing storage account for AzureWebJobsStorage. This tool does not create one.' },
                storageAccountResourceGroup: { type: 'string', description: 'Resource group of the storage account, if different from `resourceGroup`.' },
                appInsightsName: { type: 'string', description: 'Name of an existing Application Insights resource to link. Optional but recommended.' },
                appInsightsResourceGroup: { type: 'string', description: 'Resource group of the Application Insights resource, if different from `resourceGroup`.' },
                runtime: {
                    type: 'object',
                    properties: { name: { type: 'string', description: 'e.g. "node", "dotnet", "dotnet-isolated", "python", "java", "powershell".' }, version: { type: 'string', description: 'e.g. "18", "8.0".' } },
                    required: ['name', 'version'],
                },
                osType: { type: 'string', enum: ['Linux', 'Windows'], description: 'Defaults to Linux if omitted.' },
                identity: { type: 'string', enum: ['None', 'SystemAssigned'], description: 'Managed identity to enable at creation time.' },
                appSettings: { type: 'object', additionalProperties: { type: 'string' }, description: 'Additional app settings to seed beyond the auto-configured storage/runtime/App Insights ones.' },
                tags: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['instance', 'resourceGroup', 'name', 'location'],
        },
    },
    {
        name: 'azure_function_app_create',
        description: 'Creates a Function App. The caller must supply an existing hosting plan, an existing storage account, and (optionally) an existing Application Insights resource — this tool provisions none of those and fails with DEPENDENCY_MISSING if a required one is absent. Use azure_function_app_create_plan first to check readiness.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...FUNCTION_APP_TARGET,
                location: { type: 'string' },
                hostingPlanName: { type: 'string' },
                hostingPlanResourceGroup: { type: 'string' },
                storageAccountName: { type: 'string' },
                storageAccountResourceGroup: { type: 'string' },
                appInsightsName: { type: 'string' },
                appInsightsResourceGroup: { type: 'string' },
                runtime: {
                    type: 'object',
                    properties: { name: { type: 'string' }, version: { type: 'string' } },
                    required: ['name', 'version'],
                },
                osType: { type: 'string', enum: ['Linux', 'Windows'] },
                identity: { type: 'string', enum: ['None', 'SystemAssigned'] },
                appSettings: { type: 'object', additionalProperties: { type: 'string' } },
                tags: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['instance', 'resourceGroup', 'name', 'location', 'hostingPlanName', 'storageAccountName'],
        },
    },
    {
        name: 'azure_function_app_settings_plan',
        description: 'Dry-run: computes what an app-settings update would add/change on a Function App without applying it. Secret-like setting values (by name) are never shown, even the caller\'s own requested value.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...FUNCTION_APP_TARGET, appSettings: { type: 'object', additionalProperties: { type: 'string' } } },
            required: ['instance', 'resourceGroup', 'name', 'appSettings'],
        },
    },
    {
        name: 'azure_function_app_settings_apply',
        description: 'Applies an app-settings update to a Function App. Merges with existing settings — settings not mentioned are left untouched.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...FUNCTION_APP_TARGET, appSettings: { type: 'object', additionalProperties: { type: 'string' } } },
            required: ['instance', 'resourceGroup', 'name', 'appSettings'],
        },
    },
    {
        name: 'azure_function_app_identity_plan',
        description: 'Dry-run: computes what enabling/changing managed identity (SystemAssigned and/or UserAssigned) would do, without applying it.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...FUNCTION_APP_TARGET,
                systemAssigned: { type: 'boolean' },
                userAssignedResourceIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['instance', 'resourceGroup', 'name'],
        },
    },
    {
        name: 'azure_function_app_identity_apply',
        description: 'Applies a managed identity change computed by azure_function_app_identity_plan.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...FUNCTION_APP_TARGET,
                systemAssigned: { type: 'boolean' },
                userAssignedResourceIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['instance', 'resourceGroup', 'name'],
        },
    },
    {
        name: 'azure_function_app_config_plan',
        description: 'Dry-run: computes what a site-config change (minTlsVersion, httpsOnly, corsAllowedOrigins, healthCheckPath, alwaysOn) would do, without applying it.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...FUNCTION_APP_TARGET,
                config: {
                    type: 'object',
                    properties: {
                        minTlsVersion: { type: 'string', enum: ['1.0', '1.1', '1.2', '1.3'] },
                        httpsOnly: { type: 'boolean' },
                        corsAllowedOrigins: { type: 'array', items: { type: 'string' } },
                        healthCheckPath: { type: 'string' },
                        alwaysOn: { type: 'boolean' },
                    },
                },
            },
            required: ['instance', 'resourceGroup', 'name', 'config'],
        },
    },
    {
        name: 'azure_function_app_config_apply',
        description: 'Applies a site-config change computed by azure_function_app_config_plan.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...FUNCTION_APP_TARGET,
                config: {
                    type: 'object',
                    properties: {
                        minTlsVersion: { type: 'string', enum: ['1.0', '1.1', '1.2', '1.3'] },
                        httpsOnly: { type: 'boolean' },
                        corsAllowedOrigins: { type: 'array', items: { type: 'string' } },
                        healthCheckPath: { type: 'string' },
                        alwaysOn: { type: 'boolean' },
                    },
                },
            },
            required: ['instance', 'resourceGroup', 'name', 'config'],
        },
    },
    {
        name: 'azure_function_slot_create',
        description: 'Creates a deployment slot on a Function App, cloning the parent app\'s location/kind/hosting plan and runtime-relevant siteConfig.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...FUNCTION_APP_TARGET, slotName: { type: 'string', description: 'Name of the new deployment slot.' } },
            required: ['instance', 'resourceGroup', 'name', 'slotName'],
        },
    },
    {
        name: 'azure_function_slot_swap_plan',
        description: 'Dry-run: describes what a deployment slot swap would do without performing it. `sourceSlot` is the slot being promoted; `targetSlot` defaults to "production".',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...FUNCTION_APP_TARGET,
                sourceSlot: { type: 'string' },
                targetSlot: { type: 'string', description: 'Defaults to "production".' },
                preserveVnet: { type: 'boolean', description: 'Defaults to true.' },
            },
            required: ['instance', 'resourceGroup', 'name', 'sourceSlot'],
        },
    },
    {
        name: 'azure_function_slot_swap',
        description: 'Performs a deployment slot swap computed by azure_function_slot_swap_plan.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...FUNCTION_APP_TARGET,
                sourceSlot: { type: 'string' },
                targetSlot: { type: 'string', description: 'Defaults to "production".' },
                preserveVnet: { type: 'boolean', description: 'Defaults to true.' },
            },
            required: ['instance', 'resourceGroup', 'name', 'sourceSlot'],
        },
    },
    {
        name: 'azure_function_app_logs_query',
        description: '⭐ Runs a caller-supplied KQL query against a Function App\'s linked Application Insights resource (traces, exceptions, requests, dependencies, customEvents). Bounded by a required timespanMinutes (max 7 days) and truncated to maxRows — never an unbounded query. Use azure_function_app_logs_recent_errors instead if you just want "what\'s been failing recently" without writing KQL.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...FUNCTION_APP_TARGET,
                query: { type: 'string', description: 'A KQL query, e.g. "requests | where success == false | order by timestamp desc".' },
                timespanMinutes: { type: 'number', description: 'How far back to query, in minutes. Required — never unbounded. Max 10080 (7 days).' },
                maxRows: { type: 'number', description: 'Maximum rows to return per table. Default 200, hard cap 500.' },
                ...APP_INSIGHTS_OVERRIDE_PROPERTIES,
            },
            required: ['instance', 'resourceGroup', 'name', 'query', 'timespanMinutes'],
        },
    },
    {
        name: 'azure_function_app_logs_recent_errors',
        description: 'Guided troubleshooting shortcut: recent exceptions and high-severity traces for a Function App, no KQL required. Runs a canned query against the app\'s linked Application Insights resource. For anything more specific, use azure_function_app_logs_query directly.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...FUNCTION_APP_TARGET,
                timespanMinutes: { type: 'number', description: 'How far back to look, in minutes. Default 60, max 10080 (7 days).' },
                maxRows: { type: 'number', description: 'Maximum entries to return. Default 50, hard cap 500.' },
                ...APP_INSIGHTS_OVERRIDE_PROPERTIES,
            },
            required: ['instance', 'resourceGroup', 'name'],
        },
    },
];

const TOOL_HANDLERS = {
    azure_function_apps_list: list.execute,
    azure_function_app_inspect: inspect.execute,
    azure_function_app_inventory: inventory.execute,
    azure_function_app_diagnose: diagnose.execute,
    azure_function_app_compare: compare.execute,
    azure_function_app_create_plan: createPlan.execute,
    azure_function_app_create: create.execute,
    azure_function_app_settings_plan: settingsPlan.execute,
    azure_function_app_settings_apply: settingsApply.execute,
    azure_function_app_identity_plan: identityPlan.execute,
    azure_function_app_identity_apply: identityApply.execute,
    azure_function_app_config_plan: configPlan.execute,
    azure_function_app_config_apply: configApply.execute,
    azure_function_slot_create: slotCreate.execute,
    azure_function_slot_swap_plan: slotSwapPlan.execute,
    azure_function_slot_swap: slotSwap.execute,
    azure_function_app_logs_query: logsQuery.execute,
    azure_function_app_logs_recent_errors: logsRecentErrors.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
