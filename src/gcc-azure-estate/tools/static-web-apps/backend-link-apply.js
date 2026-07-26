/**
 * Tool: azure_static_web_app_backend_link_apply
 *
 * Applies a backend link computed by azure_static_web_app_backend_link_plan.
 * Returns the linked Function App's resourceId so the Estate MCP's
 * relationships tooling can pick up the cross-resource edge.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { toLinkedBackendSummary, functionAppResourceId, getStaticSiteOrNotFound, awaitResult } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'functionApp']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);
    const functionAppMissing = args.functionApp.resourceId ? null : validateRequired(args.functionApp, ['name']);
    if (functionAppMissing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `functionApp.${functionAppMissing.replace('Missing required field: ', '')} is required`);

    const instance = assertPermitted(args.instance, 'static-web-apps', 'deploy');
    const client = getWebSiteClient(instance);

    const site = await getStaticSiteOrNotFound(client, args.resourceGroup, args.name, instance.name);

    const functionAppResourceGroup = args.functionApp.resourceGroup || args.resourceGroup;
    const backendResourceId = args.functionApp.resourceId
        || functionAppResourceId(instance.subscriptionId, functionAppResourceGroup, args.functionApp.name);
    const linkedBackendName = args.linkedBackendName || args.functionApp.name || 'default';
    const region = args.region || site.location;

    const result = await awaitResult(
        client.staticSites.linkBackend(args.resourceGroup, args.name, linkedBackendName, { backendResourceId, region })
    );

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        linkedBackendName,
        ...toLinkedBackendSummary({ ...result, name: linkedBackendName }),
    };
}

module.exports = { execute };
