/**
 * SQL family — creates an Entra-only Azure SQL server, firewall rules and
 * serverless databases. Create-only: no delete tool exists, no SQL
 * passwords are ever set, and no data-plane (T-SQL) access is offered.
 */

'use strict';

const serverCreate = require('./tools/sql/server-create');
const firewallRuleCreate = require('./tools/sql/firewall-rule-create');
const databaseCreate = require('./tools/sql/database-create');

const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };
const TARGET = {
    instance: { type: 'string', description: 'Registered instance name (see azure_instances_list), e.g. "azure-prod".' },
    resourceGroup: { type: 'string', description: 'Resource group name.' },
};
const TAGS = { type: 'object', additionalProperties: { type: 'string' } };

const TOOLS = [
    {
        name: 'azure_sql_server_create',
        description: 'Creates an Azure SQL logical server with Microsoft Entra-only authentication (no SQL password) and TLS 1.2. The admin is an Entra group. Fails with CONFLICT if the server exists.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...TARGET,
                name: { type: 'string', description: 'SQL server name (globally unique, lower case).' },
                location: { type: 'string', description: 'Azure region, e.g. "uksouth".' },
                adminGroupName: { type: 'string', description: 'Display name of the Entra group that becomes the server admin.' },
                adminGroupObjectId: { type: 'string', description: 'Object ID (GUID) of that Entra group.' },
                tags: TAGS,
            },
            required: ['instance', 'resourceGroup', 'name', 'location', 'adminGroupName', 'adminGroupObjectId'],
        },
    },
    {
        name: 'azure_sql_firewall_rule_create',
        description: 'Creates a SQL server firewall rule for an IPv4 range. 0.0.0.0 to 0.0.0.0 allows Azure services. A rule covering the whole internet (0.0.0.0 to 255.255.255.255) is refused. Fails with CONFLICT if the rule exists.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...TARGET,
                serverName: { type: 'string', description: 'Existing SQL server name.' },
                name: { type: 'string', description: 'Firewall rule name.' },
                startIpAddress: { type: 'string', description: 'First IPv4 address in the range.' },
                endIpAddress: { type: 'string', description: 'Last IPv4 address in the range.' },
            },
            required: ['instance', 'resourceGroup', 'serverName', 'name', 'startIpAddress', 'endIpAddress'],
        },
    },
    {
        name: 'azure_sql_database_create',
        description: 'Creates a serverless General Purpose Gen5 database on an existing SQL server, by default using the Azure SQL free offer. Fails with DEPENDENCY_MISSING if the server is absent and CONFLICT if the database exists.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                ...TARGET,
                serverName: { type: 'string', description: 'Existing SQL server name.' },
                name: { type: 'string', description: 'Database name.' },
                location: { type: 'string', description: 'Azure region; must match the server.' },
                maxVcores: { type: 'number', description: 'Maximum vCores, 1 to 40. Default 1.' },
                useFreeOffer: { type: 'boolean', description: 'Use the Azure SQL free offer. Default true.' },
                freeLimitExhaustionBehavior: { type: 'string', enum: ['AutoPause', 'BillOverUsage'], description: 'What happens when the monthly free allowance is used. Default BillOverUsage (stays online, bills the excess).' },
                backupStorageRedundancy: { type: 'string', enum: ['Local', 'Zone', 'Geo', 'GeoZone'], description: 'Default Local.' },
                tags: TAGS,
            },
            required: ['instance', 'resourceGroup', 'serverName', 'name', 'location'],
        },
    },
];

const TOOL_HANDLERS = {
    azure_sql_server_create: serverCreate.execute,
    azure_sql_firewall_rule_create: firewallRuleCreate.execute,
    azure_sql_database_create: databaseCreate.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
