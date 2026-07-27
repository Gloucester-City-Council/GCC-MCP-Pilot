/**
 * Tool: azure_static_web_app_backend_link_plan
 *
 * Validates linking a Function App as a Static Web App's backend and
 * returns a dependency-explicit plan (no write API called). The backend
 * is identified by { name, resourceGroup? } — resourceGroup defaults to
 * the Static Web App's own resource group — or by an explicit resourceId
 * override.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { functionAppResourceId, collectAsyncIterable, getStaticSiteOrNotFound } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'functionApp']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);
    const functionAppMissing = args.functionApp.resourceId ? null : validateRequired(args.functionApp, ['name']);
    if (functionAppMissing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `functionApp.${functionAppMissing.replace('Missing required field: ', '')} is required`);

    const instance = assertPermitted(args.instance, 'static-web-apps', 'plan');
    const client = getWebSiteClient(instance);

    const site = await getStaticSiteOrNotFound(client, args.resourceGroup, args.name, instance.name);

    const functionAppResourceGroup = args.functionApp.resourceGroup || args.resourceGroup;
    const backendResourceId = args.functionApp.resourceId
        || functionAppResourceId(instance.subscriptionId, functionAppResourceGroup, args.functionApp.name);
    const linkedBackendName = args.linkedBackendName || args.functionApp.name || 'default';
    const region = args.region || site.location;

    let functionAppExists = false;
    let functionAppKind = null;
    if (args.functionApp.name) {
        try {
            const functionApp = await client.webApps.get(functionAppResourceGroup, args.functionApp.name);
            functionAppExists = true;
            functionAppKind = functionApp.kind || null;
        } catch (err) {
            if (err.statusCode !== 404) throw err;
        }
    } else {
        // Only a resourceId override was given — existence can't be checked without a name/resourceGroup pair.
        functionAppExists = null;
    }

    const existingLinks = await collectAsyncIterable(client.staticSites.listLinkedBackends(args.resourceGroup, args.name));
    const conflict = existingLinks.find((l) => l.name === linkedBackendName || l.backendResourceId === backendResourceId);

    const steps = [
        {
            step: 1,
            action: 'Confirm the Function App backend exists',
            status: functionAppExists === false ? 'blocked' : functionAppExists === null ? 'unverified' : 'satisfied',
            note: functionAppExists === false
                ? `Function App "${args.functionApp.name}" not found in resource group "${functionAppResourceGroup}".`
                : functionAppExists === null
                    ? 'Only an explicit resourceId was given — existence was not verified.'
                    : undefined,
            functionAppKind,
        },
        {
            step: 2,
            action: 'Confirm no existing link with this name/resourceId',
            status: conflict ? 'blocked' : 'satisfied',
            note: conflict ? `Already linked as "${conflict.name}" (state: ${conflict.provisioningState}).` : undefined,
        },
        {
            step: 3,
            action: 'Link the backend',
            tool: 'azure_static_web_app_backend_link_apply',
            dependsOn: [1, 2],
            backendResourceId,
            region,
            linkedBackendName,
        },
    ];

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        linkedBackendName,
        backendResourceId,
        region,
        canApply: functionAppExists !== false && !conflict,
        steps,
        requiredPermission: { resourceFamily: 'static-web-apps', operationClass: 'deploy' },
    };
}

module.exports = { execute };
