/**
 * Tool: azure_resource_dependencies
 *
 * Outbound dependency edges for a single named resource (currently
 * Function Apps and Static Web Apps — the two resource types with
 * cross-resource linkages in this MCP's tracked families). For the whole
 * resource-group graph use azure_resource_group_topology.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { buildFunctionAppEdges } = require('../../lib/topology');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'resourceType', 'resourceName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'stack', 'inspect');

    if (args.resourceType === 'functionApp') {
        const { edges } = await buildFunctionAppEdges(instance, args.resourceGroup, args.resourceName);
        return { resourceType: args.resourceType, resourceName: args.resourceName, edges };
    }

    if (args.resourceType === 'staticWebApp') {
        const { execute: inspectStaticWebApp } = require('../static-web-apps/inspect');
        const inspected = await inspectStaticWebApp({ instance: instance.name, resourceGroup: args.resourceGroup, name: args.resourceName });
        const edges = (inspected.linkedBackends || []).map((b) => ({
            from: args.resourceName, to: b.name || b.backendResourceId || null, kind: 'Microsoft.Web/sites', relationship: 'backend',
        }));
        return { resourceType: args.resourceType, resourceName: args.resourceName, edges };
    }

    throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `resourceType must be one of: functionApp, staticWebApp. Got: "${args.resourceType}"`);
}

module.exports = { execute };
