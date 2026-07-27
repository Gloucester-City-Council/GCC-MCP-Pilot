/**
 * Tool: azure_function_apps_list
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isFunctionApp } = require('./shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'inspect');
    const client = getWebSiteClient(instance);

    const functionApps = [];
    for await (const site of client.webApps.listByResourceGroup(args.resourceGroup)) {
        if (!isFunctionApp(site)) continue;
        functionApps.push({
            name: site.name,
            resourceGroup: args.resourceGroup,
            location: site.location,
            kind: site.kind,
            state: site.state || null,
            hostNames: site.hostNames || [],
            tags: site.tags || {},
        });
    }

    return { functionApps, totalCount: functionApps.length };
}

module.exports = { execute };
