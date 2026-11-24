'use strict';

const instance = (perms) => ({ name: 'azure-prod', subscriptionId: 'sub', permissions: perms });
const notFound = () => Object.assign(new Error('nf'), { statusCode: 404 });

describe('hosting plan and monitoring create tools', () => {
    afterEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    function load(clients, perms) {
        jest.doMock('../src/gcc-azure-estate/lib/instances', () => ({
            getInstance: () => instance(perms),
            listInstances: () => [instance(perms)],
        }));
        jest.doMock('../src/gcc-azure-estate/lib/clients', () => clients);
    }

    it('creates a Y1 Linux hosting plan', async () => {
        const createOrUpdate = jest.fn(async (rg, name, body) => ({ pollUntilDone: async () => ({ name, ...body }) }));
        load({ getWebSiteClient: () => ({ appServicePlans: { get: async () => { throw notFound(); }, createOrUpdate } }) },
            { 'function-apps': ['create'] });
        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/hosting-plan-create');
        const r = await execute({ instance: 'azure-prod', resourceGroup: 'rg', name: 'plan', location: 'uksouth', sku: 'Y1' });
        expect(r).toMatchObject({ created: true, sku: 'Y1', tier: 'Dynamic', osType: 'Linux' });
        expect(createOrUpdate.mock.calls[0][2].reserved).toBe(true);
    });

    it('rejects an unknown plan sku and an existing plan', async () => {
        load({ getWebSiteClient: () => ({ appServicePlans: { get: async () => ({ sku: { name: 'Y1' } }) } }) },
            { 'function-apps': ['create'] });
        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/hosting-plan-create');
        await expect(execute({ instance: 'i', resourceGroup: 'rg', name: 'p', location: 'l', sku: 'P1v3' })).rejects.toThrow(/sku must be/);
        await expect(execute({ instance: 'i', resourceGroup: 'rg', name: 'p', location: 'l', sku: 'Y1' })).rejects.toThrow(/already exists/);
    });

    it('is forbidden without create on function-apps', async () => {
        load({ getWebSiteClient: () => ({}) }, { 'function-apps': ['plan'] });
        const { execute } = require('../src/gcc-azure-estate/tools/function-apps/hosting-plan-create');
        await expect(execute({ instance: 'i', resourceGroup: 'rg', name: 'p', location: 'l', sku: 'Y1' })).rejects.toThrow(/not permitted/);
    });

    it('creates a workspace, then links App Insights to it', async () => {
        const wsCreate = jest.fn(async (rg, name, body) => ({ pollUntilDone: async () => ({ name, id: '/ws/id', ...body }) }));
        const aiCreate = jest.fn(async (rg, name, body) => ({ name, ...body }));
        const clients = {
            getOperationalInsightsClient: () => ({ workspaces: { get: async () => { throw notFound(); }, beginCreateOrUpdate: wsCreate } }),
            getAppInsightsClient: () => ({ components: { get: async () => { throw notFound(); }, createOrUpdate: aiCreate } }),
        };
        load(clients, { monitoring: ['create'] });
        const ws = await require('../src/gcc-azure-estate/tools/monitoring/workspace-create')
            .execute({ instance: 'i', resourceGroup: 'rg', name: 'log', location: 'uksouth' });
        expect(ws).toMatchObject({ created: true, resourceId: '/ws/id', retentionInDays: 30 });

        clients.getOperationalInsightsClient = () => ({ workspaces: { get: async () => ({ id: '/ws/id' }) } });
        const ai = await require('../src/gcc-azure-estate/tools/monitoring/app-insights-create')
            .execute({ instance: 'i', resourceGroup: 'rg', name: 'appi', location: 'uksouth', workspaceName: 'log' });
        expect(ai).toMatchObject({ created: true, workspaceResourceId: '/ws/id' });
        expect(aiCreate.mock.calls[0][2].workspaceResourceId).toBe('/ws/id');
    });

    it('App Insights reports a missing workspace', async () => {
        load({
            getOperationalInsightsClient: () => ({ workspaces: { get: async () => { throw notFound(); } } }),
            getAppInsightsClient: () => ({}),
        }, { monitoring: ['create'] });
        await expect(require('../src/gcc-azure-estate/tools/monitoring/app-insights-create')
            .execute({ instance: 'i', resourceGroup: 'rg', name: 'a', location: 'l', workspaceName: 'missing' }))
            .rejects.toThrow(/azure_log_analytics_workspace_create/);
    });

    it('registers the new tools', () => {
        jest.dontMock('../src/gcc-azure-estate/lib/instances');
        const { TOOLS, TOOL_HANDLERS } = require('../src/gcc-azure-estate');
        for (const n of ['azure_hosting_plan_create', 'azure_log_analytics_workspace_create', 'azure_app_insights_create']) {
            expect(TOOLS.some((t) => t.name === n)).toBe(true);
            expect(typeof TOOL_HANDLERS[n]).toBe('function');
        }
    });
});
