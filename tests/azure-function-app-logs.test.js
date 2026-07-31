'use strict';

function notFound() {
    const err = new Error('not found');
    err.statusCode = 404;
    return err;
}

function mockWebSiteClient({ appSettings = {}, siteTags = {}, getImpl } = {}) {
    return {
        webApps: {
            get: getImpl || jest.fn(async () => ({ tags: siteTags })),
            listApplicationSettings: jest.fn(async () => ({ properties: appSettings })),
        },
    };
}

function mockAppInsightsClient({ components = [], componentsPage2 = null, getComponentImpl } = {}) {
    return {
        components: {
            get: getComponentImpl || jest.fn(async (rg, name) => {
                const found = components.find((c) => c.name === name);
                if (!found) throw notFound();
                return found;
            }),
            listByResourceGroup: jest.fn(async () => (
                componentsPage2 ? { value: components, nextLink: 'next-page-token' } : { value: components }
            )),
            listByResourceGroupNext: jest.fn(async () => ({ value: componentsPage2 || [] })),
        },
    };
}

function mockLogsQueryClient({ queryResourceImpl } = {}) {
    return { queryResource: queryResourceImpl || jest.fn() };
}

function setupClients({ webSiteClient, appInsightsClient, logsQueryClient }) {
    jest.doMock('@azure/arm-appservice', () => ({ WebSiteManagementClient: jest.fn().mockImplementation(() => webSiteClient) }));
    jest.doMock('@azure/arm-appinsights', () => ({ ApplicationInsightsManagementClient: jest.fn().mockImplementation(() => appInsightsClient) }));
    jest.doMock('@azure/monitor-query-logs', () => ({ LogsQueryClient: jest.fn().mockImplementation(() => logsQueryClient) }));
    jest.doMock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
}

const BASE_ARGS = { instance: 'azure-prod', resourceGroup: 'rg-rpg-engine', name: 'world-resolve-api' };
const SUCCESSFUL_RESULT = {
    status: 'Success',
    tables: [{
        name: 'PrimaryResult',
        columnDescriptors: [{ name: 'timestamp' }, { name: 'message' }],
        rows: [['2026-01-01T00:00:00Z', 'first'], ['2026-01-01T00:01:00Z', 'second']],
    }],
};

