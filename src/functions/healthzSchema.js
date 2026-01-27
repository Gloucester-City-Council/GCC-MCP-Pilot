/**
 * Health check endpoint for MCP Schema - GET /healthz-schema
 * Returns schema loading status, version, and hash
 */

const { app } = require('@azure/functions');
const { isSchemaLoaded, getSchemaVersion, getSchemaHash, getLoadError } = require('../schema/loader');

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
            const loaded = isSchemaLoaded();
            const version = getSchemaVersion();
            const hash = getSchemaHash();
            const loadError = getLoadError();

            if (loaded) {
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ok: true,
                        schemaLoaded: true,
                        schemaVersion: version,
                        hash: hash
                    })
                };
            } else {
                // Schema failed to load
                return {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ok: false,
                        schemaLoaded: false,
                        schemaVersion: null,
                        hash: null,
                        error: loadError ? loadError.message : 'Schema not loaded'
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
