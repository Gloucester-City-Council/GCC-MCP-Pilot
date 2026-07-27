/**
 * Static Web Apps family — read tools cover inventory, inspection,
 * diagnosis, and comparison; write tools cover create, application
 * settings, custom domains, and backend linking. No delete tool exists.
 *
 * SECURITY: no tool in this family ever calls staticSites.
 * listStaticSiteSecrets, and application-setting VALUES are never
 * fetched-and-returned by any tool — only setting NAMES ever leave this
 * family (see tools/static-web-apps/_shared.js).
 */

'use strict';

const list = require('./tools/static-web-apps/list');
const inspect = require('./tools/static-web-apps/inspect');
const diagnose = require('./tools/static-web-apps/diagnose');
const compare = require('./tools/static-web-apps/compare');
const createPlan = require('./tools/static-web-apps/create-plan');
const create = require('./tools/static-web-apps/create');
const settingsPlan = require('./tools/static-web-apps/settings-plan');
const settingsApply = require('./tools/static-web-apps/settings-apply');
const domainPlan = require('./tools/static-web-apps/domain-plan');
const domainApply = require('./tools/static-web-apps/domain-apply');
const backendLinkPlan = require('./tools/static-web-apps/backend-link-plan');
const backendLinkApply = require('./tools/static-web-apps/backend-link-apply');

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };

const INSTANCE_PROPERTY = {
    instance: { type: 'string', description: 'Registered instance name (see azure_instances_list), e.g. "azure-prod".' },
};
const RESOURCE_GROUP_TARGET = {
    ...INSTANCE_PROPERTY,
    resourceGroup: { type: 'string', description: 'Resource group name.' },
};
const SITE_TARGET = {
    ...RESOURCE_GROUP_TARGET,
    name: { type: 'string', description: 'Static Web App name.' },
};

