const { app } = require('@azure/functions');
const { handleMcpRequest } = require('../../lib/mcp-handler');

app.http('mcp', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp',
    handler: async (request, context) => {
        const requestStart = Date.now();
        context.log('MCP request received');

        let requestId = null;

        try {
            const requestBody = await request.json();
            requestId = requestBody?.id ?? null;
            context.log('MCP method:', requestBody.method);

            const response = await handleMcpRequest(requestBody, context);

            // For notifications, return 204 No Content
            if (response === null) {
                context.log(`MCP request completed with 204 in ${Date.now() - requestStart}ms`);
                return {
                    status: 204
                };
            }

            context.log(`MCP request completed with 200 in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(response)
            };
        } catch (error) {
            context.log.error('MCP error:', error);
            if (error && error.stack) {
                context.log.error('MCP error stack:', error.stack);
            }

            // JSON parse errors: the request body was malformed
            if (error instanceof SyntaxError) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        error: {
                            code: -32700,
                            message: 'Parse error: request body must be valid JSON'
                        },
                        id: null
                    })
                };
            }

            // All other unexpected errors: return 200 with a structured MCP result so
            // the AI client receives our message rather than an infrastructure-level
            // generic error wrapper (which gives no actionable context).
            context.log(`MCP request completed with structured 200 error in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error: 'MCP request processing failed',
                                    hint: 'Use list_available_councils to verify council names, then retry with correct parameters.',
                                    suggestion: 'Check that all required parameters are provided and correctly formatted.'
                                }, null, 2)
                            }
                        ],
                        isError: true
                    },
                    id: requestId
                })
            };
        }
    }
});
