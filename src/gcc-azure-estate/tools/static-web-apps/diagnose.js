/**
 * Tool: azure_static_web_app_diagnose
 *
 * Deterministic (no LLM judgement) checklist against a single Static Web
 * App: missing custom domain certificates, an app that clearly expects a
 * linked API but has none, a Free SKU sitting in a production resource
 * group, and missing authentication/authorization configuration.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient, getResourceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const {
    namesOnly, collectAsyncIterable, getStaticSiteOrNotFound,
} = require('./_shared');

const API_EXPECTATION_NAME_PATTERN = /(^|_)(api|backend|function)(_|$)/i;
const DEFAULT_BUILT_IN_ROLES = new Set(['anonymous', 'authenticated']);

async function bestEffort(promiseFactory, fallback) {
    try {
        return await promiseFactory();
    } catch (_err) {
        return fallback;
    }
}

function checkCustomDomainCertificates(customDomains) {
    const notReady = customDomains.filter((d) => (d.status || '').toLowerCase() !== 'ready');
    return {
        pass: notReady.length === 0,
        message: notReady.length
            ? `${notReady.length} custom domain(s) do not have a Ready certificate/validation status: ${notReady.map((d) => `${d.domainName || d.name} (${d.status})`).join(', ')}`
            : customDomains.length ? 'All custom domains are Ready' : 'No custom domains configured',
        domains: notReady.map((d) => ({ domainName: d.domainName || d.name, status: d.status || null })),
    };
}

function checkLinkedBackend(settingNames, linkedBackends, userProvidedFunctionApps) {
    const expectsApi = settingNames.some((n) => API_EXPECTATION_NAME_PATTERN.test(n));
    const hasBackend = linkedBackends.length > 0 || userProvidedFunctionApps.length > 0;

    if (!expectsApi) {
        return { pass: true, message: 'No API-shaped application settings detected — no backend expectation to check', expectsApi: false, hasBackend };
    }

    return {
        pass: hasBackend,
        message: hasBackend
            ? 'Application settings suggest an API dependency and a backend is linked'
            : 'Application settings suggest this app expects an API (setting name(s) matching /api|backend|function/i) but no backend is linked (see azure_static_web_app_backend_link_plan)',
        expectsApi: true,
        hasBackend,
    };
}

function checkSkuForProduction(sku, resourceGroupTags) {
    const isFreeSku = (sku && sku.name || '').toLowerCase() === 'free';
    const isProductionRg = (resourceGroupTags.environment || '').toLowerCase() === 'production';

    if (!isProductionRg) {
        return { pass: true, message: 'Resource group is not tagged environment=production — SKU check not applicable', sku: sku ? sku.name : null };
    }

    return {
        pass: !isFreeSku,
        message: isFreeSku
            ? 'SKU is Free in a resource group tagged environment=production — Free tier has no SLA, no staging environments beyond limited preview, and no custom-domain certificate management guarantees'
            : `SKU (${sku ? sku.name : 'unknown'}) is appropriate for a production resource group`,
        sku: sku ? sku.name : null,
    };
}

function checkAuthenticationConfig(configuredRoles) {
    const roles = (configuredRoles && configuredRoles.properties) || [];
    const customRoles = roles.filter((r) => !DEFAULT_BUILT_IN_ROLES.has((r || '').toLowerCase()));

    return {
        pass: customRoles.length > 0,
        message: customRoles.length > 0
            ? `Custom role(s) configured: ${customRoles.join(', ')}`
            : 'No custom authorization roles configured (only built-in anonymous/authenticated, or none at all). Note: identity-provider configuration itself lives in staticwebapp.config.json and is not inspectable via ARM — verify directly in the repo.',
        configuredRoles: roles,
    };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'static-web-apps', 'diagnose');
    const client = getWebSiteClient(instance);
    const resourceClient = getResourceClient(instance);

    const site = await getStaticSiteOrNotFound(client, args.resourceGroup, args.name, instance.name);

    const [customDomains, linkedBackends, appSettingsResult, configuredRoles, resourceGroup] = await Promise.all([
        bestEffort(() => collectAsyncIterable(client.staticSites.listStaticSiteCustomDomains(args.resourceGroup, args.name)), []),
        bestEffort(() => collectAsyncIterable(client.staticSites.listLinkedBackends(args.resourceGroup, args.name)), []),
        bestEffort(() => client.staticSites.listStaticSiteAppSettings(args.resourceGroup, args.name), { properties: {} }),
        bestEffort(() => client.staticSites.listStaticSiteConfiguredRoles(args.resourceGroup, args.name), { properties: [] }),
        bestEffort(() => resourceClient.resourceGroups.get(args.resourceGroup), { tags: {} }),
    ]);

    const settingNames = namesOnly(appSettingsResult);

    const findings = {
        missingCustomDomainCertificate: checkCustomDomainCertificates(customDomains),
        noLinkedBackendForApiApp: checkLinkedBackend(settingNames, linkedBackends, site.userProvidedFunctionApps || []),
        skuMismatchForProduction: checkSkuForProduction(site.sku, resourceGroup.tags || {}),
        missingAuthenticationConfig: checkAuthenticationConfig(configuredRoles),
    };

    const failedChecks = Object.entries(findings).filter(([, v]) => v.pass === false).map(([key]) => key);

    return {
        name: site.name,
        resourceGroup: args.resourceGroup,
        overallStatus: failedChecks.length === 0 ? 'PASS' : 'FINDINGS',
        failedChecks,
        findings,
    };
}

module.exports = { execute };
