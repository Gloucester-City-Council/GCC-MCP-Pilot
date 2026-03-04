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
