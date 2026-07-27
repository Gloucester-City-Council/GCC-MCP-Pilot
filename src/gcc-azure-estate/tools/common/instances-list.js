/**
 * Tool: azure_instances_list
 *
 * Lists the registered Azure instances (subscription/environment) from
 * config/azure-instances.yaml, including their granted permissions.
 * Pure config read — no Azure API call, no permission gate needed.
 */

'use strict';

const { listInstances } = require('../../lib/instances');

function execute() {
    const instances = listInstances();
    return {
        instances,
        totalCount: instances.length,
        note: 'Use the exact instance name in the `instance` parameter of other tools.',
    };
}

module.exports = { execute };