describe('Application Insights resolution (tools/function-apps/shared.js)', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('resolves the App Insights component by matching the instrumentation key from APPLICATIONINSIGHTS_CONNECTION_STRING', async () => {
        const component = { id: '/subscriptions/x/resourceGroups/rg-rpg-engine/providers/microsoft.insights/components/ai-world-resolve', name: 'ai-world-resolve', instrumentationKey: 'ikey-123' };
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: { APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=ikey-123;IngestionEndpoint=https://x' } }),
            appInsightsClient: mockAppInsightsClient({ components: [component] }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: jest.fn(async () => SUCCESSFUL_RESULT) }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const result = await execute(BASE_ARGS);

        expect(result.applicationInsights).toEqual({ name: 'ai-world-resolve', resourceGroup: 'rg-rpg-engine' });
    });

    it('follows nextLink when listing components across pages', async () => {
        const component = { id: '/id', name: 'ai-page-2', instrumentationKey: 'ikey-on-page-2' };
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: { APPINSIGHTS_INSTRUMENTATIONKEY: 'ikey-on-page-2' } }),
            appInsightsClient: mockAppInsightsClient({ components: [{ name: 'other', instrumentationKey: 'not-a-match' }], componentsPage2: [component] }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: jest.fn(async () => SUCCESSFUL_RESULT) }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const result = await execute(BASE_ARGS);

        expect(result.applicationInsights.name).toBe('ai-page-2');
    });

    it('resolves via the hidden-link tag when no instrumentation-key app setting exists', async () => {
        const getComponent = jest.fn(async (rg, name) => ({ id: `/subscriptions/x/resourceGroups/${rg}/providers/microsoft.insights/components/${name}`, name, instrumentationKey: 'ikey' }));
        setupClients({
            webSiteClient: mockWebSiteClient({
                appSettings: {},
                siteTags: { 'hidden-link: /app-insights-resource-id': '/subscriptions/x/resourceGroups/rg-rpg-engine/providers/microsoft.insights/components/world-resolve-api' },
            }),
            appInsightsClient: mockAppInsightsClient({ getComponentImpl: getComponent }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: jest.fn(async () => SUCCESSFUL_RESULT) }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const result = await execute(BASE_ARGS);

        expect(getComponent).toHaveBeenCalledWith('rg-rpg-engine', 'world-resolve-api', { abortSignal: expect.anything() });
        expect(result.applicationInsights).toEqual({ name: 'world-resolve-api', resourceGroup: 'rg-rpg-engine' });
    });

    it('resolves via the hidden-link tag even when the component lives in a different resource group than the Function App', async () => {
        const getComponent = jest.fn(async (rg, name) => ({ id: `/subscriptions/x/resourceGroups/${rg}/providers/microsoft.insights/components/${name}`, name, instrumentationKey: 'ikey' }));
        setupClients({
            webSiteClient: mockWebSiteClient({
                appSettings: {},
                siteTags: { 'hidden-link: /app-insights-resource-id': '/subscriptions/x/resourceGroups/rg-shared-monitoring/providers/microsoft.insights/components/ai-shared' },
            }),
            appInsightsClient: mockAppInsightsClient({ getComponentImpl: getComponent }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: jest.fn(async () => SUCCESSFUL_RESULT) }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const result = await execute(BASE_ARGS);

        expect(result.applicationInsights).toEqual({ name: 'ai-shared', resourceGroup: 'rg-shared-monitoring' });
    });

    it('falls through to instrumentation-key matching when the hidden-link tag points at a deleted component', async () => {
        const component = { id: '/id/fallback', name: 'ai-fallback', instrumentationKey: 'ikey-fallback' };
        const getComponent = jest.fn(async (rg, name) => {
            if (name === 'ai-fallback') return component;
            const err = new Error('not found');
            err.statusCode = 404;
            throw err;
        });
        setupClients({
            webSiteClient: mockWebSiteClient({
                appSettings: { APPINSIGHTS_INSTRUMENTATIONKEY: 'ikey-fallback' },
                siteTags: { 'hidden-link: /app-insights-resource-id': '/subscriptions/x/resourceGroups/rg-rpg-engine/providers/microsoft.insights/components/deleted-ai' },
            }),
            appInsightsClient: mockAppInsightsClient({ components: [component], getComponentImpl: getComponent }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: jest.fn(async () => SUCCESSFUL_RESULT) }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const result = await execute(BASE_ARGS);

        expect(result.applicationInsights.name).toBe('ai-fallback');
    });

    it('throws DEPENDENCY_MISSING when the Function App has no Application Insights linkage at all', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: {} }),
            appInsightsClient: mockAppInsightsClient({ components: [] }),
            logsQueryClient: mockLogsQueryClient(),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute(BASE_ARGS)).rejects.toMatchObject({ code: ERROR_CODES.DEPENDENCY_MISSING, details: { missingDependency: 'appInsightsLinkage' } });
    });

    it('throws DEPENDENCY_MISSING when the instrumentation key has no matching component in the resource group', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: { APPINSIGHTS_INSTRUMENTATIONKEY: 'orphan-ikey' } }),
            appInsightsClient: mockAppInsightsClient({ components: [{ name: 'unrelated', instrumentationKey: 'different-ikey' }] }),
            logsQueryClient: mockLogsQueryClient(),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute(BASE_ARGS)).rejects.toMatchObject({ code: ERROR_CODES.DEPENDENCY_MISSING, details: { missingDependency: 'appInsightsComponent' } });
    });

    it('skips auto-resolution entirely when appInsightsName is supplied explicitly', async () => {
        const listSettings = jest.fn(async () => ({ properties: {} }));
        const getComponent = jest.fn(async () => ({ id: '/id/explicit', name: 'ai-explicit', instrumentationKey: 'x' }));
        setupClients({
            webSiteClient: { webApps: { listApplicationSettings: listSettings } },
            appInsightsClient: mockAppInsightsClient({ getComponentImpl: getComponent }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: jest.fn(async () => SUCCESSFUL_RESULT) }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const result = await execute({ ...BASE_ARGS, appInsightsName: 'ai-explicit' });

        expect(listSettings).not.toHaveBeenCalled();
        expect(getComponent).toHaveBeenCalledWith('rg-rpg-engine', 'ai-explicit', { abortSignal: expect.anything() });
        expect(result.applicationInsights.name).toBe('ai-explicit');
    });

    it('throws DEPENDENCY_MISSING when an explicit appInsightsName does not exist', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient(),
            appInsightsClient: mockAppInsightsClient({ components: [] }),
            logsQueryClient: mockLogsQueryClient(),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ ...BASE_ARGS, appInsightsName: 'does-not-exist' }))
            .rejects.toMatchObject({ code: ERROR_CODES.DEPENDENCY_MISSING, details: { missingDependency: 'appInsights' } });
    });

    it('matches instrumentation keys case-insensitively and tolerates surrounding whitespace', async () => {
        const component = { id: '/id/mixed-case', name: 'ai-mixed-case', instrumentationKey: 'ABCD1234-EF56-7890-ABCD-1234567890AB' };
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: { APPINSIGHTS_INSTRUMENTATIONKEY: ' abcd1234-ef56-7890-abcd-1234567890ab ' } }),
            appInsightsClient: mockAppInsightsClient({ components: [component] }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: jest.fn(async () => SUCCESSFUL_RESULT) }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const result = await execute(BASE_ARGS);

        expect(result.applicationInsights.name).toBe('ai-mixed-case');
    });
});

