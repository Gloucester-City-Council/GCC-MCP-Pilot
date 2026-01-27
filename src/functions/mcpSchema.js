/**
 * MCP Schema HTTP Function - POST /mcp-schema
 * Exposes schema-driven MCP tools for council tax schema
 */

const { app } = require('@azure/functions');
const { ERROR_CODES, createError } = require('../util/errors');
const schemaGet = require('../tools/schemaGet');
const schemaSearch = require('../tools/schemaSearch');
const schemaTodos = require('../tools/schemaTodos');
const schemaEvaluate = require('../tools/schemaEvaluate');

/**
 * Available tools and their handlers
 */
const TOOLS = {
    'schema.get': schemaGet.execute,
    'schema.search': schemaSearch.execute,
    'schema.todos': schemaTodos.execute,
    'schema.evaluate': schemaEvaluate.execute
};

/**
 * Handle POST /mcp-schema requests
 */
app.http('mcpSchema', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp-schema',
    handler: async (request, context) => {
        context.log('MCP Schema request received');

        try {
            // Parse request body
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.error('Failed to parse request body:', parseError);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(createError(
                        ERROR_CODES.BAD_REQUEST,
                        'Invalid JSON in request body'
                    ))
                };
            }

            const { tool, input = {} } = body;

            // Validate tool parameter
            if (!tool || typeof tool !== 'string') {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(createError(
                        ERROR_CODES.BAD_REQUEST,
                        'Missing or invalid "tool" parameter',
                        { availableTools: Object.keys(TOOLS) }
                    ))
                };
            }

            // Check if tool exists
            const toolHandler = TOOLS[tool];
            if (!toolHandler) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(createError(
                        ERROR_CODES.UNKNOWN_TOOL,
                        `Unknown tool "${tool}"`,
                        { availableTools: Object.keys(TOOLS) }
                    ))
                };
            }

            context.log(`Executing tool: ${tool}`);

            // Execute the tool
            const result = toolHandler(input);

            context.log(`Tool ${tool} completed, ok=${result.ok}`);

            // Return result
            return {
                status: result.ok ? 200 : 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result)
            };
        } catch (error) {
            context.log.error('MCP Schema error:', error);

            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(createError(
                    ERROR_CODES.INTERNAL_ERROR,
                    error.message
                ))
            };
        }
    }
});
