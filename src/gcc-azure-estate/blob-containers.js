/**
 * Blob Containers family — container-level metadata and policy only:
 * public access, immutability, legal holds, stored access policies,
 * metadata, lifecycle-rule coverage, and soft-delete/versioning
 * inheritance from the account. Never reads or writes blob content — no
 * blob-level listing, download, or upload anywhere in this family. No
 * delete tool exists.
 */

'use strict';

const list = require('./tools/blob-containers/list');
const inspect = require('./tools/blob-containers/inspect');
const diagnose = require('./tools/blob-containers/diagnose');
const createPlan = require('./tools/blob-containers/create-plan');
const create = require('./tools/blob-containers/create');
const policyPlan = require('./tools/blob-containers/policy-plan');
const policyApply = require('./tools/blob-containers/policy-apply');

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };

const INSTANCE_PROPERTY = {
    instance: { type: 'string', description: 'Registered instance name (see azure_instances_list), e.g. "azure-prod".' },
};
const ACCOUNT_TARGET = {
    ...INSTANCE_PROPERTY,
    resourceGroup: { type: 'string', description: 'Resource group name.' },
    storageAccount: { type: 'string', description: 'Storage account name.' },
};
const CONTAINER_TARGET = {
    ...ACCOUNT_TARGET,
    name: { type: 'string', description: 'Container name.' },
};
const STORED_ACCESS_POLICIES_SCHEMA = {
    type: 'array',
    description: 'Stored access policies to add or change, by id. Policies not listed here are left untouched.',
    items: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            permissions: { type: 'string', description: 'e.g. "rwdl".' },
            startsOn: { type: 'string', description: 'ISO 8601 timestamp.' },
            expiresOn: { type: 'string', description: 'ISO 8601 timestamp.' },
        },
        required: ['id'],
    },
};

const TOOLS = [
    {
        name: 'azure_blob_containers_list',
        description: 'Lists containers in a storage account: name, public access level, last-modified time, and metadata. Container-level metadata only — never lists or reads individual blobs.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...ACCOUNT_TARGET }, required: ['instance', 'resourceGroup', 'storageAccount'] },
    },
    {
        name: 'azure_blob_container_inspect',
        description: 'Detail for a single container: public access level, immutability policy status, legal holds, stored access policy names, metadata, soft-delete/versioning inheritance from the account, and lifecycle-rule coverage. Never reads blob content.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...CONTAINER_TARGET }, required: ['instance', 'resourceGroup', 'storageAccount', 'name'] },
    },
    {
        name: 'azure_blob_container_diagnose',
        description: 'Deterministic checks against a container: public access level not "None" (containers should default private), no lifecycle-rule coverage, and legal hold present (informational).',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...CONTAINER_TARGET }, required: ['instance', 'resourceGroup', 'storageAccount', 'name'] },
    },
    {
        name: 'azure_blob_container_create_plan',
        description: 'Dry-run: validates a proposed container name against Azure\'s naming rules and checks for a name collision in the storage account, without creating anything.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...CONTAINER_TARGET, publicAccess: { type: 'string', enum: ['None', 'Blob', 'Container'] } },
            required: ['instance', 'resourceGroup', 'storageAccount', 'name'],
        },
    },
    {
        name: 'azure_blob_container_create',
        description: 'Creates a container in a storage account. Fails with CONFLICT if one of that name already exists. There is no container deletion tool, and this never touches blob content.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...CONTAINER_TARGET,
                publicAccess: { type: 'string', enum: ['None', 'Blob', 'Container'] },
                metadata: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['instance', 'resourceGroup', 'storageAccount', 'name'],
        },
    },
    {
        name: 'azure_blob_container_policy_plan',
        description: 'Dry-run: computes what a container-level policy change (public access level and/or stored access policies) would add/change/leave unchanged, without applying it.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...CONTAINER_TARGET,
                publicAccess: { type: 'string', enum: ['None', 'Blob', 'Container'] },
                storedAccessPolicies: STORED_ACCESS_POLICIES_SCHEMA,
            },
            required: ['instance', 'resourceGroup', 'storageAccount', 'name'],
        },
    },
    {
        name: 'azure_blob_container_policy_apply',
        description: 'Applies a container-level policy change computed by azure_blob_container_policy_plan: public access level and/or stored access policies. Policies not mentioned are left untouched.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...CONTAINER_TARGET,
                publicAccess: { type: 'string', enum: ['None', 'Blob', 'Container'] },
                storedAccessPolicies: STORED_ACCESS_POLICIES_SCHEMA,
            },
            required: ['instance', 'resourceGroup', 'storageAccount', 'name'],
        },
    },
];

const TOOL_HANDLERS = {
    azure_blob_containers_list: list.execute,
    azure_blob_container_inspect: inspect.execute,
    azure_blob_container_diagnose: diagnose.execute,
    azure_blob_container_create_plan: createPlan.execute,
    azure_blob_container_create: create.execute,
    azure_blob_container_policy_plan: policyPlan.execute,
    azure_blob_container_policy_apply: policyApply.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
