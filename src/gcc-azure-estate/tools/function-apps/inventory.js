/**
 * Tool: azure_function_app_inventory
 *
 * Summarises azure_function_app_inspect's view across every Function App
 * in a resource group at once. Best-effort per app — a single app's
 * settings/config read failing does not fail the whole inventory.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const {
    buildSettingsMetadata, extractStorageAccountName, detectAppInsightsLinkage, deriveRuntime, getHostingPlanSummary, isFunctionApp,
} = require('./shared');

async function summarizeApp(client, resourceGroup, site) {
    let siteConfig = {};
    let properties = {};
    let slotCount = 0;

    try {
        siteConfig = await client.webApps.getConfiguration(resourceGroup, site.name);
    } catch (_err) {
        siteConfig = {};
    }

    try {
        const settings = await client.webApps.listApplicationSettings(resourceGroup, site.name);
        properties = settings.properties || {};
    } catch (_err) {
        properties = {};
    }

    try {
        for await (const _slot of client.webApps.listSlots(resourceGroup, site.name)) {
            slotCount += 1;
        }
    } catch (_err) {
        slotCount = 0;
    }

    const runtime = deriveRuntime(site, siteConfig);
    const hostingPlan = await getHostingPlanSummary(client, site.serverFarmId);
    const appInsights = detectAppInsightsLinkage(properties);
    const storageAccountName = extractStorageAccountName(properties.AzureWebJobsStorage);

    return {
        name: site.name,
        runtime,
        hostingPlan,
        slotCount,
        managedIdentityType: (site.identity && site.identity.type) || 'None',
        applicationInsightsLinked: appInsights.linked,
        storageAccountName,
        httpsOnly: !!site.httpsOnly,
        minTlsVersion: siteConfig.minTlsVersion || null,
        corsWildcard: !!(siteConfig.cors && (siteConfig.cors.allowedOrigins || []).includes('*')),
        healthCheckConfigured: !!siteConfig.healthCheckPath,
        appSettingsCount: Object.keys(properties).length,
        appSettingsMetadata: buildSettingsMetadata(properties),
    };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'inspect');
    const client = getWebSiteClient(instance);

    const sites = [];
    for await (const site of client.webApps.listByResourceGroup(args.resourceGroup)) {
        if (isFunctionApp(site)) sites.push(site);
    }

    const apps = [];
    for (const site of sites) {
        apps.push(await summarizeApp(client, args.resourceGroup, site));
    }

    const summary = {
        totalCount: apps.length,
        byRuntime: {},
        byOsType: {},
        missingApplicationInsights: apps.filter((a) => !a.applicationInsightsLinked).map((a) => a.name),
        missingManagedIdentity: apps.filter((a) => a.managedIdentityType === 'None').map((a) => a.name),
        httpsOnlyDisabled: apps.filter((a) => !a.httpsOnly).map((a) => a.name),
        corsWildcard: apps.filter((a) => a.corsWildcard).map((a) => a.name),
        missingHealthCheck: apps.filter((a) => !a.healthCheckConfigured).map((a) => a.name),
        totalDeploymentSlots: apps.reduce((sum, a) => sum + a.slotCount, 0),
    };

    for (const app of apps) {
        const runtimeKey = app.runtime.runtimeName || 'unknown';
        summary.byRuntime[runtimeKey] = (summary.byRuntime[runtimeKey] || 0) + 1;
        summary.byOsType[app.runtime.osType] = (summary.byOsType[app.runtime.osType] || 0) + 1;
    }

    return { resourceGroup: args.resourceGroup, apps, summary };
}

module.exports = { execute };
