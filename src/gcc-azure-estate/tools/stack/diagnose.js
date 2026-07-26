/**
 * Tool: azure_stack_diagnose
 *
 * Runs each declared resource's own *_diagnose tool (where one exists)
 * against every component of an ApplicationStack contract, then folds in
 * azure_stack_verify's relationship findings. Cosmos databases have no
 * dedicated diagnose tool in this build (per the family's scoped tool
 * list) — noted rather than silently skipped.
 */

'use strict';

const { parseStackContract } = require('../../lib/yaml-contract');
const { runStep } = require('../../lib/stack-helpers');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { assertPermitted } = require('../../lib/permissions');
const { execute: verify } = require('./verify');

const rgDiagnose = require('../resource-groups/diagnose');
const storageDiagnose = require('../storage-accounts/diagnose');
const containerDiagnose = require('../blob-containers/diagnose');
const cosmosAccountDiagnose = require('../cosmos-accounts/diagnose');
const cosmosContainerDiagnose = require('../cosmos-containers/diagnose');
const functionAppDiagnose = require('../function-apps/diagnose');
const staticWebAppDiagnose = require('../static-web-apps/diagnose');

async function execute(args = {}) {
    const missing = validateRequired(args, ['contractYaml']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const contract = parseStackContract(args.contractYaml);
    const instanceName = args.instance || contract.target.instance;
    if (!instanceName) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'target.instance is required in the contract (or pass `instance` explicitly)');
    assertPermitted(instanceName, 'stack', 'diagnose');

    const { target, resources } = contract;
    const results = [];

    results.push(await runStep('resourceGroup', rgDiagnose.execute, { instance: instanceName, resourceGroup: target.resourceGroup }));

    if (resources.storage) {
        results.push(await runStep('storage', storageDiagnose.execute, { instance: instanceName, resourceGroup: target.resourceGroup, name: resources.storage.name }));
        for (const container of resources.storage.containers || []) {
            results.push(await runStep(`storage.containers.${container.name}`, containerDiagnose.execute, {
                instance: instanceName, resourceGroup: target.resourceGroup, storageAccount: resources.storage.name, name: container.name,
            }));
        }
    }

    if (resources.cosmos) {
        results.push(await runStep('cosmos.account', cosmosAccountDiagnose.execute, { instance: instanceName, resourceGroup: target.resourceGroup, accountName: resources.cosmos.account }));
        results.push({ label: 'cosmos.database', ok: true, result: { note: 'No dedicated diagnose tool exists for Cosmos databases in this build.' } });
        for (const container of resources.cosmos.containers || []) {
            results.push(await runStep(`cosmos.containers.${container.name}`, cosmosContainerDiagnose.execute, {
                instance: instanceName, resourceGroup: target.resourceGroup, accountName: resources.cosmos.account, databaseName: resources.cosmos.database, containerName: container.name,
            }));
        }
    }

    if (resources.functionApp) {
        results.push(await runStep('functionApp', functionAppDiagnose.execute, { instance: instanceName, resourceGroup: target.resourceGroup, name: resources.functionApp.name }));
    }

    if (resources.staticWebApp) {
        results.push(await runStep('staticWebApp', staticWebAppDiagnose.execute, { instance: instanceName, resourceGroup: target.resourceGroup, name: resources.staticWebApp.name }));
    }

    const verification = await verify(args);

    const findingsByComponent = results.map((r) => ({
        component: r.label,
        overallStatus: r.ok ? (r.result.overallStatus || (r.result.note ? 'NOT_ASSESSED' : 'PASS')) : 'ERROR',
        failedChecks: r.ok ? (r.result.failedChecks || []) : [r.error.message],
    }));

    const anyFindings = findingsByComponent.some((f) => f.overallStatus === 'FINDINGS' || f.overallStatus === 'ERROR')
        || verification.relationshipFindings.length > 0;

    return {
        target,
        componentDiagnostics: findingsByComponent,
        relationshipFindings: verification.relationshipFindings,
        overallStatus: anyFindings ? 'FINDINGS' : 'PASS',
    };
}

module.exports = { execute };