describe('azure_function_app_logs_query', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    const component = { id: '/id', name: 'ai-world-resolve', instrumentationKey: 'ikey' };

    it('runs the supplied KQL query with a bounded timespan and maps rows to objects', async () => {
        const queryResource = jest.fn(async (resourceId, query, timespan) => {
            expect(resourceId).toBe('/id');
            expect(query).toBe('exceptions | take 10');
            expect(timespan).toEqual({ duration: 'PT30M' });
            return SUCCESSFUL_RESULT;
        });
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: { APPINSIGHTS_INSTRUMENTATIONKEY: 'ikey' } }),
            appInsightsClient: mockAppInsightsClient({ components: [component] }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: queryResource }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-query');
        const result = await execute({ ...BASE_ARGS, query: 'exceptions | take 10', timespanMinutes: 30 });

        expect(result.tables[0].rows).toEqual([
            { timestamp: '2026-01-01T00:00:00Z', message: 'first' },
            { timestamp: '2026-01-01T00:01:00Z', message: 'second' },
        ]);
        expect(result.tables[0].truncated).toBe(false);
    });

    it('truncates rows to maxRows and reports truncation', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: { APPINSIGHTS_INSTRUMENTATIONKEY: 'ikey' } }),
            appInsightsClient: mockAppInsightsClient({ components: [component] }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: jest.fn(async () => SUCCESSFUL_RESULT) }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-query');
        const result = await execute({ ...BASE_ARGS, query: 'traces', timespanMinutes: 30, maxRows: 1 });

        expect(result.tables[0].rows).toHaveLength(1);
        expect(result.tables[0].totalRows).toBe(2);
        expect(result.tables[0].truncated).toBe(true);
    });

    it('rejects a missing or non-positive timespanMinutes', async () => {
        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-query');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ ...BASE_ARGS, query: 'traces', timespanMinutes: 0 })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
        await expect(execute({ ...BASE_ARGS, query: 'traces' })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
    });

    it('rejects a timespanMinutes beyond the 7-day cap', async () => {
        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-query');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ ...BASE_ARGS, query: 'traces', timespanMinutes: 20000 })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
    });

    it('rejects a negative, zero, or non-integer maxRows instead of silently defaulting or under-truncating', async () => {
        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-query');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        // Without validation, maxRows: -1 would make Array.prototype.slice(0, -1)
        // return nearly the whole result instead of enforcing a maximum.
        await expect(execute({ ...BASE_ARGS, query: 'traces', timespanMinutes: 10, maxRows: -1 })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
        await expect(execute({ ...BASE_ARGS, query: 'traces', timespanMinutes: 10, maxRows: 0 })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
        await expect(execute({ ...BASE_ARGS, query: 'traces', timespanMinutes: 10, maxRows: 1.5 })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
    });

    it('wraps a query failure as an AzureEstateError rather than letting the raw SDK error escape', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: { APPINSIGHTS_INSTRUMENTATIONKEY: 'ikey' } }),
            appInsightsClient: mockAppInsightsClient({ components: [component] }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: jest.fn(async () => { throw new Error('bad KQL syntax'); }) }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-query');
        const { AzureEstateError } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ ...BASE_ARGS, query: 'not valid kql {{{', timespanMinutes: 10 })).rejects.toBeInstanceOf(AzureEstateError);
    });

    it('passes an abortSignal to queryResource and reports a clear, actionable error on timeout — never a silent hang', async () => {
        const queryResource = jest.fn(async (resourceId, query, timespan, options) => {
            expect(options.abortSignal).toBeDefined();
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
        });
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: { APPINSIGHTS_INSTRUMENTATIONKEY: 'ikey' } }),
            appInsightsClient: mockAppInsightsClient({ components: [component] }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: queryResource }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-query');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ ...BASE_ARGS, query: 'traces', timespanMinutes: 10 }))
            .rejects.toMatchObject({ code: ERROR_CODES.INTERNAL_ERROR, message: expect.stringContaining('Monitoring Reader') });
    });
});

