'use strict';

describe('mcpDocExtract bug fixes and optimizations', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        delete global.fetch;
    });

    function loadWithMocks(fetchMock) {
        const httpMock = jest.fn();
        jest.doMock('@azure/functions', () => ({ app: { http: httpMock } }));
        jest.doMock('pdf-parse', () => jest.fn().mockResolvedValue({ text: 'pdf text', numpages: 1, info: {} }));
        jest.doMock('mammoth', () => ({ extractRawText: jest.fn().mockResolvedValue({ value: 'docx text', messages: [] }) }));
        global.fetch = fetchMock;

        require('../src/functions/mcpDocExtract');
        const [, registration] = httpMock.mock.calls[0];
        return registration.handler;
    }

    async function callTool(handler, url) {
        const response = await handler(
            {
                json: jest.fn().mockResolvedValue({
                    jsonrpc: '2.0',
                    method: 'tools/call',
                    params: { name: 'fetch_document_content', arguments: { url } },
                    id: 1
                })
            },
            { log: Object.assign(jest.fn(), { error: jest.fn() }) }
        );
        const body = JSON.parse(response.body);
        return JSON.parse(body.result.content[0].text);
    }

    it('blocks redirect targets that resolve to private/internal hosts', async () => {
        const fetchMock = jest.fn()
            .mockResolvedValueOnce({ ok: false }) // robots.txt lookup
            .mockResolvedValueOnce({
                ok: true,
                url: 'http://127.0.0.1/secret.pdf',
                headers: { get: (key) => (key === 'content-type' ? 'application/pdf' : null) },
                arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(4)),
            });

        const handler = loadWithMocks(fetchMock);
        const payload = await callTool(handler, 'https://example.com/public.pdf');

        expect(payload.blocked).toBe(true);
        expect(payload.reason).toMatch(/Redirect target blocked/);
    });

    it('rejects legacy .doc responses instead of misclassifying as docx', async () => {
        const arrayBufferMock = jest.fn().mockResolvedValue(new ArrayBuffer(8));
        const fetchMock = jest.fn()
            .mockResolvedValueOnce({ ok: false }) // robots.txt lookup
            .mockResolvedValueOnce({
                ok: true,
                url: 'https://example.com/file.doc',
                headers: {
                    get: (key) => {
                        if (key === 'content-type') return 'application/msword';
                        if (key === 'content-length') return '8';
                        return null;
                    }
                },
                arrayBuffer: arrayBufferMock,
            });

        const handler = loadWithMocks(fetchMock);
        const payload = await callTool(handler, 'https://example.com/file.doc');

        expect(payload.error).toBe(true);
        expect(payload.reason).toMatch(/Unsupported content type/);
        expect(arrayBufferMock).not.toHaveBeenCalled();
    });

    it('short-circuits oversized files using Content-Length without downloading body', async () => {
        const arrayBufferMock = jest.fn().mockResolvedValue(new ArrayBuffer(8));
        const fetchMock = jest.fn()
            .mockResolvedValueOnce({ ok: false }) // robots.txt lookup
            .mockResolvedValueOnce({
                ok: true,
                url: 'https://example.com/huge.pdf',
                headers: {
                    get: (key) => {
                        if (key === 'content-type') return 'application/pdf';
                        if (key === 'content-length') return String(21 * 1024 * 1024);
                        return null;
                    }
                },
                arrayBuffer: arrayBufferMock,
            });

        const handler = loadWithMocks(fetchMock);
        const payload = await callTool(handler, 'https://example.com/huge.pdf');

        expect(payload.error).toBe(true);
        expect(payload.reason).toMatch(/declared size/i);
        expect(arrayBufferMock).not.toHaveBeenCalled();
    });
});
