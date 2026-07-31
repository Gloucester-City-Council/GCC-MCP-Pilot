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
const SERVER_TIMEOUT_SECONDS = 60;

function buildQuery(maxRows) {
    return `union isfuzzy=true exceptions, traces
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
    const query = buildQuery(maxRows);

    let result;
    try {
        result = await logsClient.queryResource(appInsights.id, query, timespan, { serverTimeoutInSeconds: SERVER_TIMEOUT_SECONDS });
    } catch (err) {
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
