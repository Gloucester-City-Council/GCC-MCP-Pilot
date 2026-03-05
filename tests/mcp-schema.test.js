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
            getSchemaVersion: () => '1.0.0',
            getSchemaHash: () => 'abc123',
            isSchemaLoaded: () => true
        }));

        jest.doMock('../src/tools/heritageGet', () => ({ execute: jest.fn().mockReturnValue({ ok: true }) }));
        jest.doMock('../src/tools/heritageSearch', () => ({ execute: jest.fn().mockReturnValue({ results: [] }) }));
        jest.doMock('../src/heritage/loader', () => ({
            getSchemaVersion: () => '1.0.0',
            getSchemaHash: () => 'def456',
            isSchemaLoaded: () => true
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
});
