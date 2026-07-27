/**
 * Tool: azure_ping
 *
 * Trivial health check — confirms the Estate MCP is reachable and the
 * instance registry loaded successfully. Makes no Azure API call.
 */

'use strict';

const { listInstances } = require('../../lib/instances');

function execute() {
    const instances = listInstances();
    return {
        status: 'ok',
        registeredInstances: instances.map((i) => i.name),
    };
}

module.exports = { execute };
