'use strict';

describe('Azure Functions entrypoint registration', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('registers the web compiler MCP function at startup', () => {
        const httpMock = jest.fn();
        jest.doMock('@azure/functions', () => ({ app: { http: httpMock } }));

        require('../src/index');

        const registeredNames = httpMock.mock.calls.map(call => call[0]);
        expect(registeredNames).toContain('mcpWebCompiler');
    });
});
