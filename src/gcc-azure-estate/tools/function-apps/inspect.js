/**
 * Tool: azure_function_app_inspect
 *
 * Single-app deep detail. By design this tool never returns an app-setting
 * VALUE — only setting names plus a coarse classification and a Key Vault
 * reference flag. See tools/function-apps/shared.js for the redaction
 * helpers this relies on.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const {
    buildSettingsMetadata, extractStorageAccountName, detectAppInsightsLinkage, deriveRuntime, getHostingPlanSummary,
} = require('./shared');

async function getSite(client, resourceGroup, name, instanceName) {
    try {
        return await client.webApps.get(resourceGroup, name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Function App "${name}" not found in resource group "${resourceGroup}" (instance "${instanceName}")`);
        }
        throw err;
    }
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'inspect');
    const client = getWebSiteClient(instance);

    const site = await getSite(client, args.resourceGroup, args.name, instance.name);
    const siteConfig = await client.webApps.getConfiguration(args.resourceGroup, args.name);
    const appSettings = await client.webApps.listApplicationSettings(args.resourceGroup, args.name);

    const slots = [];
    for await (const slot of client.webApps.listSlots(args.resourceGroup, args.name)) {
        slots.push(slot.name);
    }

    const properties = appSettings.properties || {};
    const storageAccountName = extractStorageAccountName(properties.AzureWebJobsStorage);
    const runtime = deriveRuntime(site, siteConfig);
    const hostingPlan = await getHostingPlanSummary(client, site.serverFarmId);

    return {
        name: site.name,
        resourceGroup: args.resourceGroup,
        location: site.location,
        runtime,
        hostingPlan,
        deploymentSlots: slots,
        appSettings: {
            count: Object.keys(properties).length,
            settings: buildSettingsMetadata(properties),
        },
        managedIdentity: {
            type: (site.identity && site.identity.type) || 'None',
            principalId: (site.identity && site.identity.principalId) || null,
        },
        storageDependency: { accountName: storageAccountName, configured: !!storageAccountName },
        applicationInsights: detectAppInsightsLinkage(properties),
        cors: {
            allowedOrigins: (siteConfig.cors && siteConfig.cors.allowedOrigins) || [],
            supportCredentials: !!(siteConfig.cors && siteConfig.cors.supportCredentials),
        },
        networking: {
            vnetIntegrated: !!siteConfig.vnetName || !!site.virtualNetworkSubnetId,
            vnetName: siteConfig.vnetName || null,
            virtualNetworkSubnetId: site.virtualNetworkSubnetId || null,
        },
        healthCheck: { path: siteConfig.healthCheckPath || null, configured: !!siteConfig.healthCheckPath },
        tls: {
            httpsOnly: !!site.httpsOnly,
            minTlsVersion: siteConfig.minTlsVersion || null,
            ftpsState: siteConfig.ftpsState || null,
        },
        scaleAndAvailability: {
            alwaysOn: !!siteConfig.alwaysOn,
            planSku: hostingPlan.skuName || null,
            planTier: hostingPlan.skuTier || null,
        },
        tags: site.tags || {},
    };
}

module.exports = { execute };
