/**
 * Storage Accounts family — account-level configuration, replication,
 * network exposure, encryption, and diagnostics. Container-level metadata
 * and policy live in the separate blob-containers family. No delete tool
 * exists for either family.
 */

'use strict';

const list = require('./tools/storage-accounts/list');
const inspect = require('./tools/storage-accounts/inspect');
const diagnose = require('./tools/storage-accounts/diagnose');
const compare = require('./tools/storage-accounts/compare');
const createPlan = require('./tools/storage-accounts/create-plan');
const create = require('./tools/storage-accounts/create');
const configPlan = require('./tools/storage-accounts/config-plan');
const configApply = require('./tools/storage-accounts/config-apply');

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };

const INSTANCE_PROPERTY = {
    instance: { type: 'string', description: 'Registered instance name (see azure_instances_list), e.g. "azure-prod".' },
};
const ACCOUNT_TARGET = {
    ...INSTANCE_PROPERTY,
    resourceGroup: { type: 'string', description: 'Resource group name.' },
    name: { type: 'string', description: 'Storage account name.' },
};
const CONFIG_SCHEMA = {
    type: 'object',
    properties: {
        minimumTlsVersion: { type: 'string', enum: ['TLS1_0', 'TLS1_1', 'TLS1_2', 'TLS1_3'] },
        allowSharedKeyAccess: { type: 'boolean' },
        publicNetworkAccess: { type: 'string', enum: ['Enabled', 'Disabled', 'SecuredByPerimeter'] },
        httpsOnly: { type: 'boolean' },
    },
    additionalProperties: false,
};

const TOOLS = [
    {
        name: 'azure_storage_accounts_list',
        description: 'Lists storage accounts in an instance\'s subscription (optionally filtered to one resource group) with kind, SKU, access tier, and provisioning state.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...INSTANCE_PROPERTY, resourceGroup: { type: 'string', description: 'Optional — restrict the list to this resource group.' } },
            required: ['instance'],
        },
    },
    {
        name: 'azure_storage_account_inspect',
        description: 'Full configuration detail for a single storage account: kind, performance tier, replication, access tier, public network access, shared-key access, minimum TLS, HTTPS-only, network firewall rules, private endpoint connections, managed identity, encryption, blob soft-delete/versioning, lifecycle-management rule count, and diagnostic settings.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...ACCOUNT_TARGET }, required: ['instance', 'resourceGroup', 'name'] },
    },
    {
        name: 'azure_storage_account_diagnose',
        description: 'Deterministic checks against a storage account: public network access with no firewall rules, shared-key access left enabled, minimum TLS below 1.2, HTTPS-only disabled, blob soft delete disabled, versioning disabled, and missing diagnostic settings.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...ACCOUNT_TARGET }, required: ['instance', 'resourceGroup', 'name'] },
    },
    {
        name: 'azure_storage_account_compare',
        description: 'Compares two storage accounts (same or different instances). Diffs SKU, kind, access tier, minimum TLS, public network access, and firewall rule count.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                left: { type: 'object', properties: { ...ACCOUNT_TARGET }, required: ['instance', 'resourceGroup', 'name'] },
                right: { type: 'object', properties: { ...ACCOUNT_TARGET }, required: ['instance', 'resourceGroup', 'name'] },
            },
            required: ['left', 'right'],
        },
    },
    {
        name: 'azure_storage_account_create_plan',
        description: 'Dry-run: validates a proposed sku/kind/accessTier combination and checks for a name collision (storage account names are globally unique across Azure) without creating anything.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...ACCOUNT_TARGET,
                location: { type: 'string', description: 'Azure region, e.g. "uksouth".' },
                sku: { type: 'string', description: 'SKU name, e.g. "Standard_LRS", "Standard_GRS", "Premium_LRS".' },
                kind: { type: 'string', enum: ['Storage', 'StorageV2', 'BlobStorage', 'FileStorage', 'BlockBlobStorage'] },
                accessTier: { type: 'string', enum: ['Hot', 'Cool', 'Cold'] },
            },
            required: ['instance', 'resourceGroup', 'name', 'location', 'sku', 'kind'],
        },
    },
    {
        name: 'azure_storage_account_create',
        description: 'Creates a storage account. Fails with CONFLICT if one already exists in the resource group, or BAD_REQUEST if the sku/kind/accessTier combination is invalid. There is no storage-account deletion tool.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...ACCOUNT_TARGET,
                location: { type: 'string', description: 'Azure region, e.g. "uksouth".' },
                sku: { type: 'string', description: 'SKU name, e.g. "Standard_LRS", "Standard_GRS", "Premium_LRS".' },
                kind: { type: 'string', enum: ['Storage', 'StorageV2', 'BlobStorage', 'FileStorage', 'BlockBlobStorage'] },
                accessTier: { type: 'string', enum: ['Hot', 'Cool', 'Cold'] },
                tags: { type: 'object', additionalProperties: { type: 'string' } },
                minimumTlsVersion: { type: 'string', enum: ['TLS1_0', 'TLS1_1', 'TLS1_2', 'TLS1_3'] },
                allowSharedKeyAccess: { type: 'boolean' },
                httpsOnly: { type: 'boolean' },
                publicNetworkAccess: { type: 'string', enum: ['Enabled', 'Disabled', 'SecuredByPerimeter'] },
            },
            required: ['instance', 'resourceGroup', 'name', 'location', 'sku', 'kind'],
        },
    },
    {
        name: 'azure_storage_account_config_plan',
        description: 'Dry-run: computes what an account-level configuration update (minTlsVersion, allowSharedKeyAccess, publicNetworkAccess, httpsOnly) would add/change on a storage account without applying it.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...ACCOUNT_TARGET, config: CONFIG_SCHEMA },
            required: ['instance', 'resourceGroup', 'name', 'config'],
        },
    },
    {
        name: 'azure_storage_account_config_apply',
        description: 'Applies an account-level configuration update (minTlsVersion, allowSharedKeyAccess, publicNetworkAccess, httpsOnly) computed by azure_storage_account_config_plan.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...ACCOUNT_TARGET, config: CONFIG_SCHEMA },
            required: ['instance', 'resourceGroup', 'name', 'config'],
        },
    },
];

const TOOL_HANDLERS = {
    azure_storage_accounts_list: list.execute,
    azure_storage_account_inspect: inspect.execute,
    azure_storage_account_diagnose: diagnose.execute,
    azure_storage_account_compare: compare.execute,
    azure_storage_account_create_plan: createPlan.execute,
    azure_storage_account_create: create.execute,
    azure_storage_account_config_plan: configPlan.execute,
    azure_storage_account_config_apply: configApply.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
