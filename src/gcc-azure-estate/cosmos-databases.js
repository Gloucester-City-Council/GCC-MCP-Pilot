/**
 * Cosmos DB Databases family — the middle tier of the Cosmos hierarchy
 * (Account -> Database -> Container). Every tool takes {instance,
 * resourceGroup, accountName, ...} to identify the parent account. No
 * delete tool exists. Shares the 'cosmos' permission family with
 * azure_cosmos_account_* and azure_cosmos_container_*.
 */

'use strict';

const list = require('./tools/cosmos-databases/list');
const inspect = require('./tools/cosmos-databases/inspect');
const createPlan = require('./tools/cosmos-databases/create-plan');
const create = require('./tools/cosmos-databases/create');
const throughputPlan = require('./tools/cosmos-databases/throughput-plan');
const throughputApply = require('./tools/cosmos-databases/throughput-apply');

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };

const INSTANCE_PROPERTY = {
    instance: { type: 'string', description: 'Registered instance name (see azure_instances_list), e.g. "azure-prod".' },
};
const ACCOUNT_SCOPE = {
    ...INSTANCE_PROPERTY,
    resourceGroup: { type: 'string', description: 'Resource group containing the Cosmos DB account.' },
    accountName: { type: 'string', description: 'Cosmos DB account name.' },
};
const DATABASE_TARGET = {
    ...ACCOUNT_SCOPE,
    databaseName: { type: 'string', description: 'Cosmos SQL database name.' },
};

const THROUGHPUT_MODEL_SCHEMA = {
    type: 'object',
    description: 'Explicit throughput model — never guessed. "Serverless" is only valid on a serverless account.',
    properties: {
        mode: { type: 'string', enum: ['Autoscale', 'Manual', 'Serverless'] },
        throughput: { type: 'number', description: 'Manual RU/s. Required when mode is "Manual".' },
        maxThroughput: { type: 'number', description: 'Autoscale max RU/s. Required when mode is "Autoscale".' },
    },
    required: ['mode'],
};

const TOOLS = [
    {
        name: 'azure_cosmos_databases_list',
        description: 'Lists the SQL databases under a Cosmos DB account, with throughput mode and RU/s where database-level (shared) throughput is configured.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...ACCOUNT_SCOPE }, required: ['instance', 'resourceGroup', 'accountName'] },
    },
    {
        name: 'azure_cosmos_database_inspect',
        description: 'Inspects a single Cosmos SQL database: throughput mode (serverless / shared autoscale / shared manual / dedicated per-container) and current RU/s if database-level throughput is provisioned.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...DATABASE_TARGET }, required: ['instance', 'resourceGroup', 'accountName', 'databaseName'] },
    },
    {
        name: 'azure_cosmos_database_create_plan',
        description: 'Dry-run for azure_cosmos_database_create. Checks the parent account exists and matches the requested capacity mode, and that no database of this name already exists. throughputModel is required and never defaulted.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...DATABASE_TARGET, throughputModel: THROUGHPUT_MODEL_SCHEMA },
            required: ['instance', 'resourceGroup', 'accountName', 'databaseName', 'throughputModel'],
        },
    },
    {
        name: 'azure_cosmos_database_create',
        description: 'Creates a Cosmos SQL database. throughputModel (autoscale max RU/s, manual RU/s, or serverless) is a required input. Fails with DEPENDENCY_MISSING if the account does not exist, BAD_REQUEST on a capacity-mode mismatch with the account, and CONFLICT if the database already exists. No delete tool is exposed.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...DATABASE_TARGET, throughputModel: THROUGHPUT_MODEL_SCHEMA },
            required: ['instance', 'resourceGroup', 'accountName', 'databaseName', 'throughputModel'],
        },
    },
    {
        name: 'azure_cosmos_database_throughput_plan',
        description: 'Dry-run: diffs a requested throughputModel against the database\'s current shared throughput setting without applying it. DEPENDENCY_MISSING if the database has no database-level throughput to change.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...DATABASE_TARGET, throughputModel: THROUGHPUT_MODEL_SCHEMA },
            required: ['instance', 'resourceGroup', 'accountName', 'databaseName', 'throughputModel'],
        },
    },
    {
        name: 'azure_cosmos_database_throughput_apply',
        description: 'Applies a throughput change computed by azure_cosmos_database_throughput_plan, migrating between manual/autoscale first if the mode changed.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...DATABASE_TARGET, throughputModel: THROUGHPUT_MODEL_SCHEMA },
            required: ['instance', 'resourceGroup', 'accountName', 'databaseName', 'throughputModel'],
        },
    },
];

const TOOL_HANDLERS = {
    azure_cosmos_databases_list: list.execute,
    azure_cosmos_database_inspect: inspect.execute,
    azure_cosmos_database_create_plan: createPlan.execute,
    azure_cosmos_database_create: create.execute,
    azure_cosmos_database_throughput_plan: throughputPlan.execute,
    azure_cosmos_database_throughput_apply: throughputApply.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
