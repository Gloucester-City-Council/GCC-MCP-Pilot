/**
 * Tool: azure_resource_group_topology
 *
 * Whole-resource-group dependency graph: nodes are every resource in the
 * group, edges are Function App -> Storage/App Insights/Managed
 * Identity/Cosmos DB and Static Web App -> Function App (backend link).
 * No new Azure calls beyond what each family's own inspect tools already
 * make.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { buildResourceGroupTopology } = require('../../lib/topology');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'stack', 'inspect');
    return buildResourceGroupTopology(instance, args.resourceGroup);
}

module.exports = { execute };
