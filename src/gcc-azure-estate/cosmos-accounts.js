/**
 * Cosmos DB Accounts family — the top level of the Cosmos hierarchy
 * (Account -> Database -> Container). Read tools cover list/inspect/
 * diagnose/compare; write tools cover account creation and configuration
 * updates only. No delete tool exists — deleting a Cosmos account is too
 * destructive to expose here. All tools share the 'cosmos' permission
 * family with azure_cosmos_database_* and azure_cosmos_container_* (see
 * config/azure-instances.yaml) even though they are separate tool
 * families/files.
 */

'use strict';

const list = require('./tools/cosmos-accounts/list');
const inspect = require('./tools/cosmos-accounts/inspect');
const diagnose = require('./tools/cosmos-accounts/diagnose');
const compare = require('./tools/cosmos-accounts/compare');
const createPlan = require('./tools/cosmos-accounts/create-plan');
const create = require('./tools/cosmos-accounts/create');
const configPlan = require('./tools/cosmos-accounts/config-plan');
const configApply = require('./tools/cosmos-accounts/config-apply');

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };

const INSTANCE_PROPERTY = {
    instance: { type: 'string', description: 'Registered instance name (see azure_instances_list), e.g. "azure-prod".' },
};
const ACCOUNT_TARGET = {
    ...INSTANCE_PROPERTY,
    resourceGroup: { type: 'string', description: 'Resource group containing the Cosmos DB account.' },
    accountName: { type: 'string', description: 'Cosmos DB account name.' },
};

const CONSISTENCY_POLICY_SCHEMA = {
    type: 'object',
    properties: {
        defaultConsistencyLevel: { type: 'string', enum: ['Eventual', 'Session', 'BoundedStaleness', 'Strong', 'ConsistentPrefix'] },
        maxStalenessPrefix: { type: 'number' },
        maxIntervalInSeconds: { type: 'number' },
    },
    required: ['defaultConsistencyLevel'],
};

const REGIONS_SCHEMA = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            locationName: { type: 'string' },
            failoverPriority: { type: 'number' },
            isZoneRedundant: { type: 'boolean' },
        },
        required: ['locationName', 'failoverPriority'],
    },
    description: 'Ordered write/read regions. Failover priority 0 is the write region.',
};

