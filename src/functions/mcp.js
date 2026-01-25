const { app } = require('@azure/functions');
const { handleMcpRequest } = require('../../lib/mcp-handler');

app.http('mcp', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp',
    handler: async (request, context) => {
        context.log('MCP request received');

        try {
            const requestBody = await request.json();
            context.log('MCP method:', requestBody.method);

            const response = await handleMcpRequest(requestBody, context);

            return {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(response)
            };
        } catch (error) {
            context.log.error('MCP error:', error);

            return {
                status: 500,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: error.message
                    },
                    id: null
                })
            };
        }
    }
});
