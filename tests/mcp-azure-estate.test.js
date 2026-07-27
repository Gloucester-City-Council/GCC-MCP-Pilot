'use strict';

function mockLog() {
    return Object.assign(jest.fn(), { error: jest.fn() });
}

describe('mcpAzureEstate startup resilience', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        // jest.doMock registrations for a given module path outlive
        // resetModules() within the same test file — undo it explicitly so
        // later describe blocks in this file get the real module.
        jest.dontMock('../src/gcc-azure-estate/index');
    });

    it('registers mcpAzureEstate and returns 503 when the estate module fails to load', async () => {
        const httpMock = jest.fn();

        jest.doMock('@azure/functions', () => ({ app: { http: httpMock } }));
        jest.doMock('../src/gcc-azure-estate/index', () => {
            throw new Error('instance registry unreadable');
        });

        require('../src/functions/mcpAzureEstate');

        expect(httpMock).toHaveBeenCalledTimes(1);
        const [name, registration] = httpMock.mock.calls[0];
        expect(name).toBe('mcpAzureEstate');
        expect(registration.route).toBe('mcp-azure-estate');

        const response = await registration.handler({ json: jest.fn() }, { log: mockLog() });

        expect(response.status).toBe(503);
        const body = JSON.parse(response.body);
        expect(body.error.message).toContain('instance registry unreadable');
    });
});

describe('mcpAzureEstate request handling', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    async function loadHandler() {
        const httpMock = jest.fn();
        jest.doMock('@azure/functions', () => ({ app: { http: httpMock } }));
        require('../src/functions/mcpAzureEstate');
        const [, registration] = httpMock.mock.calls[0];
        return registration.handler;
    }

    it('lists azure_ping, azure_instances_list, azure_subscriptions_list in tools/list', async () => {
        const handler = await loadHandler();
        const response = await handler(
            { json: async () => ({ jsonrpc: '2.0', method: 'tools/list', id: 1 }) },
            { log: mockLog() }
        );

        const body = JSON.parse(response.body);
        const names = body.result.tools.map((t) => t.name);
        expect(names).toContain('azure_ping');
        expect(names).toContain('azure_instances_list');
        expect(names).toContain('azure_subscriptions_list');
    });

    it('executes azure_ping and returns a healthy status', async () => {
        const handler = await loadHandler();
        const response = await handler(
            {
                json: async () => ({
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: { name: 'azure_ping', arguments: {} },
                    id: 2,
                }),
            },
            { log: mockLog() }
        );

        const body = JSON.parse(response.body);
        const text = JSON.parse(body.result.content[0].text);
        expect(text.data.status).toBe('ok');
        expect(text.data.registeredInstances).toContain('azure-prod');
    });

    it('returns a JSON-RPC error for an unknown tool', async () => {
        const handler = await loadHandler();
        const response = await handler(
            {
                json: async () => ({
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: { name: 'azure_not_a_real_tool', arguments: {} },
                    id: 3,
                }),
            },
            { log: mockLog() }
        );

        const body = JSON.parse(response.body);
        expect(body.error.message).toContain('Unknown tool');
    });
});
