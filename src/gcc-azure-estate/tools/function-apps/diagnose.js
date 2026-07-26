/**
 * Tool: azure_function_app_diagnose
 *
 * Deterministic checklist (no LLM judgement): TLS minimum version below
 * 1.2, HTTPS-only disabled, CORS wildcard, missing Application Insights,
 * missing managed identity, no storage account reachable, missing health
 * check path.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient, getStorageMgmtClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { extractStorageAccountName, detectAppInsightsLinkage } = require('./shared');

function checkTlsMinVersion(minTlsVersion) {
    const version = parseFloat(minTlsVersion);
    const pass = !Number.isNaN(version) && version >= 1.2;
    return {
        pass,
        minTlsVersion: minTlsVersion || null,
        message: pass ? 'Minimum TLS version is 1.2 or higher' : `Minimum TLS version is "${minTlsVersion || '(unset)'}" — should be at least 1.2`,
    };
}

function checkHttpsOnly(httpsOnly) {
    return {
        pass: !!httpsOnly,
        message: httpsOnly ? 'HTTPS-only is enabled' : 'HTTPS-only is disabled — plain HTTP requests are accepted',
    };
}

function checkCorsWildcard(cors) {
    const origins = (cors && cors.allowedOrigins) || [];
    const wildcard = origins.includes('*');
    return {
        pass: !wildcard,
        allowedOrigins: origins,
        message: wildcard ? 'CORS allows all origins ("*") — this is a broad exposure' : 'CORS is not wildcarded',
    };
}

function checkAppInsights(appInsights) {
    return {
        pass: appInsights.linked,
        message: appInsights.linked ? 'Application Insights is linked' : 'No Application Insights instrumentation key or connection string app setting found',
    };
}

function checkManagedIdentity(identity) {
    const type = (identity && identity.type) || 'None';
    const pass = type !== 'None';
    return { pass, identityType: type, message: pass ? `Managed identity enabled (${type})` : 'No managed identity configured' };
}

async function checkStorageReachable(storageClient, resourceGroup, accountName) {
    if (!accountName) {
        return { pass: false, accountName: null, message: 'AzureWebJobsStorage app setting is missing or has no parseable account name' };
    }

    try {
        await storageClient.storageAccounts.getProperties(resourceGroup, accountName);
        return { pass: true, accountName, message: `Storage account "${accountName}" is reachable in this resource group` };
    } catch (err) {
        if (err.statusCode === 404) {
            return {
                pass: false,
                accountName,
                message: `Storage account "${accountName}" was not found in resource group "${resourceGroup}" (it may live in a different resource group)`,
            };
        }
        return { pass: false, accountName, message: `Storage account "${accountName}" reachability could not be confirmed: ${err.message}` };
    }
}

function checkHealthCheck(healthCheckPath) {
    return {
        pass: !!healthCheckPath,
        healthCheckPath: healthCheckPath || null,
        message: healthCheckPath ? `Health check path is configured (${healthCheckPath})` : 'No health check path configured',
    };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'diagnose');
    const client = getWebSiteClient(instance);
    const storageClient = getStorageMgmtClient(instance);

    let site;
    try {
        site = await client.webApps.get(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Function App "${args.name}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const siteConfig = await client.webApps.getConfiguration(args.resourceGroup, args.name);
    const appSettings = await client.webApps.listApplicationSettings(args.resourceGroup, args.name);
    const properties = appSettings.properties || {};
    const appInsights = detectAppInsightsLinkage(properties);
    const storageAccountName = extractStorageAccountName(properties.AzureWebJobsStorage);

    const findings = {
        tlsMinVersion: checkTlsMinVersion(siteConfig.minTlsVersion),
        httpsOnly: checkHttpsOnly(site.httpsOnly),
        corsWildcard: checkCorsWildcard(siteConfig.cors),
        applicationInsights: checkAppInsights(appInsights),
        managedIdentity: checkManagedIdentity(site.identity),
        storageAccountReachable: await checkStorageReachable(storageClient, args.resourceGroup, storageAccountName),
        healthCheck: checkHealthCheck(siteConfig.healthCheckPath),
    };

    const failedChecks = Object.entries(findings)
        .filter(([, v]) => v.pass === false)
        .map(([key]) => key);

    return {
        name: site.name,
        resourceGroup: args.resourceGroup,
        overallStatus: failedChecks.length === 0 ? 'PASS' : 'FINDINGS',
        failedChecks,
        findings,
    };
}

module.exports = { execute };
