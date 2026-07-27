/**
 * Tool: azure_static_web_app_inspect
 *
 * Full operational detail for a single Static Web App: SKU, region,
 * repository linkage (URL + branch only — never the repo token),
 * deployment/staging environments, custom domains with certificate
 * status, application setting NAMES (never values), linked backend(s),
 * and managed identity.
 *
 * SECURITY: this tool never calls staticSites.listStaticSiteSecrets and
 * never returns application-setting values — see ./_shared.js.
 *
 * Route configuration (staticwebapp.config.json) and identity-provider
 * (auth) configuration are not exposed by the Static Web Apps ARM surface
 * — both are reported back with an explicit "not inspectable via ARM"
 * note rather than guessed at.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const {
    toSiteSummary, toCustomDomainSummary, toEnvironmentSummary, toLinkedBackendSummary,
    namesOnly, classifySettingNames, collectAsyncIterable, getStaticSiteOrNotFound,
} = require('./_shared');

async function bestEffort(promiseFactory, fallback) {
    try {
        return await promiseFactory();
    } catch (_err) {
        return fallback;
    }
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'static-web-apps', 'inspect');
    const client = getWebSiteClient(instance);

    const site = await getStaticSiteOrNotFound(client, args.resourceGroup, args.name, instance.name);

    const [customDomains, environments, linkedBackends, appSettingsResult, configuredRoles] = await Promise.all([
        bestEffort(() => collectAsyncIterable(client.staticSites.listStaticSiteCustomDomains(args.resourceGroup, args.name)), []),
        bestEffort(() => collectAsyncIterable(client.staticSites.listStaticSiteBuilds(args.resourceGroup, args.name)), []),
        bestEffort(() => collectAsyncIterable(client.staticSites.listLinkedBackends(args.resourceGroup, args.name)), []),
        // Values are discarded immediately via namesOnly() — never held onto, never returned.
        bestEffort(() => client.staticSites.listStaticSiteAppSettings(args.resourceGroup, args.name), { properties: {} }),
        bestEffort(() => client.staticSites.listStaticSiteConfiguredRoles(args.resourceGroup, args.name), null),
    ]);

    const settingNames = namesOnly(appSettingsResult);
    const { secretLike, plain } = classifySettingNames(settingNames);

    return {
        ...toSiteSummary(site, args.resourceGroup),
        managedIdentity: site.identity ? { type: site.identity.type, principalId: site.identity.principalId || null, tenantId: site.identity.tenantId || null } : null,
        customDomains: customDomains.map(toCustomDomainSummary),
        // listStaticSiteBuilds returns the PR/staging preview environments — the
        // production environment is the static site resource itself, not a build.
        environments: environments.map(toEnvironmentSummary),
        stagingEnvironments: {
            note: 'Static Web Apps builds ARE the staging/preview environments (the production environment is the site resource itself, not a build) — see "environments" above.',
            names: environments.map((b) => b.name || b.buildId).filter(Boolean),
        },
        linkedBackends: linkedBackends.map(toLinkedBackendSummary),
        applicationSettings: {
            note: 'Names only — values are never fetched or returned by this MCP.',
            secretLikeNames: secretLike,
            plainNames: plain,
            totalCount: settingNames.length,
        },
        authentication: {
            note: 'Identity-provider configuration (staticwebapp.config.json) is not exposed via the Static Web Apps ARM API — not inspectable via ARM, check repo config.',
            configuredRoles: (configuredRoles && configuredRoles.properties) || null,
        },
        routes: {
            note: 'Route configuration is defined in the repo\'s staticwebapp.config.json and is not exposed via ARM — not inspectable via ARM, check repo config.',
        },
    };
}

module.exports = { execute };
