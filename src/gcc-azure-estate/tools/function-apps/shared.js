/**
 * Shared helpers for the Function Apps family. Kept local to this family
 * (not lib/) since none of it is resource-group-generic.
 *
 * Secret hygiene: several helpers here exist specifically so that no tool
 * in this family ever needs to return a raw app-setting VALUE. Setting
 * names + a coarse classification is the most any tool surfaces.
 */

'use strict';

const SECRET_NAME_PATTERN = /key|secret|token|conn(ection)?str(ing)?|password|pwd|credential/i;
const KEYVAULT_REF_PATTERN = /^@Microsoft\.KeyVault\(/i;
const STORAGE_ACCOUNT_NAME_PATTERN = /AccountName=([^;]+)/i;
const SERVER_FARM_ID_PATTERN = /resourceGroups\/([^/]+)\/providers\/Microsoft\.Web\/serverfarms\/([^/]+)/i;
const APP_INSIGHTS_RESOURCE_ID_PATTERN = /resourceGroups\/([^/]+)\/providers\/Microsoft\.Insights\/components\/([^/]+)/i;
// The tag the Portal itself sets on a site resource when Application
// Insights is linked via the "Application Insights" blade — the
// authoritative link, independent of whatever's (or isn't) readable in app
// settings. Key has historically appeared with and without the space after
// the colon, so match loosely rather than by exact string.
const HIDDEN_LINK_APP_INSIGHTS_TAG_PATTERN = /^hidden-link:\s*\/app-insights-resource-id$/i;

// Well-known Azure App Service setting names that carry a secret value
// despite not literally matching SECRET_NAME_PATTERN by substring — kept
// as an explicit allowlist rather than relying on regex luck.
const KNOWN_SECRET_SETTING_NAMES = new Set([
    'AzureWebJobsStorage',
    'AzureWebJobsDashboard',
    'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING',
]);

/** Coarse, name-based classification only — never inspects/returns the value. */
function classifySettingName(name) {
    if (KNOWN_SECRET_SETTING_NAMES.has(name)) return 'secret-like';
    return SECRET_NAME_PATTERN.test(name) ? 'secret-like' : 'plain';
}

/**
 * Builds the name+classification+keyVaultReference view of an app-settings
 * StringDictionary's `properties` map. Values are read only to test the
 * Key Vault reference pattern and are never included in the return value.
 */
function buildSettingsMetadata(properties) {
    const props = properties || {};
    return Object.keys(props).map((name) => {
        const value = props[name];
        return {
            name,
            classification: classifySettingName(name),
            keyVaultReference: typeof value === 'string' && KEYVAULT_REF_PATTERN.test(value.trim()),
        };
    });
}

/** Extracts only the storage account name from a connection string — never the full string. */
function extractStorageAccountName(connectionString) {
    if (typeof connectionString !== 'string') return null;
    const match = connectionString.match(STORAGE_ACCOUNT_NAME_PATTERN);
    return match ? match[1] : null;
}

function detectAppInsightsLinkage(properties) {
    const props = properties || {};
    const hasKey = Object.prototype.hasOwnProperty.call(props, 'APPINSIGHTS_INSTRUMENTATIONKEY');
    const hasConnString = Object.prototype.hasOwnProperty.call(props, 'APPLICATIONINSIGHTS_CONNECTION_STRING');
    return {
        instrumentationKeyConfigured: hasKey,
        connectionStringConfigured: hasConnString,
        linked: hasKey || hasConnString,
    };
}

/** site.reserved => Linux; parses linuxFxVersion / nodeVersion / netFrameworkVersion / functionAppConfig.runtime. */
function deriveRuntime(site, siteConfig) {
    const osType = site.reserved ? 'Linux' : 'Windows';
    let runtimeName = null;
    let runtimeVersion = null;

    if (site.functionAppConfig && site.functionAppConfig.runtime) {
        runtimeName = site.functionAppConfig.runtime.name || null;
        runtimeVersion = site.functionAppConfig.runtime.version || null;
    } else if (osType === 'Linux' && siteConfig && siteConfig.linuxFxVersion) {
        const [name, version] = siteConfig.linuxFxVersion.split('|');
        runtimeName = (name || '').toLowerCase() || null;
        runtimeVersion = version || null;
    } else if (siteConfig && siteConfig.nodeVersion) {
        runtimeName = 'node';
        runtimeVersion = siteConfig.nodeVersion;
    } else if (siteConfig && siteConfig.netFrameworkVersion) {
        runtimeName = 'dotnet';
        runtimeVersion = siteConfig.netFrameworkVersion;
    }

    const nodeVersion = (runtimeName === 'node' ? runtimeVersion : null)
        || (siteConfig && siteConfig.nodeVersion) || null;

    return {
        osType, runtimeName, runtimeVersion, nodeVersion, isFlexConsumption: !!(site.functionAppConfig),
    };
}

function parseServerFarmId(id) {
    if (!id) return null;
    const match = id.match(SERVER_FARM_ID_PATTERN);
    if (!match) return null;
    return { resourceGroup: match[1], name: match[2] };
}

function parseAppInsightsResourceId(id) {
    if (typeof id !== 'string') return null;
    const match = id.match(APP_INSIGHTS_RESOURCE_ID_PATTERN);
    if (!match) return null;
    return { resourceGroup: match[1], name: match[2] };
}

/** Finds the hidden-link App Insights resource ID among a site's tags, tolerating the key's inconsistent spacing. */
function findHiddenLinkAppInsightsId(tags) {
    if (!tags) return null;
    const key = Object.keys(tags).find((k) => HIDDEN_LINK_APP_INSIGHTS_TAG_PATTERN.test(k));
    return key ? tags[key] : null;
}

/** Best-effort hosting-plan summary — never throws; failures are surfaced as a flag, not an exception. */
async function getHostingPlanSummary(webSiteClient, serverFarmId) {
    const parsed = parseServerFarmId(serverFarmId);
    if (!parsed) return { available: false, reason: 'No serverFarmId on the site' };

    try {
        const plan = await webSiteClient.appServicePlans.get(parsed.resourceGroup, parsed.name);
        return {
            available: true,
            name: plan.name,
            resourceGroup: parsed.resourceGroup,
            skuName: (plan.sku && plan.sku.name) || null,
            skuTier: (plan.sku && plan.sku.tier) || null,
            kind: plan.kind || null,
            reserved: !!plan.reserved,
        };
    } catch (_err) {
        return {
            available: false, name: parsed.name, resourceGroup: parsed.resourceGroup, reason: 'Hosting plan lookup failed',
        };
    }
}

function isFunctionApp(site) {
    return !!(site && site.kind && site.kind.includes('functionapp'));
}

/**
 * Assesses every dependency a Function App create needs, making them
 * explicit rather than silently defaulted. Never creates anything itself
 * — read-only lookups only. Shared by azure_function_app_create_plan (to
 * report) and azure_function_app_create (to gate with DEPENDENCY_MISSING).
 */
async function assessCreateDependencies(clients, args) {
    const {
        resourceClient, webSiteClient, storageClient, appInsightsClient,
    } = clients;

    const dependencies = {};

    // Resource group must already exist — this family does not create them.
    try {
        const rg = await resourceClient.resourceGroups.get(args.resourceGroup);
        dependencies.resourceGroup = { present: true, name: rg.name, location: rg.location };
    } catch (err) {
        if (err.statusCode !== 404) throw err;
        dependencies.resourceGroup = { present: false, name: args.resourceGroup, reason: 'Resource group does not exist' };
    }

    // Hosting plan (App Service Plan) must already exist.
    if (args.hostingPlanName) {
        const planRg = args.hostingPlanResourceGroup || args.resourceGroup;
        try {
            const plan = await webSiteClient.appServicePlans.get(planRg, args.hostingPlanName);
            dependencies.hostingPlan = {
                present: true, name: plan.name, resourceGroup: planRg, skuName: (plan.sku && plan.sku.name) || null, reserved: !!plan.reserved,
            };
        } catch (err) {
            if (err.statusCode !== 404) throw err;
            dependencies.hostingPlan = { present: false, name: args.hostingPlanName, resourceGroup: planRg, reason: 'Hosting plan does not exist' };
        }
    } else {
        dependencies.hostingPlan = { present: false, reason: 'No hostingPlanName supplied' };
    }

    // Storage account must already exist — this MCP never provisions one.
    if (args.storageAccountName) {
        const storageRg = args.storageAccountResourceGroup || args.resourceGroup;
        try {
            await storageClient.storageAccounts.getProperties(storageRg, args.storageAccountName);
            dependencies.storageAccount = { present: true, name: args.storageAccountName, resourceGroup: storageRg };
        } catch (err) {
            if (err.statusCode !== 404) throw err;
            dependencies.storageAccount = {
                present: false, name: args.storageAccountName, resourceGroup: storageRg, reason: 'Storage account does not exist',
            };
        }
    } else {
        dependencies.storageAccount = { present: false, reason: 'No storageAccountName supplied — caller must provide an existing storage account' };
    }

    // Application Insights is strongly recommended but optional.
    if (args.appInsightsName) {
        const aiRg = args.appInsightsResourceGroup || args.resourceGroup;
        try {
            await appInsightsClient.components.get(aiRg, args.appInsightsName);
            dependencies.applicationInsights = { present: true, name: args.appInsightsName, resourceGroup: aiRg };
        } catch (err) {
            if (err.statusCode !== 404) throw err;
            dependencies.applicationInsights = {
                present: false, name: args.appInsightsName, resourceGroup: aiRg, reason: 'Application Insights resource does not exist',
            };
        }
    } else {
        dependencies.applicationInsights = { present: false, optional: true, reason: 'No appInsightsName supplied — app will be created without Application Insights linkage' };
    }

    dependencies.runtimeConfig = (args.runtime && args.runtime.name && args.runtime.version)
        ? { present: true, name: args.runtime.name, version: args.runtime.version, osType: args.osType || 'Linux' }
        : { present: false, reason: 'runtime.name and runtime.version are both required' };

    dependencies.identity = { present: !!args.identity && args.identity !== 'None', requested: args.identity || 'None' };

    dependencies.appSettings = {
        present: !!(args.appSettings && Object.keys(args.appSettings).length > 0),
        names: args.appSettings ? Object.keys(args.appSettings) : [],
    };

    // Hard-required dependencies (identity/appSettings/applicationInsights are optional-by-design).
    const requiredKeys = ['resourceGroup', 'hostingPlan', 'storageAccount', 'runtimeConfig'];
    const missingDependencies = requiredKeys.filter((key) => !dependencies[key].present);

    return { dependencies, missingDependencies, readyToCreate: missingDependencies.length === 0 };
}

/** Builds a storage connection string for a newly-created app's AzureWebJobsStorage setting. Never logged/returned by callers. */
function buildStorageConnectionString(accountName, accountKey) {
    return `DefaultEndpointsProtocol=https;AccountName=${accountName};AccountKey=${accountKey};EndpointSuffix=core.windows.net`;
}

const APP_INSIGHTS_CONNECTION_STRING_IKEY_PATTERN = /InstrumentationKey=([^;]+)/i;

/** Extracts only the instrumentation key from a settings map — used internally to resolve the linked App Insights *resource*, never returned to a tool caller as-is. */
function extractInstrumentationKey(properties) {
    const props = properties || {};
    if (props.APPINSIGHTS_INSTRUMENTATIONKEY) return props.APPINSIGHTS_INSTRUMENTATIONKEY;
    const connString = props.APPLICATIONINSIGHTS_CONNECTION_STRING;
    if (typeof connString === 'string') {
        const match = connString.match(APP_INSIGHTS_CONNECTION_STRING_IKEY_PATTERN);
        if (match) return match[1];
    }
    return null;
}

/** Instrumentation keys are GUIDs — normalize case/whitespace before comparing, since the app setting and the ARM component's reported value aren't guaranteed to match byte-for-byte. */
function normalizeInstrumentationKey(key) {
    return typeof key === 'string' ? key.trim().toLowerCase() : key;
}

/** Fetches every ApplicationInsightsComponent in a resource group, following nextLink (this SDK generation returns {value, nextLink}, not an async iterator — see git history of tools/common/subscriptions-list.js for what happens when a page gets dropped silently). */
async function listAppInsightsComponents(appInsightsClient, resourceGroup, abortSignal) {
    const components = [];
    let page = await appInsightsClient.components.listByResourceGroup(resourceGroup, { abortSignal });
    components.push(...(page.value || []));
    while (page.nextLink) {
        page = await appInsightsClient.components.listByResourceGroupNext(page.nextLink, { abortSignal });
        components.push(...(page.value || []));
    }
    return components;
}

/**
 * Resolves the Application Insights *resource* linked to a Function App,
 * for tools/function-apps/logs-*.js to query. Never guessed beyond what's
 * actually configured, tried in this order:
 *   1. `appInsightsName`, if the caller supplied one — fetched directly.
 *   2. The site's `hidden-link: /app-insights-resource-id` tag — the exact
 *      resource ID the Portal itself writes when App Insights is linked via
 *      its "Application Insights" blade. Authoritative, and independent of
 *      whether the instrumentation key is actually readable from app
 *      settings (e.g. behind a Key Vault reference) or of naming
 *      conventions matching between the app and the component.
 *   3. Falling back to APPINSIGHTS_INSTRUMENTATIONKEY /
 *      APPLICATIONINSIGHTS_CONNECTION_STRING app-setting matching against
 *      components in the target resource group, for older apps that
 *      predate the hidden-link tag.
 * Throws DEPENDENCY_MISSING with a clear, actionable message only once
 * every path above is exhausted — never returns a guess.
 *
 * `args.abortSignal`, when supplied, bounds every ARM call this makes. Log
 * tools pass in the same deadline signal they reuse for the log query
 * itself, so a slow/hanging resolution can't silently eat the client-side
 * timeout budget before the query even starts (see logs-query.js).
 */
async function resolveAppInsightsForFunctionApp(clients, args) {
    const { webSiteClient, appInsightsClient } = clients;
    const { AzureEstateError, ERROR_CODES } = require('../../lib/errors');

    const searchResourceGroup = args.appInsightsResourceGroup || args.resourceGroup;
    const { abortSignal } = args;

    if (args.appInsightsName) {
        try {
            const component = await appInsightsClient.components.get(searchResourceGroup, args.appInsightsName, { abortSignal });
            return { id: component.id, name: component.name, resourceGroup: searchResourceGroup };
        } catch (err) {
            if (err.statusCode === 404) {
                throw new AzureEstateError(
                    ERROR_CODES.DEPENDENCY_MISSING,
                    `Application Insights resource "${args.appInsightsName}" does not exist in resource group "${searchResourceGroup}".`,
                    { missingDependency: 'appInsights', appInsightsName: args.appInsightsName }
                );
            }
            throw err;
        }
    }

    try {
        const site = await webSiteClient.webApps.get(args.resourceGroup, args.name, { abortSignal });
        const parsed = parseAppInsightsResourceId(findHiddenLinkAppInsightsId(site.tags));
        if (parsed) {
            const component = await appInsightsClient.components.get(parsed.resourceGroup, parsed.name, { abortSignal });
            return { id: component.id, name: component.name, resourceGroup: parsed.resourceGroup };
        }
    } catch (err) {
        // An abort mid-lookup will only fail again identically on the
        // fallback path below — surface it now rather than mask it.
        if (err.name === 'AbortError' || (abortSignal && abortSignal.aborted)) throw err;
        // Otherwise best-effort only (tag missing, or the tagged component
        // no longer exists) — fall through to instrumentation-key matching.
    }

    const settings = await webSiteClient.webApps.listApplicationSettings(args.resourceGroup, args.name, { abortSignal });
    const instrumentationKey = extractInstrumentationKey(settings.properties);
    if (!instrumentationKey) {
        throw new AzureEstateError(
            ERROR_CODES.DEPENDENCY_MISSING,
            `Function App "${args.name}" has no Application Insights linkage configured (no hidden-link tag, and no APPINSIGHTS_INSTRUMENTATIONKEY or APPLICATIONINSIGHTS_CONNECTION_STRING app setting). Pass appInsightsName explicitly if the resource exists under a different linkage.`,
            { missingDependency: 'appInsightsLinkage', functionAppName: args.name }
        );
    }

    const normalizedTarget = normalizeInstrumentationKey(instrumentationKey);
    const components = await listAppInsightsComponents(appInsightsClient, searchResourceGroup, abortSignal);
    const match = components.find((c) => normalizeInstrumentationKey(c.instrumentationKey) === normalizedTarget);
    if (!match) {
        throw new AzureEstateError(
            ERROR_CODES.DEPENDENCY_MISSING,
            `Function App "${args.name}" is linked to an Application Insights instrumentation key, but no matching component was found in resource group "${searchResourceGroup}". Pass appInsightsName (and appInsightsResourceGroup, if it lives elsewhere) explicitly.`,
            { missingDependency: 'appInsightsComponent', searchedResourceGroup: searchResourceGroup }
        );
    }

    return { id: match.id, name: match.name, resourceGroup: searchResourceGroup };
}

/**
 * Maps a @azure/monitor-query-logs LogsQueryResult into plain row objects
 * (one object per row, keyed by column name) — much more directly usable
 * than the SDK's parallel columnDescriptors/rows arrays. Truncates to
 * maxRows and reports whether truncation happened, since KQL queries can
 * return far more than any tool caller wants inlined into a response.
 */
function mapLogsQueryResult(result, maxRows) {
    const tables = (result.tables || result.partialTables || []).map((table) => {
        const columnNames = table.columnDescriptors.map((c) => c.name);
        const allRows = table.rows.map((row) => Object.fromEntries(columnNames.map((name, i) => [name, row[i]])));
        return {
            name: table.name,
            totalRows: allRows.length,
            rows: allRows.slice(0, maxRows),
            truncated: allRows.length > maxRows,
        };
    });

    return {
        status: result.status,
        tables,
        partialError: result.partialError ? { code: result.partialError.code, message: result.partialError.message } : null,
    };
}

module.exports = {
    classifySettingName,
    buildSettingsMetadata,
    extractStorageAccountName,
    detectAppInsightsLinkage,
    deriveRuntime,
    parseServerFarmId,
    getHostingPlanSummary,
    isFunctionApp,
    assessCreateDependencies,
    buildStorageConnectionString,
    resolveAppInsightsForFunctionApp,
    mapLogsQueryResult,
    SECRET_NAME_PATTERN,
    KEYVAULT_REF_PATTERN,
    STORAGE_ACCOUNT_NAME_PATTERN,
};
