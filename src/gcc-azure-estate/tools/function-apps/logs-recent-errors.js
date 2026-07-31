/**
 * Tool: azure_function_app_logs_recent_errors
 *
 * Guided troubleshooting shortcut — recent exceptions and high-severity
 * traces for a Function App, without needing to hand-write KQL. Runs a
 * canned `union isfuzzy=true exceptions, traces` query (isfuzzy so rows
 * from either table are still returned when the other table's columns
 * don't exist on them) against the app's linked Application Insights
 * resource. For anything more specific than "what's been failing
 * recently", use azure_function_app_logs_query directly.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient, getAppInsightsClient, getLogsQueryClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { resolveAppInsightsForFunctionApp, mapLogsQueryResult } = require('./shared');

const MAX_TIMESPAN_MINUTES = 10080; // 7 days
const DEFAULT_TIMESPAN_MINUTES = 60;
const DEFAULT_MAX_ROWS = 50;
const HARD_MAX_ROWS = 500;
// See logs-query.js's matching comment: the calling MCP client gives up
// with its own generic "connector not responding" message around ~30s,
// so this tool's only chance to report anything useful is to time out
// safely inside that external ceiling, not at Azure Monitor's own pace.
const SERVER_TIMEOUT_SECONDS = 15;
const CLIENT_TIMEOUT_MS = 20_000;

/** Escapes a value for embedding in a double-quoted KQL string literal. */
function escapeKqlStringLiteral(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Scoped by cloud_RoleName (the App Insights field Azure Functions
// populates with the site name) — without this, a component shared by
// multiple Function Apps returns every app's exceptions/traces, all
// mislabeled as belonging to the one requested. =~ is KQL's
// case-insensitive equality, since cloud_RoleName casing isn't guaranteed
// to match the ARM resource name exactly.
function buildQuery(functionAppName, maxRows) {
    return `union isfuzzy=true exceptions, traces
| where cloud_RoleName =~ "${escapeKqlStringLiteral(functionAppName)}"
| where severityLevel >= 3 or itemType == "exception"
| order by timestamp desc
| take ${maxRows}
| project timestamp, itemType, severityLevel, message, outerMessage, problemId, operation_Name, cloud_RoleName`;
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const timespanMinutes = args.timespanMinutes || DEFAULT_TIMESPAN_MINUTES;
    if (typeof timespanMinutes !== 'number' || timespanMinutes <= 0 || timespanMinutes > MAX_TIMESPAN_MINUTES) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `timespanMinutes must be a positive number, at most ${MAX_TIMESPAN_MINUTES} (7 days)`);
    }
    if (args.maxRows !== undefined && (typeof args.maxRows !== 'number' || !Number.isInteger(args.maxRows) || args.maxRows <= 0)) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'maxRows must be a positive integer');
    }
    const maxRows = Math.min(args.maxRows || DEFAULT_MAX_ROWS, HARD_MAX_ROWS);

    const instance = assertPermitted(args.instance, 'function-apps', 'inspect');
    const webSiteClient = getWebSiteClient(instance);
    const appInsightsClient = getAppInsightsClient(instance);
    const logsClient = getLogsQueryClient();

    const appInsights = await resolveAppInsightsForFunctionApp(
        { webSiteClient, appInsightsClient },
        { resourceGroup: args.resourceGroup, name: args.name, appInsightsName: args.appInsightsName, appInsightsResourceGroup: args.appInsightsResourceGroup }
    );

    const timespan = { duration: `PT${timespanMinutes}M` };
    const query = buildQuery(args.name, maxRows);

    let result;
    try {
        result = await logsClient.queryResource(appInsights.id, query, timespan, {
            serverTimeoutInSeconds: SERVER_TIMEOUT_SECONDS,
            abortSignal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
        });
    } catch (err) {
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
            throw new AzureEstateError(
                ERROR_CODES.INTERNAL_ERROR,
                `Log query timed out after ${CLIENT_TIMEOUT_MS / 1000}s without a response from Azure Monitor. If this happens consistently, check that the Function App's Managed Identity has a role granting Log Analytics/Application Insights query access (e.g. Monitoring Reader) — ARM Reader/Contributor alone may not cover this data-plane API.`
            );
        }
        throw new AzureEstateError(ERROR_CODES.INTERNAL_ERROR, `Log query failed: ${err.message}`);
    }

    const mapped = mapLogsQueryResult(result, maxRows);
    const entries = (mapped.tables[0] || {}).rows || [];

    return {
        functionApp: args.name,
        applicationInsights: { name: appInsights.name, resourceGroup: appInsights.resourceGroup },
        timespanMinutes,
        totalEntries: entries.length,
        entries,
        status: mapped.status,
        partialError: mapped.partialError,
    };
}

module.exports = { execute };