const TOOLS = [
    {
        name: 'azure_static_web_apps_list',
        description: 'Lists Static Web Apps in a resource group with SKU, region, default hostname, repository linkage (URL + branch, never tokens), and tags.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...RESOURCE_GROUP_TARGET }, required: ['instance', 'resourceGroup'] },
    },
    {
        name: 'azure_static_web_app_inspect',
        description: '⭐ Full operational detail for a single Static Web App: SKU, region, repository linkage, deployment/staging environments, custom domains with certificate status, application setting NAMES only (never values), linked backend(s), and managed identity. Never fetches deployment tokens or secrets — not even redacted. Route configuration and identity-provider (auth) configuration live in the repo\'s staticwebapp.config.json and are reported as "not inspectable via ARM".',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...SITE_TARGET }, required: ['instance', 'resourceGroup', 'name'] },
    },
    {
        name: 'azure_static_web_app_diagnose',
        description: 'Deterministic checklist against a Static Web App: missing custom domain certificate, an app whose settings suggest it expects an API but has no linked backend, Free SKU sitting in a resource group tagged environment=production, and missing authentication/authorization role configuration.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...SITE_TARGET }, required: ['instance', 'resourceGroup', 'name'] },
    },
    {
        name: 'azure_static_web_app_compare',
        description: 'Compares two Static Web Apps (same or different instances) — SKU, region, custom domains, and application-setting-NAME drift only. Setting values are never fetched, so they can never appear in the diff.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                left: { type: 'object', properties: { ...SITE_TARGET }, required: ['instance', 'resourceGroup', 'name'] },
                right: { type: 'object', properties: { ...SITE_TARGET }, required: ['instance', 'resourceGroup', 'name'] },
            },
            required: ['left', 'right'],
        },
    },
    {
        name: 'azure_static_web_app_create_plan',
        description: 'Dry-run: validates a proposed Static Web App spec (name, resource group, location, SKU, repository) and returns a dependency-explicit plan (resource group existence, name conflict, optional follow-on steps for domain/backend/settings). Calls no write API.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...RESOURCE_GROUP_TARGET,
                name: { type: 'string', description: 'Static Web App name to create.' },
                location: { type: 'string', description: 'Azure region, e.g. "westeurope" (Static Web Apps are only available in a subset of regions).' },
                sku: { type: 'string', enum: ['Free', 'Standard'], description: 'Defaults to "Free".' },
                repositoryUrl: { type: 'string', description: 'GitHub/DevOps repository URL, if repo-integrated.' },
                branch: { type: 'string', description: 'Target branch. Defaults to "main".' },
            },
            required: ['instance', 'name', 'resourceGroup', 'location'],
        },
    },
    {
        name: 'azure_static_web_app_create',
        description: 'Creates a Static Web App. Fails with CONFLICT if one of that name already exists. A repositoryToken may be supplied as input to wire up GitHub Actions — it is never stored, logged, or returned by this tool. There is no delete tool for this family.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...RESOURCE_GROUP_TARGET,
                name: { type: 'string', description: 'Static Web App name to create.' },
                location: { type: 'string' },
                sku: { type: 'string', enum: ['Free', 'Standard'] },
                tags: { type: 'object', additionalProperties: { type: 'string' } },
                repositoryUrl: { type: 'string' },
                branch: { type: 'string' },
                repositoryToken: { type: 'string', description: 'GitHub repo token used only to set up the Actions workflow. Never echoed back.' },
                buildProperties: {
                    type: 'object',
                    properties: {
                        appLocation: { type: 'string' },
                        apiLocation: { type: 'string' },
                        outputLocation: { type: 'string' },
                    },
                },
            },
            required: ['instance', 'name', 'resourceGroup', 'location'],
        },
    },
    {
        name: 'azure_static_web_app_settings_plan',
        description: 'Dry-run: computes an add/change/unchanged diff for a proposed application settings update. The "current" side of the diff is setting NAMES only — existing values are never returned, even though they are read internally to classify the diff.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...SITE_TARGET, settings: { type: 'object', additionalProperties: { type: 'string' }, description: 'Proposed setting name/value pairs.' } },
            required: ['instance', 'resourceGroup', 'name', 'settings'],
        },
    },
    {
        name: 'azure_static_web_app_settings_apply',
        description: 'Applies an application settings update computed by azure_static_web_app_settings_plan. Merges with existing settings (settings not mentioned are preserved) — existing values are used only to build the write payload and are never returned.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...SITE_TARGET, settings: { type: 'object', additionalProperties: { type: 'string' } } },
            required: ['instance', 'resourceGroup', 'name', 'settings'],
        },
    },
    {
        name: 'azure_static_web_app_domain_plan',
        description: 'Dry-run: validates a proposed custom domain against the Static Web App\'s current domains and infers the required validation method (DNS TXT for apex domains, CNAME delegation for subdomains). Calls no write API.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...SITE_TARGET, domainName: { type: 'string' } },
            required: ['instance', 'resourceGroup', 'name', 'domainName'],
        },
    },
    {
        name: 'azure_static_web_app_domain_apply',
        description: 'Applies a custom domain binding computed by azure_static_web_app_domain_plan.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...SITE_TARGET, domainName: { type: 'string' }, validationMethod: { type: 'string', enum: ['dns-txt-token', 'cname-delegation'] } },
            required: ['instance', 'resourceGroup', 'name', 'domainName'],
        },
    },
    {
        name: 'azure_static_web_app_backend_link_plan',
        description: 'Dry-run: validates linking a Function App as a Static Web App\'s backend (existence check, conflict check) and returns a dependency-explicit plan including the backend\'s resourceId. Calls no write API.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...SITE_TARGET,
                functionApp: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        resourceGroup: { type: 'string', description: 'Defaults to the Static Web App\'s own resource group.' },
                        resourceId: { type: 'string', description: 'Explicit override — skips the existence check.' },
                    },
                },
                linkedBackendName: { type: 'string', description: 'Defaults to the Function App name.' },
                region: { type: 'string', description: 'Defaults to the Static Web App\'s region.' },
            },
            required: ['instance', 'resourceGroup', 'name', 'functionApp'],
        },
    },
    {
        name: 'azure_static_web_app_backend_link_apply',
        description: '⭐ Links a Function App as a Static Web App\'s backend — the cross-resource linkage the Estate MCP\'s relationships tooling reads to connect the two resources. Returns the linked Function App\'s resourceId.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...SITE_TARGET,
                functionApp: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        resourceGroup: { type: 'string' },
                        resourceId: { type: 'string' },
                    },
                },
                linkedBackendName: { type: 'string' },
                region: { type: 'string' },
            },
            required: ['instance', 'resourceGroup', 'name', 'functionApp'],
        },
    },
];

const TOOL_HANDLERS = {
    azure_static_web_apps_list: list.execute,
    azure_static_web_app_inspect: inspect.execute,
    azure_static_web_app_diagnose: diagnose.execute,
    azure_static_web_app_compare: compare.execute,
    azure_static_web_app_create_plan: createPlan.execute,
    azure_static_web_app_create: create.execute,
    azure_static_web_app_settings_plan: settingsPlan.execute,
    azure_static_web_app_settings_apply: settingsApply.execute,
    azure_static_web_app_domain_plan: domainPlan.execute,
    azure_static_web_app_domain_apply: domainApply.execute,
    azure_static_web_app_backend_link_plan: backendLinkPlan.execute,
    azure_static_web_app_backend_link_apply: backendLinkApply.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
