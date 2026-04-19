'use strict';

describe('mcpSchema request handling', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function mockSchemaModules(httpMock, schemaGetExecute) {
        jest.doMock('@azure/functions', () => ({ app: { http: httpMock } }));

        jest.doMock('../src/tools/schemaGet', () => ({ execute: schemaGetExecute || jest.fn().mockReturnValue({ ok: true }) }));
        jest.doMock('../src/tools/schemaSearch', () => ({ execute: jest.fn().mockReturnValue({ results: [] }) }));
        jest.doMock('../src/tools/schemaTodos', () => ({ execute: jest.fn().mockReturnValue({ items: [] }) }));
        jest.doMock('../src/tools/schemaEvaluate', () => ({ execute: jest.fn().mockReturnValue({ outcome: 'likely' }) }));

        jest.doMock('../src/schema/loader', () => ({
            getSchemaVersion: () => '2.5.6',
            getSchemaHash: () => 'abc123',
            isSchemaLoaded: () => true,
            getFinancialYear: () => '2026/27',
            getDocumentPack: () => 'v2.5.6 (facts, rules, taxonomy, results)'
        }));
    }

    it('returns JSON-RPC invalid request for non-object payloads', async () => {
        const httpMock = jest.fn();
        mockSchemaModules(httpMock);

        require('../src/functions/mcpSchema');

        const [, registration] = httpMock.mock.calls[0];
        const response = await registration.handler(
            { json: jest.fn().mockResolvedValue(null) },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        expect(response.status).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.error.code).toBe(-32600);
    });


    it('preserves id=0 for invalid JSON-RPC version', async () => {
        const httpMock = jest.fn();
        mockSchemaModules(httpMock);

        require('../src/functions/mcpSchema');

        const [, registration] = httpMock.mock.calls[0];
        const response = await registration.handler(
            { json: jest.fn().mockResolvedValue({ jsonrpc: '1.0', method: 'initialize', id: 0 }) },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        expect(body.error.code).toBe(-32600);
        expect(body.id).toBe(0);
    });

    it('awaits async schema tool handlers', async () => {
        const httpMock = jest.fn();
        mockSchemaModules(httpMock, jest.fn().mockResolvedValue({ asyncOk: true }));

        require('../src/functions/mcpSchema');

        const [, registration] = httpMock.mock.calls[0];
        const response = await registration.handler(
            {
                json: jest.fn().mockResolvedValue({
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: { name: 'schema_get', arguments: { path: '/discounts' } },
                    id: 2
                })
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        const payload = JSON.parse(body.result.content[0].text);
        expect(payload.data.asyncOk).toBe(true);
    });

    it('includes financialYear in tool call responses', async () => {
        const httpMock = jest.fn();
        mockSchemaModules(httpMock, jest.fn().mockReturnValue({ ok: true }));

        require('../src/functions/mcpSchema');

        const [, registration] = httpMock.mock.calls[0];
        const response = await registration.handler(
            {
                json: jest.fn().mockResolvedValue({
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: { name: 'schema_get', arguments: { path: '/discounts' } },
                    id: 3
                })
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        const payload = JSON.parse(body.result.content[0].text);
        expect(payload.financialYear).toBe('2026/27');
        expect(payload.schemaVersion).toBe('2.5.6');
    });

    it('returns server version 2.1.0 in initialize response', async () => {
        const httpMock = jest.fn();
        mockSchemaModules(httpMock);

        require('../src/functions/mcpSchema');

        const [, registration] = httpMock.mock.calls[0];
        const response = await registration.handler(
            {
                json: jest.fn().mockResolvedValue({
                    jsonrpc: '2.0',
                    method: 'initialize',
                    id: 4
                })
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        expect(body.result.serverInfo.version).toBe('2.1.0');
        expect(body.result.serverInfo.schemas.councilTax.financialYear).toBe('2026/27');
        expect(body.result.serverInfo.schemas.councilTax.documentPack).toContain('v2.5.6');
    });

    it('returns stable logicalId metadata in tools/list', async () => {
        const httpMock = jest.fn();
        mockSchemaModules(httpMock);
        require('../src/functions/mcpSchema');

        const [, registration] = httpMock.mock.calls[0];
        const response = await registration.handler(
            {
                json: jest.fn().mockResolvedValue({
                    jsonrpc: '2.0',
                    method: 'tools/list',
                    id: 5
                })
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        expect(body.result.registry.version).toBe('schema-tools-v1');
        expect(body.result.tools[0].logicalId).toBe(body.result.tools[0].name);
    });

    it('returns rediscover-required error payload for stale tool names', async () => {
        const httpMock = jest.fn();
        mockSchemaModules(httpMock);
        require('../src/functions/mcpSchema');

        const [, registration] = httpMock.mock.calls[0];
        const response = await registration.handler(
            {
                json: jest.fn().mockResolvedValue({
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: { name: '/stale/tool/path', arguments: {} },
                    id: 6
                })
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        expect(body.error.data.code).toBe('TOOL_REDISCOVER_REQUIRED');
        expect(body.error.data.action).toMatch(/tools\/list/i);
    });
});
