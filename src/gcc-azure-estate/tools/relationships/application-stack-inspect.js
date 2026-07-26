/**
 * Tool: azure_application_stack_inspect
 *
 * Inspects a named application stack (explicit resource names, not a YAML
 * contract — for that, see azure_stack_plan/create/verify). Combines each
 * named resource's own *_inspect tool with the dependency edges between
 * them.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { buildFunctionAppEdges } = require('../../lib/topology');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'stack', 'inspect');
    const components = {};
    const edges = [];

    if (args.functionApp) {
        const { inspected, edges: functionAppEdges } = await buildFunctionAppEdges(instance, args.resourceGroup, args.functionApp);
        components.functionApp = inspected;
        edges.push(...functionAppEdges);
    }

    if (args.staticWebApp) {
        const { execute: inspectStaticWebApp } = require('../static-web-apps/inspect');
        components.staticWebApp = await inspectStaticWebApp({ instance: instance.name, resourceGroup: args.resourceGroup, name: args.staticWebApp });
        for (const backend of components.staticWebApp.linkedBackends || []) {
            edges.push({ from: args.staticWebApp, to: backend.name || backend.backendResourceId || null, kind: 'Microsoft.Web/sites', relationship: 'backend' });
        }
    }

    if (args.storageAccount) {
        const { execute: inspectStorage } = require('../storage-accounts/inspect');
        components.storageAccount = await inspectStorage({ instance: instance.name, resourceGroup: args.resourceGroup, name: args.storageAccount });
    }

    if (args.cosmosAccount) {
        const { execute: inspectCosmosAccount } = require('../cosmos-accounts/inspect');
        components.cosmosAccount = await inspectCosmosAccount({ instance: instance.name, resourceGroup: args.resourceGroup, accountName: args.cosmosAccount });
    }

    return { resourceGroup: args.resourceGroup, components, edges };
}

module.exports = { execute };
