/**
 * Tool: azure_function_app_create
 *
 * Creates a Function App. Dependencies (existing storage account,
 * existing Application Insights resource, existing hosting plan) must
 * already exist — this tool never provisions them and fails with
 * DEPENDENCY_MISSING rather than silently defaulting anything.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const {
    getResourceClient, getWebSiteClient, getStorageMgmtClient, getAppInsightsClient,
} = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { assessCreateDependencies, buildStorageConnectionString } = require('./shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'location', 'hostingPlanName', 'storageAccountName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'create');

    const resourceClient = getResourceClient(instance);
    const webSiteClient = getWebSiteClient(instance);
    const storageClient = getStorageMgmtClient(instance);
    const appInsightsClient = getAppInsightsClient(instance);

    let existing = null;
    try {
        existing = await webSiteClient.webApps.get(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    if (existing) {
        throw new AzureEstateError(ERROR_CODES.CONFLICT, `Function App "${args.name}" already exists in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
    }

    const { dependencies, missingDependencies, readyToCreate } = await assessCreateDependencies(
        { resourceClient, webSiteClient, storageClient, appInsightsClient },
        args
    );

    if (!readyToCreate) {
        throw new AzureEstateError(
            ERROR_CODES.DEPENDENCY_MISSING,
            `Cannot create Function App "${args.name}" — missing dependencies: ${missingDependencies.join(', ')}`,
            { missingDependencies, dependencies }
        );
    }

    const osType = dependencies.runtimeConfig.osType === 'Windows' ? 'Windows' : 'Linux';
    const isLinux = osType === 'Linux';

    const siteConfig = {};
    if (isLinux) {
        siteConfig.linuxFxVersion = `${args.runtime.name.toUpperCase()}|${args.runtime.version}`;
    } else if (args.runtime.name === 'node') {
        siteConfig.nodeVersion = `~${args.runtime.version}`;
    } else if (args.runtime.name === 'dotnet') {
        siteConfig.netFrameworkVersion = args.runtime.version;
    }

    const siteEnvelope = {
        location: args.location,
        kind: isLinux ? 'functionapp,linux' : 'functionapp',
        reserved: isLinux,
        serverFarmId: `/subscriptions/${instance.subscriptionId}/resourceGroups/${dependencies.hostingPlan.resourceGroup}/providers/Microsoft.Web/serverfarms/${dependencies.hostingPlan.name}`,
        httpsOnly: true,
        siteConfig: { ...siteConfig, minTlsVersion: '1.2' },
        tags: args.tags || {},
    };

    if (dependencies.identity.requested && dependencies.identity.requested !== 'None') {
        siteEnvelope.identity = { type: dependencies.identity.requested };
    }

    const poller = await webSiteClient.webApps.createOrUpdate(args.resourceGroup, args.name, siteEnvelope);
    const created = await poller.pollUntilDone();

    // Seed the app settings a working Function App needs. Values are
    // computed here (storage key, App Insights connection string) but
    // never included in this tool's return value — only the setting
    // NAMES are reported back.
    const storageKeys = await storageClient.storageAccounts.listKeys(dependencies.storageAccount.resourceGroup, args.storageAccountName);
    const storageKey = storageKeys.keys && storageKeys.keys[0] && storageKeys.keys[0].value;
    const storageConnectionString = buildStorageConnectionString(args.storageAccountName, storageKey);

    const appSettings = {
        AzureWebJobsStorage: storageConnectionString,
        FUNCTIONS_EXTENSION_VERSION: '~4',
        FUNCTIONS_WORKER_RUNTIME: args.runtime.name,
        ...(args.appSettings || {}),
    };

    if (dependencies.applicationInsights.present) {
        const component = await appInsightsClient.components.get(dependencies.applicationInsights.resourceGroup, args.appInsightsName);
        if (component.connectionString) {
            appSettings.APPLICATIONINSIGHTS_CONNECTION_STRING = component.connectionString;
        }
    }

    await webSiteClient.webApps.updateApplicationSettings(args.resourceGroup, args.name, { properties: appSettings });

    return {
        created: true,
        name: created.name,
        resourceGroup: args.resourceGroup,
        location: created.location,
        kind: created.kind,
        serverFarmId: created.serverFarmId,
        identity: (created.identity && created.identity.type) || 'None',
        storageAccountName: args.storageAccountName,
        applicationInsightsLinked: dependencies.applicationInsights.present,
        appSettingsConfigured: Object.keys(appSettings),
    };
}

module.exports = { execute };