describe('azure_function_app_logs_recent_errors', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    const component = { id: '/id', name: 'ai-world-resolve', instrumentationKey: 'ikey' };

    it('builds a canned exceptions+traces union query scoped to cloud_RoleName and returns entries', async () => {
        const queryResource = jest.fn(async (resourceId, query, timespan) => {
            expect(query).toMatch(/union isfuzzy=true exceptions, traces/);
            // Scoping by cloud_RoleName matters: without it, a component shared by
            // multiple Function Apps would return every app's errors, all
            // mislabeled as belonging to the one requested.
            expect(query).toMatch(/where cloud_RoleName =~ "world-resolve-api"/);
            expect(query).toMatch(/take 50/);
            expect(timespan).toEqual({ duration: 'PT60M' });
            return SUCCESSFUL_RESULT;
        });
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: { APPINSIGHTS_INSTRUMENTATIONKEY: 'ikey' } }),
            appInsightsClient: mockAppInsightsClient({ components: [component] }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: queryResource }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const result = await execute(BASE_ARGS);

        expect(result.totalEntries).toBe(2);
        expect(result.entries[0]).toEqual({ timestamp: '2026-01-01T00:00:00Z', message: 'first' });
    });

    it('escapes double quotes in the Function App name before embedding it in KQL', async () => {
        const queryResource = jest.fn(async (resourceId, query) => {
            expect(query).toMatch(/cloud_RoleName =~ "weird\\"name"/);
            return SUCCESSFUL_RESULT;
        });
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: { APPINSIGHTS_INSTRUMENTATIONKEY: 'ikey' } }),
            appInsightsClient: mockAppInsightsClient({ components: [component] }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: queryResource }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        await execute({ ...BASE_ARGS, name: 'weird"name' });

        expect(queryResource).toHaveBeenCalledTimes(1);
    });

    it('rejects a negative, zero, or non-integer maxRows', async () => {
        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ ...BASE_ARGS, maxRows: -1 })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
        await expect(execute({ ...BASE_ARGS, maxRows: 0 })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
        await expect(execute({ ...BASE_ARGS, maxRows: 2.5 })).rejects.toMatchObject({ code: ERROR_CODES.BAD_REQUEST });
    });

    it('respects a custom timespanMinutes and maxRows', async () => {
        const queryResource = jest.fn(async (resourceId, query, timespan) => {
            expect(query).toMatch(/take 5/);
            expect(timespan).toEqual({ duration: 'PT120M' });
            return SUCCESSFUL_RESULT;
        });
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: { APPINSIGHTS_INSTRUMENTATIONKEY: 'ikey' } }),
            appInsightsClient: mockAppInsightsClient({ components: [component] }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: queryResource }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        await execute({ ...BASE_ARGS, timespanMinutes: 120, maxRows: 5 });

        expect(queryResource).toHaveBeenCalledTimes(1);
    });

    it('passes an abortSignal to queryResource and reports a clear, actionable error on timeout — never a silent hang', async () => {
        const queryResource = jest.fn(async (resourceId, query, timespan, options) => {
            expect(options.abortSignal).toBeDefined();
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
        });
        setupClients({
            webSiteClient: mockWebSiteClient({ appSettings: { APPINSIGHTS_INSTRUMENTATIONKEY: 'ikey' } }),
            appInsightsClient: mockAppInsightsClient({ components: [component] }),
            logsQueryClient: mockLogsQueryClient({ queryResourceImpl: queryResource }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/logs-recent-errors');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute(BASE_ARGS))
            .rejects.toMatchObject({ code: ERROR_CODES.INTERNAL_ERROR, message: expect.stringContaining('Monitoring Reader') });
    });
});
