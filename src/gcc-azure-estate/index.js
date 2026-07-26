/**
 * Azure Estate MCP Module
 *
 * Aggregates every resource-family module into a single TOOLS array +
 * TOOL_HANDLERS map for the mcpAzureEstate Azure Function. A governed MCP
 * for inspecting, diagnosing, and provisioning the Azure resource groups
 * and application resources GCC's AI-assisted services run on.
 *
 * Resource-group deletion and blob content read/write are permanently
 * out of scope — no tool of either kind exists in any family module.
 */

'use strict';

const common = require('./common');
const resourceGroups = require('./resource-groups');
const functionApps = require('./function-apps');
const staticWebApps = require('./static-web-apps');
const storageAccounts = require('./storage-accounts');
const blobContainers = require('./blob-containers');
const cosmosAccounts = require('./cosmos-accounts');
const cosmosDatabases = require('./cosmos-databases');
const cosmosContainers = require('./cosmos-containers');

// Family modules are added here incrementally as each resource family is
// built (relationships, stack).
const FAMILY_MODULES = [
    common, resourceGroups, functionApps, staticWebApps, storageAccounts, blobContainers,
    cosmosAccounts, cosmosDatabases, cosmosContainers,
];

const TOOLS = FAMILY_MODULES.flatMap((m) => m.TOOLS);
const TOOL_HANDLERS = Object.assign({}, ...FAMILY_MODULES.map((m) => m.TOOL_HANDLERS));

const SERVER_INFO = {
    name: 'gcc-azure-estate-mcp',
    version: '1.0.0',
    description: 'Governed MCP for inspecting, diagnosing, and provisioning the Azure resource groups, Function Apps, Static Web Apps, Storage/Blob, and Cosmos DB resources GCC\'s AI-assisted services run on. A resource group is treated as an operational boundary, not merely a filter.',
    readOnly: false,
};

module.exports = { TOOLS, TOOL_HANDLERS, SERVER_INFO };
