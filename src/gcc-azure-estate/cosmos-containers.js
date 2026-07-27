/**
 * Cosmos DB Containers family — the leaf tier of the Cosmos hierarchy
 * (Account -> Database -> Container). Every tool takes {instance,
 * resourceGroup, accountName, databaseName, ...}. Shares the 'cosmos'
 * permission family with azure_cosmos_account_* and
 * azure_cosmos_database_*.
 *
 * CRITICAL DESIGN RULE: a container's partition key is immutable once
 * created — it is never guessed and never silently changed.
 * azure_cosmos_container_create hard-fails with PARTITION_KEY_IMMUTABLE
 * if an existing container's partition key differs from the requested
 * one. No tool in this family "creates or updates" a partition key
 * implicitly, and there is no delete tool.
 */

'use strict';

const list = require('./tools/cosmos-containers/list');
const inspect = require('./tools/cosmos-containers/inspect');
const diagnose = require('./tools/cosmos-containers/diagnose');
const createPlan = require('./tools/cosmos-containers/create-plan');
const create = require('./tools/cosmos-containers/create');
const throughputPlan = require('./tools/cosmos-containers/throughput-plan');
const throughputApply = require('./tools/cosmos-containers/throughput-apply');
const indexingPlan = require('./tools/cosmos-containers/indexing-plan');
const indexingApply = require('./tools/cosmos-containers/indexing-apply');

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };

const INSTANCE_PROPERTY = {
    instance: { type: 'string', description: 'Registered instance name (see azure_instances_list), e.g. "azure-prod".' },
};
const DATABASE_SCOPE = {
    ...INSTANCE_PROPERTY,
    resourceGroup: { type: 'string', description: 'Resource group containing the Cosmos DB account.' },
    accountName: { type: 'string', description: 'Cosmos DB account name.' },
    databaseName: { type: 'string', description: 'Cosmos SQL database name.' },
};
const CONTAINER_TARGET = {
    ...DATABASE_SCOPE,
    containerName: { type: 'string', description: 'Cosmos SQL container name.' },
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

const PARTITION_KEY_SCHEMA = {
    type: 'object',
    description: 'Never guessed. If the container already exists, this is compared to its current partition key and ANY difference is a hard PARTITION_KEY_IMMUTABLE failure.',
    properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'e.g. ["/tenantId"]' },
        kind: { type: 'string', enum: ['Hash', 'Range', 'MultiHash'] },
        version: { type: 'number' },
    },
    required: ['paths'],
};

const INDEXING_POLICY_SCHEMA = { type: 'object', description: 'Cosmos IndexingPolicy — automatic, indexingMode, includedPaths, excludedPaths, compositeIndexes, spatialIndexes.' };
const UNIQUE_KEY_POLICY_SCHEMA = { type: 'object', description: 'Cosmos UniqueKeyPolicy — { uniqueKeys: [{ paths: [...] }] }. Pass { uniqueKeys: [] } if none are wanted.' };
const ANALYTICAL_STORE_SCHEMA = {
    type: 'object',
    description: 'Explicit analytical-store choice — never defaulted.',
    properties: { enabled: { type: 'boolean' }, ttl: { type: 'number', description: 'Analytical TTL in seconds; -1 for infinite retention.' } },
    required: ['enabled'],
};

const CREATE_CONTAINER_PROPERTIES = {
    ...CONTAINER_TARGET,
    partitionKey: PARTITION_KEY_SCHEMA,
    throughputModel: THROUGHPUT_MODEL_SCHEMA,
    indexingPolicy: INDEXING_POLICY_SCHEMA,
    uniqueKeyPolicy: UNIQUE_KEY_POLICY_SCHEMA,
    defaultTtl: { type: ['number', 'null'], description: 'Default TTL in seconds, or null for "no default TTL". Required explicitly — never guessed.' },
    analyticalStore: ANALYTICAL_STORE_SCHEMA,
};
const CREATE_CONTAINER_REQUIRED = [
    'instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName',
    'partitionKey', 'throughputModel', 'indexingPolicy', 'uniqueKeyPolicy', 'defaultTtl', 'analyticalStore',
];

