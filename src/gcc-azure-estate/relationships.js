/**
 * Cross-resource relationships — this is where the Estate MCP becomes
 * more valuable than separate Azure wrappers. Understands: Function App
 * -> Storage Account -> Application Insights -> Managed Identity ->
 * Cosmos DB -> Static Web App backend.
 */

'use strict';

const resourceDependencies = require('./tools/relationships/resource-dependencies');
const resourceGroupTopology = require('./tools/relationships/resource-group-topology');
const applicationStackInspect = require('./tools/relationships/application-stack-inspect');
const applicationStackDiagnose = require('./tools/relationships/application-stack-diagnose');
const applicationStackCompare = require('./tools/relationships/application-stack-compare');

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };

const INSTANCE_PROPERTY = { instance: { type: 'string', description: 'Registered instance name (see azure_instances_list).' } };
const NAMED_COMPONENTS_PROPERTIES = {
    ...INSTANCE_PROPERTY,
    resourceGroup: { type: 'string', description: 'Resource group name.' },
    functionApp: { type: 'string', description: 'Function App name, if this stack has one.' },
    staticWebApp: { type: 'string', description: 'Static Web App name, if this stack has one.' },
    storageAccount: { type: 'string', description: 'Storage account name, if this stack has one.' },
    cosmosAccount: { type: 'string', description: 'Cosmos DB account name, if this stack has one.' },
};

const TOOLS = [
    {
        name: 'azure_resource_dependencies',
        description: 'Outbound dependency edges for a single named resource (Function App -> Storage/App Insights/Managed Identity/Cosmos DB, or Static Web App -> backend Function App). For the whole resource-group graph use azure_resource_group_topology.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...INSTANCE_PROPERTY,
                resourceGroup: { type: 'string' },
                resourceType: { type: 'string', enum: ['functionApp', 'staticWebApp'] },
                resourceName: { type: 'string' },
            },
            required: ['instance', 'resourceGroup', 'resourceType', 'resourceName'],
        },
    },
    {
        name: 'azure_resource_group_topology',
        description: 'Whole-resource-group dependency graph: every resource as a node, plus the edges between Function Apps, Storage Accounts, Cosmos DB accounts, and Static Web App backend links found in that group.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...INSTANCE_PROPERTY, resourceGroup: { type: 'string' } }, required: ['instance', 'resourceGroup'] },
    },
    {
        name: 'azure_application_stack_inspect',
        description: 'Inspects a named application stack (explicit resource names — Function App, Static Web App, Storage Account, Cosmos Account) and the dependency edges between them. For a full YAML-contract-driven build, see azure_stack_plan/create/verify.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...NAMED_COMPONENTS_PROPERTIES }, required: ['instance', 'resourceGroup'] },
    },
    {
        name: 'azure_application_stack_diagnose',
        description: 'Runs each named component\'s own *_diagnose tool plus relationship health checks (e.g. does the Function App\'s storage dependency actually resolve to the named storage account).',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...NAMED_COMPONENTS_PROPERTIES }, required: ['instance', 'resourceGroup'] },
    },
    {
        name: 'azure_application_stack_compare',
        description: 'Compares a named application stack across two targets (e.g. azure-prod vs a second instance) — each declared component present on both sides is diffed via that family\'s own *_compare tool; components declared on only one side are flagged.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                left: { type: 'object', properties: { ...NAMED_COMPONENTS_PROPERTIES }, required: ['instance', 'resourceGroup'] },
                right: { type: 'object', properties: { ...NAMED_COMPONENTS_PROPERTIES }, required: ['instance', 'resourceGroup'] },
            },
            required: ['left', 'right'],
        },
    },
];

const TOOL_HANDLERS = {
    azure_resource_dependencies: resourceDependencies.execute,
    azure_resource_group_topology: resourceGroupTopology.execute,
    azure_application_stack_inspect: applicationStackInspect.execute,
    azure_application_stack_diagnose: applicationStackDiagnose.execute,
    azure_application_stack_compare: applicationStackCompare.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
