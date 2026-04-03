'use strict';

describe('mcpRawHtml', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        delete global.fetch;
    });

    function loadWithMocks(fetchMock) {
        const httpMock = jest.fn();
        jest.doMock('@azure/functions', () => ({ app: { http: httpMock } }));
        global.fetch = fetchMock;

        require('../src/functions/mcpRawHtml');
        const [, registration] = httpMock.mock.calls[0];
        return registration.handler;
    }

    it('blocks redirect targets that resolve to private/internal hosts', async () => {
        const fetchMock = jest.fn()
            .mockResolvedValueOnce({ ok: false })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                url: 'http://127.0.0.1/private',
                headers: {
                    get: (key) => (key === 'content-type' ? 'text/html' : null),
                    forEach: jest.fn(),
                },
                text: jest.fn().mockResolvedValue('<html>secret</html>'),
            });

        const handler = loadWithMocks(fetchMock);
        const response = await handler(
            {
                method: 'POST',
                json: jest.fn().mockResolvedValue({
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: { name: 'fetch_raw_html', arguments: { url: 'https://example.com/start' } },
                    id: 1,
                }),
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        const payload = JSON.parse(body.result.content[0].text);

        expect(payload.blocked).toBe(true);
        expect(payload.blockedBy).toBe('redirect_target_validation');
        expect(payload.reason).toMatch(/Redirect target blocked/);
        expect(payload.rateLimit).toBeDefined();
    });

    it('accepts stringified tool arguments', async () => {
        const fetchMock = jest.fn()
            .mockResolvedValueOnce({ ok: false })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                url: 'https://example.com/',
                headers: {
                    get: (key) => (key === 'content-type' ? 'text/html; charset=utf-8' : null),
                    forEach: jest.fn(),
                },
                text: jest.fn().mockResolvedValue('<html>ok</html>'),
            });

        const handler = loadWithMocks(fetchMock);
        const response = await handler(
            {
                method: 'POST',
                json: jest.fn().mockResolvedValue({
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: { name: 'fetch_raw_html', arguments: JSON.stringify({ url: 'https://example.com/' }) },
                    id: 2,
                }),
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        const payload = JSON.parse(body.result.content[0].text);
        expect(payload.statusCode).toBe(200);
        expect(payload.body).toContain('ok');
        expect(payload.robots.checked).toBe(true);
        expect(payload.rateLimit.minDelayMs).toBeGreaterThanOrEqual(2000);
    });

    it('returns explicit robots.txt block details', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce({
            ok: true,
            text: jest.fn().mockResolvedValue('User-agent: *\nDisallow: /private'),
        });

        const handler = loadWithMocks(fetchMock);
        const response = await handler(
            {
                method: 'POST',
                json: jest.fn().mockResolvedValue({
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: { name: 'fetch_raw_html', arguments: { url: 'https://example.com/private/page' } },
                    id: 3,
                }),
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        const payload = JSON.parse(body.result.content[0].text);
        expect(payload.blocked).toBe(true);
        expect(payload.blockedBy).toBe('robots_txt');
        expect(payload.robots.origin).toBe('https://example.com');
    });

    it('serves the manifest on GET requests', async () => {
        const handler = loadWithMocks(jest.fn());
        const response = await handler(
            {
                method: 'GET',
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );

        const body = JSON.parse(response.body);
        expect(response.status).toBe(200);
        expect(body.serverInfo.name).toBe('gcc-raw-html-mcp');
    });
});
