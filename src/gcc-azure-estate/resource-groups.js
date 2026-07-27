/**
 * Resource Groups family — read tools treat the resource group as an
 * operational boundary (list/inspect/inventory/compare/diagnose); write
 * tools cover create and tag management only. No delete tool exists.
 */

'use strict';

const list = require('./tools/resource-groups/list');
const inspect = require('./tools/resource-groups/inspect');
const inventory = require('./tools/resource-groups/inventory');
const compare = require('./tools/resource-groups/compare');
const diagnose = require('./tools/resource-groups/diagnose');
const create = require('./tools/resource-groups/create');
const tagsPlan = require('./tools/resource-groups/tags-plan');
const tagsApply = require('./tools/resource-groups/tags-apply');

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };

const INSTANCE_PROPERTY = {
    instance: { type: 'string', description: 'Registered instance name (see azure_instances_list), e.g. "azure-prod".' },
};
const RESOURCE_GROUP_TARGET = {
    ...INSTANCE_PROPERTY,
    resourceGroup: { type: 'string', description: 'Resource group name.' },
};

const TOOLS = [
    {
        name: 'azure_resource_groups_list',
        description: 'Lists all resource groups in an instance\'s subscription with location, tags, and provisioning state.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...INSTANCE_PROPERTY }, required: ['instance'] },
    },
    {
        name: 'azure_resource_group_inspect',
        description: 'Basic detail for a single resource group (location, tags, provisioning state, resource count). For the full summarised operational view use azure_resource_group_inventory.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...RESOURCE_GROUP_TARGET }, required: ['instance', 'resourceGroup'] },
    },
    {
        name: 'azure_resource_group_inventory',
        description: '⭐ Treats the resource group as an operational boundary. Summarises resources by type, region, tags, and managed identities; flags cross-region deployment, orphaned resources (e.g. a storage account no Function App references), and resource types outside this MCP\'s tracked families. Example: "Inspect everything in the Difference Engine resource group and tell me what is misconfigured" — call this first, then azure_resource_group_diagnose for deterministic findings.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...RESOURCE_GROUP_TARGET }, required: ['instance', 'resourceGroup'] },
    },
    {
        name: 'azure_resource_group_compare',
        description: 'Compares two resource groups (same or different instances) — typically the same logical environment across azure-prod vs a second instance. Flags resources present on one side but absent from the other, plus tag/region drift.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                left: { type: 'object', properties: { ...RESOURCE_GROUP_TARGET }, required: ['instance', 'resourceGroup'] },
                right: { type: 'object', properties: { ...RESOURCE_GROUP_TARGET }, required: ['instance', 'resourceGroup'] },
            },
            required: ['left', 'right'],
        },
    },
    {
        name: 'azure_resource_group_diagnose',
        description: 'Deterministic checks against a resource group: location metadata, required tags, naming convention, resource count, unexpected resource types, cross-region deployment, orphaned resources, diagnostic-settings coverage, policy compliance (where available), and environment classification.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...RESOURCE_GROUP_TARGET }, required: ['instance', 'resourceGroup'] },
    },
    {
        name: 'azure_resource_group_create',
        description: 'Creates a resource group. Fails with CONFLICT if one of that name already exists. There is no resource-group deletion tool — deletion is too broad and destructive to expose here.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...INSTANCE_PROPERTY,
                name: { type: 'string', description: 'Resource group name to create.' },
                location: { type: 'string', description: 'Azure region, e.g. "uksouth".' },
                tags: { type: 'object', additionalProperties: { type: 'string' }, description: 'Tags to apply at creation.' },
            },
            required: ['instance', 'name', 'location'],
        },
    },
    {
        name: 'azure_resource_group_tags_plan',
        description: 'Dry-run: computes what a tag update would add/change on a resource group without applying it.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...RESOURCE_GROUP_TARGET, tags: { type: 'object', additionalProperties: { type: 'string' } } },
            required: ['instance', 'resourceGroup', 'tags'],
        },
    },
    {
        name: 'azure_resource_group_tags_apply',
        description: 'Applies a tag update to a resource group. Merges with existing tags — tags not mentioned are left untouched.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...RESOURCE_GROUP_TARGET, tags: { type: 'object', additionalProperties: { type: 'string' } } },
            required: ['instance', 'resourceGroup', 'tags'],
        },
    },
];

const TOOL_HANDLERS = {
    azure_resource_groups_list: list.execute,
    azure_resource_group_inspect: inspect.execute,
    azure_resource_group_inventory: inventory.execute,
    azure_resource_group_compare: compare.execute,
    azure_resource_group_diagnose: diagnose.execute,
    azure_resource_group_create: create.execute,
    azure_resource_group_tags_plan: tagsPlan.execute,
    azure_resource_group_tags_apply: tagsApply.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
