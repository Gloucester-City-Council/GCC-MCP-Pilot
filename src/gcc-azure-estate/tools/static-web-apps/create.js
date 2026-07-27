/**
 * Tool: azure_static_web_app_create
 *
 * Creates a Static Web App. Fails with CONFLICT if one of that name
 * already exists in the resource group. Against azure-prod today this
 * correctly fails with FORBIDDEN — static-web-apps has no "create" grant
 * yet (repo-integration write crosses into deployment config, which the
 * design spec deliberately withholds for now).
 *
 * SECURITY: a repositoryToken may be supplied as INPUT (Azure requires it
 * to wire up the GitHub Actions workflow) but is never echoed back in the
 * result — the response is built from an explicit safe field list, never
 * a spread of the raw SDK response.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { toSiteSummary, awaitResult } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'name', 'resourceGroup', 'location']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'static-web-apps', 'create');
    const client = getWebSiteClient(instance);

    let existing = null;
    try {
        existing = await client.staticSites.getStaticSite(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }

    if (existing) {
        throw new AzureEstateError(
            ERROR_CODES.CONFLICT,
            `Static Web App "${args.name}" already exists in resource group "${args.resourceGroup}" (instance "${instance.name}")`
        );
    }

    const envelope = {
        location: args.location,
        tags: args.tags || {},
        sku: { name: args.sku || 'Free', tier: args.sku || 'Free' },
        repositoryUrl: args.repositoryUrl,
        branch: args.branch || 'main',
        repositoryToken: args.repositoryToken, // never persisted or returned by this tool
        buildProperties: args.buildProperties,
    };

    const created = await awaitResult(client.staticSites.createOrUpdateStaticSite(args.resourceGroup, args.name, envelope));

    return { created: true, ...toSiteSummary(created, args.resourceGroup) };
}

module.exports = { execute };
