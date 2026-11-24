/**
 * Tool: azure_log_analytics_workspace_create
 *
 * Creates a Log Analytics workspace (needed by workspace-based
 * Application Insights). Fails with CONFLICT if it already exists.
 * No delete tool exists.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getOperationalInsightsClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'location']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'monitoring', 'create');
    const client = getOperationalInsightsClient(instance);

    let existing = null;
    try {
        existing = await client.workspaces.get(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    if (existing) {
        throw new AzureEstateError(
            ERROR_CODES.CONFLICT,
            `Log Analytics workspace "${args.name}" already exists in resource group "${args.resourceGroup}" (instance "${instance.name}")`
        );
    }

    const poller = await client.workspaces.beginCreateOrUpdate(args.resourceGroup, args.name, {
        location: args.location,
        sku: { name: 'PerGB2018' },
        retentionInDays: args.retentionInDays || 30,
        tags: args.tags || {},
    });
    const ws = poller && typeof poller.pollUntilDone === 'function' ? await poller.pollUntilDone() : poller;

    return {
        created: true,
        name: ws.name || args.name,
        resourceGroup: args.resourceGroup,
        location: ws.location || args.location,
        resourceId: ws.id || null,
        retentionInDays: ws.retentionInDays || args.retentionInDays || 30,
    };
}

module.exports = { execute };