const TOOLS = [
    {
        name: 'azure_cosmos_containers_list',
        description: 'Lists the SQL containers under a Cosmos database, with partition key paths/version and TTL settings.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...DATABASE_SCOPE }, required: ['instance', 'resourceGroup', 'accountName', 'databaseName'] },
    },
    {
        name: 'azure_cosmos_container_inspect',
        description: 'Inspects a single Cosmos SQL container: partition key path + version, indexing policy summary, unique key policy, default TTL, analytical store status, and current (dedicated) throughput.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...CONTAINER_TARGET }, required: ['instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName'] },
    },
    {
        name: 'azure_cosmos_container_diagnose',
        description: 'Narrow, deliberately non-noisy checklist: no TTL set on a container that looks like an audit/log container by name (informational only), and an "index everything" policy on a container provisioned at high scale (informational only). Missing unique key policy is intentionally NOT flagged — most containers don\'t need one.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...CONTAINER_TARGET }, required: ['instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName'] },
    },
    {
        name: 'azure_cosmos_container_create_plan',
        description: '⭐ Dry-run for azure_cosmos_container_create. The creation contract requires ALL of: partitionKey, throughputModel, indexingPolicy, uniqueKeyPolicy, defaultTtl, and analyticalStore — nothing is guessed or defaulted. If a container of this name already exists, its current partition key is compared to the requested one; ANY difference is reported as a hard PARTITION_KEY_IMMUTABLE blocker (a container\'s partition key can never be changed).',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...CREATE_CONTAINER_PROPERTIES }, required: CREATE_CONTAINER_REQUIRED },
    },
    {
        name: 'azure_cosmos_container_create',
        description: 'Creates a Cosmos SQL container. Rejects with BAD_REQUEST if partitionKey is missing (a partition key is never guessed). If a container of this name already exists with a DIFFERENT partition key, fails hard with PARTITION_KEY_IMMUTABLE (both the existing and requested partition keys are returned in `details`) — this is never a silent no-op. If the existing partition key matches, the container is updated in place (e.g. indexing policy via this same call is also possible, but prefer azure_cosmos_container_indexing_apply for that). No delete tool is exposed.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...CREATE_CONTAINER_PROPERTIES }, required: CREATE_CONTAINER_REQUIRED },
    },
    {
        name: 'azure_cosmos_container_throughput_plan',
        description: 'Dry-run: diffs a requested throughputModel against the container\'s current dedicated throughput setting without applying it. DEPENDENCY_MISSING if the container has no container-level throughput to change.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...CONTAINER_TARGET, throughputModel: THROUGHPUT_MODEL_SCHEMA },
            required: ['instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName', 'throughputModel'],
        },
    },
    {
        name: 'azure_cosmos_container_throughput_apply',
        description: 'Applies a throughput change computed by azure_cosmos_container_throughput_plan, migrating between manual/autoscale first if the mode changed.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...CONTAINER_TARGET, throughputModel: THROUGHPUT_MODEL_SCHEMA },
            required: ['instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName', 'throughputModel'],
        },
    },
    {
        name: 'azure_cosmos_container_indexing_plan',
        description: 'Dry-run: diffs a requested indexingPolicy against the container\'s current one without applying it. Never touches the partition key.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...CONTAINER_TARGET, indexingPolicy: INDEXING_POLICY_SCHEMA },
            required: ['instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName', 'indexingPolicy'],
        },
    },
    {
        name: 'azure_cosmos_container_indexing_apply',
        description: 'Applies an indexing policy change computed by azure_cosmos_container_indexing_plan. Partition key, unique key policy, TTL, and analytical store settings are carried through unchanged — this tool never modifies a partition key.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: { ...CONTAINER_TARGET, indexingPolicy: INDEXING_POLICY_SCHEMA },
            required: ['instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName', 'indexingPolicy'],
        },
    },
];

const TOOL_HANDLERS = {
    azure_cosmos_containers_list: list.execute,
    azure_cosmos_container_inspect: inspect.execute,
    azure_cosmos_container_diagnose: diagnose.execute,
    azure_cosmos_container_create_plan: createPlan.execute,
    azure_cosmos_container_create: create.execute,
    azure_cosmos_container_throughput_plan: throughputPlan.execute,
    azure_cosmos_container_throughput_apply: throughputApply.execute,
    azure_cosmos_container_indexing_plan: indexingPlan.execute,
    azure_cosmos_container_indexing_apply: indexingApply.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
