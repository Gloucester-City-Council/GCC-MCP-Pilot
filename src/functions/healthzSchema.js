/**
 * Health check endpoint for MCP Schema - GET /healthz-schema
 * Returns schema loading status, version, and hash
 */

const { app } = require('@azure/functions');
const { isSchemaLoaded, getSchemaVersion, getSchemaHash, getLoadError } = require('../schema/loader');
const heritageLoader = require('../heritage/loader');

/**
 * Handle GET /healthz-schema requests
 */
app.http('healthzSchema', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'healthz-schema',
    handler: async (request, context) => {
        context.log('Health check request received');

        try {
            const ctLoaded = isSchemaLoaded();
            const ctVersion = getSchemaVersion();
            const ctHash = getSchemaHash();
            const ctLoadError = getLoadError();

            const heritageLoaded = heritageLoader.isSchemaLoaded();
            const heritageVersion = heritageLoader.getSchemaVersion();
            const heritageHash = heritageLoader.getSchemaHash();
            const heritageLoadError = heritageLoader.getLoadError();

            const allLoaded = ctLoaded && heritageLoaded;

            if (allLoaded) {
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ok: true,
                        schemas: {
                            councilTax: {
                                loaded: true,
                                schemaVersion: ctVersion,
                                hash: ctHash
                            },
                            heritage: {
                                loaded: true,
                                schemaVersion: heritageVersion,
                                hash: heritageHash
                            }
                        }
                    })
                };
            } else {
                // One or more schemas failed to load
                return {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ok: false,
                        schemas: {
                            councilTax: {
                                loaded: ctLoaded,
                                schemaVersion: ctLoaded ? ctVersion : null,
                                hash: ctLoaded ? ctHash : null,
                                error: !ctLoaded ? (ctLoadError ? ctLoadError.message : 'Schema not loaded') : undefined
                            },
                            heritage: {
                                loaded: heritageLoaded,
                                schemaVersion: heritageLoaded ? heritageVersion : null,
                                hash: heritageLoaded ? heritageHash : null,
                                error: !heritageLoaded ? (heritageLoadError ? heritageLoadError.message : 'Schema not loaded') : undefined
                            }
                        }
                    })
                };
            }
        } catch (error) {
            context.log.error('Health check error:', error);

            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ok: false,
                    schemaLoaded: false,
                    schemaVersion: null,
                    hash: null,
                    error: error.message
                })
            };
        }
    }
});
