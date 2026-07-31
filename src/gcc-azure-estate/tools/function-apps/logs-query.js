/**
 * Tool: azure_function_app_logs_query
 *
 * Runs a caller-supplied KQL query against a Function App's linked
 * Application Insights resource — the read-only log/trace access this
 * MCP was previously missing (config/health checks only, never log
 * *contents*). Bounded by a required timespanMinutes (never an
 * unbounded query) and a server-side query timeout, and truncates
 * returned rows to maxRows rather than inlining an unbounded result.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient, getAppInsightsClient, getLogsQueryClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { resolveAppInsightsForFunctionApp, mapLogsQueryResult } = require('./shared');

const MAX_TIMESPAN_MINUTES = 10080; // 7 days
const DEFAULT_MAX_ROWS = 200;
const HARD_MAX_ROWS = 500;
// The calling MCP client gives up and shows its own generic "connector
// not responding" message somewhere around ~30s, well before either of
// these fires if left at their original, more generous values — so this
// tool's only chance to report anything useful is to time out itself
// safely inside that external ceiling. serverTimeoutInSeconds bounds how
// long Azure Monitor spends *processing* the query; CLIENT_TIMEOUT_MS is
// a hard abort on the HTTP call itself (network issue, or the Managed
// Identity failing to acquire a token for this query API's audience,
// which is a different audience than every other tool in this MCP uses).
const SERVER_TIMEOUT_SECONDS = 15;
const CLIENT_TIMEOUT_MS = 20_000;

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'query', 'timespanMinutes']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    if (typeof args.timespanMinutes !== 'number' || args.timespanMinutes <= 0) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'timespanMinutes must be a positive number');
    }
    if (args.timespanMinutes > MAX_TIMESPAN_MINUTES) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `timespanMinutes must not exceed ${MAX_TIMESPAN_MINUTES} (7 days)`);
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

    const timespan = { duration: `PT${args.timespanMinutes}M` };

    let result;
    try {
        result = await logsClient.queryResource(appInsights.id, args.query, timespan, {
            serverTimeoutInSeconds: SERVER_TIMEOUT_SECONDS,
            abortSignal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
        });
    } catch (err) {
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
            throw new AzureEstateError(
                ERROR_CODES.INTERNAL_ERROR,
                `Log query timed out after ${CLIENT_TIMEOUT_MS / 1000}s without a response from Azure Monitor. If this happens consistently, check that the Function App's Managed Identity has a role granting Log Analytics/Application Insights query access (e.g. Monitoring Reader) — ARM Reader/Contributor alone may not cover this data-plane API.`,
                { query: args.query }
            );
        }
        throw new AzureEstateError(ERROR_CODES.INTERNAL_ERROR, `Log query failed: ${err.message}`, { query: args.query });
    }

    return {
        functionApp: args.name,
        applicationInsights: { name: appInsights.name, resourceGroup: appInsights.resourceGroup },
        timespanMinutes: args.timespanMinutes,
        ...mapLogsQueryResult(result, maxRows),
    };
}

module.exports = { execute };
