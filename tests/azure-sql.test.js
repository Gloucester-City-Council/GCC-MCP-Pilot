'use strict';

const nf = () => Object.assign(new Error('nf'), { statusCode: 404 });
const GUID = '11111111-2222-3333-4444-555555555555';

describe('Azure SQL create tools', () => {
    afterEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    function load(client, perms = { sql: ['create', 'network'] }) {
        jest.doMock('../src/gcc-azure-estate/lib/instances', () => {
            const inst = { name: 'azure-prod', subscriptionId: 's', permissions: perms };
            return { getInstance: () => inst, listInstances: () => [inst] };
        });
        jest.doMock('../src/gcc-azure-estate/lib/clients', () => ({ getSqlClient: () => client }));
    }

    it('creates an Entra-only server with a group admin', async () => {
        const createOrUpdate = jest.fn(async (rg, n, b) => ({ name: n, ...b }));
        load({ servers: { get: async () => { throw nf(); }, createOrUpdate } });
        const r = await require('../src/gcc-azure-estate/tools/sql/server-create')
            .execute({ instance: 'i', resourceGroup: 'rg', name: 'sql1', location: 'uksouth', adminGroupName: 'g', adminGroupObjectId: GUID });
        expect(r).toMatchObject({ created: true, authentication: 'Microsoft Entra only' });
        const body = createOrUpdate.mock.calls[0][2];
        expect(body.administrators).toMatchObject({ principalType: 'Group', azureADOnlyAuthentication: true, sid: GUID });
        expect(body.administratorLogin).toBeUndefined();
        expect(body.minimalTlsVersion).toBe('1.2');
    });

    it('rejects a bad admin object ID and an existing server', async () => {
        load({ servers: { get: async () => ({}) } });
        const { execute } = require('../src/gcc-azure-estate/tools/sql/server-create');
        const base = { instance: 'i', resourceGroup: 'rg', name: 's', location: 'l', adminGroupName: 'g' };
        await expect(execute({ ...base, adminGroupObjectId: 'nope' })).rejects.toThrow(/GUID/);
        await expect(execute({ ...base, adminGroupObjectId: GUID })).rejects.toThrow(/already exists/);
    });

    it('allows the Azure-services rule but refuses the whole internet', async () => {
        const createOrUpdate = jest.fn(async (rg, s, n, b) => ({ name: n, ...b }));
        load({ firewallRules: { get: async () => { throw nf(); }, createOrUpdate } });
        const { execute } = require('../src/gcc-azure-estate/tools/sql/firewall-rule-create');
        const base = { instance: 'i', resourceGroup: 'rg', serverName: 's', name: 'r' };
        const ok = await execute({ ...base, startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' });
        expect(ok.allowsAzureServices).toBe(true);
        await expect(execute({ ...base, startIpAddress: '0.0.0.0', endIpAddress: '255.255.255.255' })).rejects.toThrow(/whole internet/);
        await expect(execute({ ...base, startIpAddress: 'x', endIpAddress: 'y' })).rejects.toThrow(/IPv4/);
    });

    it('firewall rules need the network class', async () => {
        load({ firewallRules: {} }, { sql: ['create'] });
        await expect(require('../src/gcc-azure-estate/tools/sql/firewall-rule-create')
            .execute({ instance: 'i', resourceGroup: 'rg', serverName: 's', name: 'r', startIpAddress: '1.2.3.4', endIpAddress: '1.2.3.4' }))
            .rejects.toThrow(/not permitted/);
    });

    it('creates a free-offer serverless database and checks the server first', async () => {
        const createOrUpdate = jest.fn(async (rg, s, n, b) => ({ name: n, ...b }));
        load({
            servers: { get: async () => ({}) },
            databases: { get: async () => { throw nf(); }, createOrUpdate },
        });
        const { execute } = require('../src/gcc-azure-estate/tools/sql/database-create');
        const r = await execute({ instance: 'i', resourceGroup: 'rg', serverName: 's', name: 'db', location: 'uksouth' });
        expect(r).toMatchObject({ created: true, sku: 'GP_S_Gen5_1', freeOffer: true, freeLimitExhaustionBehavior: 'BillOverUsage' });
        expect(createOrUpdate.mock.calls[0][3]).toMatchObject({ useFreeLimit: true, requestedBackupStorageRedundancy: 'Local' });
        await expect(execute({ instance: 'i', resourceGroup: 'rg', serverName: 's', name: 'db', location: 'l', maxVcores: 0 })).rejects.toThrow(/maxVcores/);
    });

    it('database create reports a missing server', async () => {
        load({ servers: { get: async () => { throw nf(); } } });
        await expect(require('../src/gcc-azure-estate/tools/sql/database-create')
            .execute({ instance: 'i', resourceGroup: 'rg', serverName: 'gone', name: 'db', location: 'l' }))
            .rejects.toThrow(/azure_sql_server_create/);
    });

    it('registers the SQL tools', () => {
        jest.dontMock('../src/gcc-azure-estate/lib/instances');
        jest.dontMock('../src/gcc-azure-estate/lib/clients');
        const { TOOLS, TOOL_HANDLERS } = require('../src/gcc-azure-estate');
        for (const n of ['azure_sql_server_create', 'azure_sql_firewall_rule_create', 'azure_sql_database_create']) {
            expect(TOOLS.some((t) => t.name === n)).toBe(true);
            expect(typeof TOOL_HANDLERS[n]).toBe('function');
        }
    });
});
