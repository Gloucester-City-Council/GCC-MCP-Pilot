/**
 * Tool: azure_function_app_create_plan
 *
 * Validates a proposed Function App spec and returns a dependency-explicit
 * plan — what's present, what's missing — without calling any write API.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const {
    getResourceClient, getWebSiteClient, getStorageMgmtClient, getAppInsightsClient,
} = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { assessCreateDependencies } = require('./shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'location']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'plan');

    const clients = {
        resourceClient: getResourceClient(instance),
        webSiteClient: getWebSiteClient(instance),
        storageClient: getStorageMgmtClient(instance),
        appInsightsClient: getAppInsightsClient(instance),
    };

    let nameConflict = false;
    try {
        await clients.webSiteClient.webApps.get(args.resourceGroup, args.name);
        nameConflict = true;
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }

    const { dependencies, missingDependencies, readyToCreate } = await assessCreateDependencies(clients, args);

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        location: args.location,
        nameAlreadyExists: nameConflict,
        dependencies,
        missingDependencies,
        readyToCreate: readyToCreate && !nameConflict,
        willCreate: readyToCreate && !nameConflict
            ? {
                site: `Microsoft.Web/sites/${args.name}`,
                kind: (dependencies.runtimeConfig.osType === 'Linux') ? 'functionapp,linux' : 'functionapp',
                serverFarmId: dependencies.hostingPlan.name,
                identity: dependencies.identity.requested,
                appSettingsToSeed: dependencies.appSettings.names,
            }
            : null,
        requiredPermission: { resourceFamily: 'function-apps', operationClass: 'create' },
    };
}

module.exports = { execute };
