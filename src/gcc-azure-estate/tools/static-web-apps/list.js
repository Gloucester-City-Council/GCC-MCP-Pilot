/**
 * Tool: azure_static_web_apps_list
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { toSiteSummary, collectAsyncIterable } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'static-web-apps', 'inspect');
    const client = getWebSiteClient(instance);

    const sites = await collectAsyncIterable(client.staticSites.listStaticSitesByResourceGroup(args.resourceGroup));

    return {
        resourceGroup: args.resourceGroup,
        staticWebApps: sites.map((site) => toSiteSummary(site, args.resourceGroup)),
        totalCount: sites.length,
    };
}

module.exports = { execute };
