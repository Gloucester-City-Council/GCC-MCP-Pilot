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
        expect(registeredNames).toContain('mcpAzureEstate');
    });

    it('never eagerly loads an Azure SDK package that requires a newer Node than this Function App runs', () => {
        // @azure/identity and every @azure/arm-* package the Azure Estate MCP
        // uses require Node >=20 (some >=22); this Function App runs Node 18.
        // Azure Functions indexes every function at cold start by requiring
        // src/index.js, so an eager top-level require of one of these
        // packages anywhere in the tree crashes the WHOLE app's indexing —
        // not just the Azure Estate endpoint — exactly the "no functions
        // showing in the overview" failure this test guards against.
        // Every such package must be required lazily, inside a function.
        const httpMock = jest.fn();
        jest.doMock('@azure/functions', () => ({ app: { http: httpMock } }));

        require('../src/index');

        const loadedNodeVersionSensitivePackages = Object.keys(require.cache).filter(
            (p) => /node_modules\/@azure\/(identity|arm-)/.test(p)
        );
        expect(loadedNodeVersionSensitivePackages).toEqual([]);
    });
});
