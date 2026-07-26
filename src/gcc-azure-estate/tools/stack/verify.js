/**
 * Tool: azure_stack_verify
 *
 * Re-inspects every resource declared in an ApplicationStack contract and
 * confirms it exists (steps 8-9 of the spec's algorithm: per-resource
 * verify, then relationship verify). Read-only — safe to run standalone
 * against an already-created stack to check for drift, independent of
 * azure_stack_create.
 */

'use strict';

const { parseStackContract } = require('../../lib/yaml-contract');
const { runStep } = require('../../lib/stack-helpers');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { assertPermitted } = require('../../lib/permissions');

const rgInspect = require('../resource-groups/inspect');
const storageInspect = require('../storage-accounts/inspect');
const containerInspect = require('../blob-containers/inspect');
const cosmosAccountInspect = require('../cosmos-accounts/inspect');
const cosmosDatabaseInspect = require('../cosmos-databases/inspect');
const cosmosContainerInspect = require('../cosmos-containers/inspect');
const functionAppInspect = require('../function-apps/inspect');
const staticWebAppInspect = require('../static-web-apps/inspect');

async function execute(args = {}) {
    const missing = validateRequired(args, ['contractYaml']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const contract = parseStackContract(args.contractYaml);
    const instanceName = args.instance || contract.target.instance;
    if (!instanceName) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'target.instance is required in the contract (or pass `instance` explicitly)');
    assertPermitted(instanceName, 'stack', 'inspect');

    const { target, resources } = contract;
    const results = [];

    results.push(await runStep('resourceGroup', rgInspect.execute, { instance: instanceName, resourceGroup: target.resourceGroup }));

    if (resources.storage) {
        results.push(await runStep('storage', storageInspect.execute, { instance: instanceName, resourceGroup: target.resourceGroup, name: resources.storage.name }));
        for (const container of resources.storage.containers || []) {
            results.push(await runStep(`storage.containers.${container.name}`, containerInspect.execute, {
                instance: instanceName, resourceGroup: target.resourceGroup, storageAccount: resources.storage.name, name: container.name,
            }));
        }
    }

    if (resources.cosmos) {
        results.push(await runStep('cosmos.account', cosmosAccountInspect.execute, { instance: instanceName, resourceGroup: target.resourceGroup, accountName: resources.cosmos.account }));
        results.push(await runStep('cosmos.database', cosmosDatabaseInspect.execute, {
            instance: instanceName, resourceGroup: target.resourceGroup, accountName: resources.cosmos.account, databaseName: resources.cosmos.database,
        }));
        for (const container of resources.cosmos.containers || []) {
            results.push(await runStep(`cosmos.containers.${container.name}`, cosmosContainerInspect.execute, {
                instance: instanceName, resourceGroup: target.resourceGroup, accountName: resources.cosmos.account, databaseName: resources.cosmos.database, containerName: container.name,
            }));
        }
    }

    if (resources.functionApp) {
        results.push(await runStep('functionApp', functionAppInspect.execute, { instance: instanceName, resourceGroup: target.resourceGroup, name: resources.functionApp.name }));
    }

    if (resources.staticWebApp) {
        results.push(await runStep('staticWebApp', staticWebAppInspect.execute, { instance: instanceName, resourceGroup: target.resourceGroup, name: resources.staticWebApp.name }));
    }

    // Relationship verify: does the Function App's storage/backend linkage
    // actually point at the declared components?
    const relationshipFindings = [];
    const functionAppStep = results.find((r) => r.label === 'functionApp');
    if (functionAppStep && functionAppStep.ok && resources.storage) {
        const linkedAccount = functionAppStep.result.storageDependency && functionAppStep.result.storageDependency.accountName;
        if (linkedAccount && linkedAccount.toLowerCase() !== resources.storage.name.toLowerCase()) {
            relationshipFindings.push(`Function App "${resources.functionApp.name}" storage dependency resolves to "${linkedAccount}", not the contract's declared storage account "${resources.storage.name}".`);
        }
        if (!linkedAccount) {
            relationshipFindings.push(`Function App "${resources.functionApp.name}" has no resolvable storage dependency.`);
        }
    }

    const staticWebAppStep = results.find((r) => r.label === 'staticWebApp');
    if (staticWebAppStep && staticWebAppStep.ok && resources.staticWebApp && resources.staticWebApp.backend) {
        const linkedNames = (staticWebAppStep.result.linkedBackends || []).map((b) => b.name || b.backendResourceId);
        const expected = resources.staticWebApp.backend.functionApp;
        if (!linkedNames.some((n) => (n || '').includes(expected))) {
            relationshipFindings.push(`Static Web App "${resources.staticWebApp.name}" has no linked backend matching declared Function App "${expected}".`);
        }
    }

    const failedResources = results.filter((r) => !r.ok).map((r) => r.label);

    return {
        target,
        results,
        allResourcesPresent: failedResources.length === 0,
        missingOrFailedResources: failedResources,
        relationshipFindings,
        verified: failedResources.length === 0 && relationshipFindings.length === 0,
    };
}

module.exports = { execute };