const TOOLS = [
    {
        name: 'azure_cosmos_accounts_list',
        description: 'Lists Cosmos DB accounts — subscription-wide, or scoped to a resource group if one is given. Reports API type, capacity mode, consistency level, and region count per account.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...INSTANCE_PROPERTY, resourceGroup: { type: 'string', description: 'Optional — scope the list to a single resource group.' } },
            required: ['instance'],
        },
    },
    {
        name: 'azure_cosmos_account_inspect',
        description: 'Full operational view of a Cosmos DB account: API type, consistency policy, regions with failover priorities, automatic failover, multiple-write-regions, capacity mode (serverless vs. provisioned), backup policy, public network access, IP firewall rules, private endpoint connections, local auth, managed identity, and diagnostic settings.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...ACCOUNT_TARGET }, required: ['instance', 'resourceGroup', 'accountName'] },
    },
    {
        name: 'azure_cosmos_account_diagnose',
        description: 'Deterministic checklist against a Cosmos DB account: local auth enabled when it could be disabled, no automatic failover despite multiple regions, public network access with no firewall rules, missing diagnostic settings, and periodic-backup interval/retention mismatches.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...ACCOUNT_TARGET }, required: ['instance', 'resourceGroup', 'accountName'] },
    },
    {
        name: 'azure_cosmos_account_compare',
        description: 'Compares two Cosmos DB accounts (same or different instances) and flags drift in API type, consistency policy, regions, failover configuration, capacity mode, backup policy, and network exposure.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                left: { type: 'object', properties: { ...ACCOUNT_TARGET }, required: ['instance', 'resourceGroup', 'accountName'] },
                right: { type: 'object', properties: { ...ACCOUNT_TARGET }, required: ['instance', 'resourceGroup', 'accountName'] },
            },
            required: ['left', 'right'],
        },
    },
    {
        name: 'azure_cosmos_account_create_plan',
        description: 'Dry-run for azure_cosmos_account_create. Checks that the target resource group exists and that no account of this name already exists, then shows the proposed account configuration. apiType, consistencyPolicy, regions, and capacityMode are required — none are defaulted or guessed.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...ACCOUNT_TARGET,
                location: { type: 'string', description: 'Azure region for the account resource itself, e.g. "uksouth".' },
                apiType: { type: 'string', enum: ['Sql', 'MongoDB', 'Cassandra', 'Gremlin', 'Table'] },
                consistencyPolicy: CONSISTENCY_POLICY_SCHEMA,
                regions: REGIONS_SCHEMA,
                capacityMode: { type: 'string', enum: ['Serverless', 'Provisioned'] },
                automaticFailoverEnabled: { type: 'boolean' },
                multipleWriteRegionsEnabled: { type: 'boolean' },
                publicNetworkAccess: { type: 'string', enum: ['Enabled', 'Disabled', 'SecuredByPerimeter'] },
                ipRules: { type: 'array', items: { type: 'string' } },
                disableLocalAuth: { type: 'boolean' },
                backupPolicy: { type: 'object' },
                identity: { type: 'object' },
                tags: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['instance', 'resourceGroup', 'accountName', 'location', 'apiType', 'consistencyPolicy', 'regions', 'capacityMode'],
        },
    },
    {
        name: 'azure_cosmos_account_create',
        description: 'Creates a Cosmos DB account. Fails with DEPENDENCY_MISSING if the resource group does not exist, and CONFLICT if an account of this name already exists. There is no account deletion tool exposed by this MCP.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...ACCOUNT_TARGET,
                location: { type: 'string', description: 'Azure region for the account resource itself, e.g. "uksouth".' },
                apiType: { type: 'string', enum: ['Sql', 'MongoDB', 'Cassandra', 'Gremlin', 'Table'] },
                consistencyPolicy: CONSISTENCY_POLICY_SCHEMA,
                regions: REGIONS_SCHEMA,
                capacityMode: { type: 'string', enum: ['Serverless', 'Provisioned'] },
                automaticFailoverEnabled: { type: 'boolean' },
                multipleWriteRegionsEnabled: { type: 'boolean' },
                publicNetworkAccess: { type: 'string', enum: ['Enabled', 'Disabled', 'SecuredByPerimeter'] },
                ipRules: { type: 'array', items: { type: 'string' } },
                disableLocalAuth: { type: 'boolean' },
                backupPolicy: { type: 'object' },
                identity: { type: 'object' },
                tags: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['instance', 'resourceGroup', 'accountName', 'location', 'apiType', 'consistencyPolicy', 'regions', 'capacityMode'],
        },
    },
    {
        name: 'azure_cosmos_account_config_plan',
        description: 'Dry-run: diffs a requested configuration change (consistencyPolicy, regions, automaticFailoverEnabled, multipleWriteRegionsEnabled, publicNetworkAccess, ipRules, disableLocalAuth, backupPolicy, identity, tags) against the account\'s current configuration without applying it.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...ACCOUNT_TARGET, config: { type: 'object', description: 'Subset of configurable fields to change.' } },
            required: ['instance', 'resourceGroup', 'accountName', 'config'],
        },
    },
    {
        name: 'azure_cosmos_account_config_apply',
        description: 'Applies a configuration change computed by azure_cosmos_account_config_plan. Only fields present in `config` are updated.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...ACCOUNT_TARGET, config: { type: 'object', description: 'Subset of configurable fields to change.' } },
            required: ['instance', 'resourceGroup', 'accountName', 'config'],
        },
    },
];

const TOOL_HANDLERS = {
    azure_cosmos_accounts_list: list.execute,
    azure_cosmos_account_inspect: inspect.execute,
    azure_cosmos_account_diagnose: diagnose.execute,
    azure_cosmos_account_compare: compare.execute,
    azure_cosmos_account_create_plan: createPlan.execute,
    azure_cosmos_account_create: create.execute,
    azure_cosmos_account_config_plan: configPlan.execute,
    azure_cosmos_account_config_apply: configApply.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
