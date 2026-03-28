'use strict';

describe('mcpNotes manifest and input validation', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('publishes get_notes schema with constrained category/date fields', async () => {
        const httpMock = jest.fn();
        jest.doMock('@azure/functions', () => ({ app: { http: httpMock } }));

        require('../src/functions/mcpNotes');

        const [, registration] = httpMock.mock.calls[0];
        const response = await registration.handler(
            {
                json: jest.fn().mockResolvedValue({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        const getNotesTool = body.result.tools.find((tool) => tool.name === 'get_notes');

        expect(getNotesTool.inputSchema.properties.category.enum).toEqual([
            'schema',
            'build',
            'architecture',
            'decision',
            'idea',
            'reference',
        ]);
        expect(getNotesTool.inputSchema.properties.since.format).toBe('date-time');
        expect(getNotesTool.inputSchema.additionalProperties).toBe(false);
    });

    it('returns a tool error when since is not an ISO8601 date-time', async () => {
        const httpMock = jest.fn();
        jest.doMock('@azure/functions', () => ({ app: { http: httpMock } }));

        require('../src/functions/mcpNotes');

        const [, registration] = httpMock.mock.calls[0];
        const response = await registration.handler(
            {
                json: jest.fn().mockResolvedValue({
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: { name: 'get_notes', arguments: { since: 'not-a-date' } },
                    id: 2,
                }),
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        expect(body.result.isError).toBe(true);

        const payload = JSON.parse(body.result.content[0].text);
        expect(payload.error).toContain('since must be a valid ISO8601 date-time string');
    });
});
