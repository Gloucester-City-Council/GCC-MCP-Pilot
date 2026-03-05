'use strict';

describe('mcpProcurement startup resilience', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        delete process.env.GCC_PROCUREMENT_SCHEMA_FILE;
    });

    it('registers and returns 503 when procurement module fails to load', async () => {
        const httpMock = jest.fn();

        jest.doMock('@azure/functions', () => ({
            app: { http: httpMock }
        }));

        jest.doMock('../src/gcc-procurement/index', () => {
            throw new Error('schema file unreadable');
        });

        require('../src/functions/mcpProcurement');

        expect(httpMock).toHaveBeenCalledTimes(1);
        const [, registration] = httpMock.mock.calls[0];

        const response = await registration.handler(
            { json: jest.fn() },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        expect(response.status).toBe(503);
        const body = JSON.parse(response.body);
        expect(body.error.message).toContain('schema file unreadable');
    });
});

describe('schema-loader configuration', () => {
    afterEach(() => {
        jest.resetModules();
        delete process.env.GCC_PROCUREMENT_SCHEMA_FILE;
    });

    it('supports overriding schema file via environment variable', () => {
        process.env.GCC_PROCUREMENT_SCHEMA_FILE = 'procurement-contracts-schema-v0.9.3.json';

        const loader = require('../src/gcc-procurement/schema-loader');

        expect(loader.SCHEMA_FILE).toBe('procurement-contracts-schema-v0.9.3.json');
        expect(loader.SCHEMA_VERSION).toBeDefined();
    });
});

describe('mcpProcurement request handling', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('returns JSON-RPC invalid request for non-object payloads', async () => {
        const httpMock = jest.fn();

        jest.doMock('@azure/functions', () => ({
            app: { http: httpMock }
        }));

        jest.doMock('../src/gcc-procurement/index', () => ({
            TOOLS: [],
            TOOL_HANDLERS: {},
            SERVER_INFO: { name: 'gcc-procurement-mcp', version: '1.0.0', schemaVersion: 'test' }
        }));

        require('../src/functions/mcpProcurement');

        const [, registration] = httpMock.mock.calls[0];
        const response = await registration.handler(
            { json: jest.fn().mockResolvedValue(null) },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        expect(response.status).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.error.code).toBe(-32600);
    });


    it('preserves id=0 for invalid JSON-RPC payload', async () => {
        const httpMock = jest.fn();

        jest.doMock('@azure/functions', () => ({
            app: { http: httpMock }
        }));

        jest.doMock('../src/gcc-procurement/index', () => ({
            TOOLS: [],
            TOOL_HANDLERS: {},
            SERVER_INFO: { name: 'gcc-procurement-mcp', version: '1.0.0', schemaVersion: 'test' }
        }));

        require('../src/functions/mcpProcurement');

        const [, registration] = httpMock.mock.calls[0];
        const response = await registration.handler(
            {
                json: jest.fn().mockResolvedValue({ jsonrpc: '1.0', method: 'initialize', id: 0 })
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        expect(body.error.code).toBe(-32600);
        expect(body.id).toBe(0);
    });

    it('awaits async procurement tool handlers', async () => {
        const httpMock = jest.fn();

        jest.doMock('@azure/functions', () => ({
            app: { http: httpMock }
        }));

        jest.doMock('../src/gcc-procurement/index', () => ({
            TOOLS: [{ name: 'async_tool', description: 'test', inputSchema: { type: 'object', properties: {}, required: [] } }],
            TOOL_HANDLERS: {
                async_tool: jest.fn().mockResolvedValue({ ok: true })
            },
            SERVER_INFO: { name: 'gcc-procurement-mcp', version: '1.0.0', schemaVersion: 'test' }
        }));

        require('../src/functions/mcpProcurement');

        const [, registration] = httpMock.mock.calls[0];
        const response = await registration.handler(
            {
                json: jest.fn().mockResolvedValue({
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: { name: 'async_tool', arguments: {} },
                    id: 1
                })
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        const payload = JSON.parse(body.result.content[0].text);
        expect(payload.data.ok).toBe(true);
    });
});
