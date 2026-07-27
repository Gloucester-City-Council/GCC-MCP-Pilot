/**
 * Common estate layer — navigation tools with no resource-family
 * permission gate (identity/registry discovery only).
 */

'use strict';

const ping = require('./tools/common/ping');
const instancesList = require('./tools/common/instances-list');
const subscriptionsList = require('./tools/common/subscriptions-list');

const READ_ONLY_ANNOTATIONS = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
};

const TOOLS = [
    {
        name: 'azure_ping',
        description: '⭐ START HERE: Health check for the Azure Estate MCP. Confirms the server is reachable and the instance registry loaded. Call this first if other azure_* tools are behaving unexpectedly.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'azure_instances_list',
        description: 'Lists the registered Azure instances (subscription/environment) this MCP can operate against, including the operation classes (inspect, diagnose, plan, create, modify, ...) granted to each resource family. Use this to find the exact `instance` name required by every other azure_* tool.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'azure_subscriptions_list',
        description: 'Lists the Azure subscriptions visible to this MCP\'s credential. Useful for discovering a subscriptionId before registering a new instance in config/azure-instances.yaml.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
];

const TOOL_HANDLERS = {
    azure_ping: ping.execute,
    azure_instances_list: instancesList.execute,
    azure_subscriptions_list: subscriptionsList.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
