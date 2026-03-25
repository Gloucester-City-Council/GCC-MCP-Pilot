/**
 * Azure Functions v4 Entry Point
 * Loads all function definitions for registration with the runtime
 */

// Load all function definitions
require('./functions/mcp');
require('./functions/test-soap');
require('./functions/mcpSchema');
require('./functions/healthzSchema');
require('./functions/mcpProcurement');
require('./functions/mcpPlanning');

console.log('Azure Functions loaded: mcp, test-soap, mcpSchema, healthzSchema, mcpProcurement, mcpPlanning');
