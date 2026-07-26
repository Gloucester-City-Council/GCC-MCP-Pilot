/**
 * Tool: azure_stack_plan
 *
 * Dry-run for an ApplicationStack YAML contract. Runs steps 1-6 of the
 * spec's 9-step algorithm: inspect the resource group, resolve existing
 * resources, detect conflicts, build a dependency-ordered plan, identify
 * what will be created/changed, and surface every required permission —
 * without creating anything. Delegates to each resource family's own
 * *_create_plan tool (in dependency order) so every safety rule already
 * enforced there (partition-key immutability, dependency-explicitness,
 * the permission gate) applies automatically here too.
 */

'use strict';

const { parseStackContract } = require('../../lib/yaml-contract');
const { runStep, normalizePartitionKey } = require('../../lib/stack-helpers');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { assertPermitted } = require('../../lib/permissions');

const rgInspect = require('../resource-groups/inspect');
const storageCreatePlan = require('../storage-accounts/create-plan');
const containerCreatePlan = require('../blob-containers/create-plan');
const cosmosAccountCreatePlan = require('../cosmos-accounts/create-plan');
const cosmosDatabaseCreatePlan = require('../cosmos-databases/create-plan');
const cosmosContainerCreatePlan = require('../cosmos-containers/create-plan');
const functionAppCreatePlan = require('../function-apps/create-plan');
const staticWebAppCreatePlan = require('../static-web-apps/create-plan');
const backendLinkPlan = require('../static-web-apps/backend-link-plan');

/** Builds the ordered list of {label, executeFn, args} steps for a parsed contract. Shared by plan.js and create.js so the two never drift out of sync on ordering or field-mapping. */
function buildSteps(contract, instanceName) {
    const { target, resources } = contract;
    const steps = [];

    steps.push({
        label: 'resourceGroup',
        executeFn: rgInspect.execute,
        args: { instance: instanceName, resourceGroup: target.resourceGroup },
    });

    if (resources.storage) {
        steps.push({
            label: 'storage',
            executeFn: storageCreatePlan.execute,
            args: {
                instance: instanceName,
                resourceGroup: target.resourceGroup,
                name: resources.storage.name,
                location: resources.storage.location || target.location,
                sku: resources.storage.sku,
                kind: resources.storage.kind,
                accessTier: resources.storage.accessTier,
            },
        });

        for (const container of resources.storage.containers || []) {
            steps.push({
                label: `storage.containers.${container.name}`,
                executeFn: containerCreatePlan.execute,
                args: {
                    instance: instanceName,
                    resourceGroup: target.resourceGroup,
                    storageAccount: resources.storage.name,
                    name: container.name,
                    publicAccess: container.publicAccess,
                },
            });
        }
    }

    if (resources.cosmos) {
        steps.push({
            label: 'cosmos.account',
            executeFn: cosmosAccountCreatePlan.execute,
            args: {
                instance: instanceName,
                resourceGroup: target.resourceGroup,
                accountName: resources.cosmos.account,
                location: resources.cosmos.location || target.location,
                apiType: resources.cosmos.apiType,
                consistencyPolicy: resources.cosmos.consistencyPolicy,
                regions: resources.cosmos.regions,
                capacityMode: resources.cosmos.capacityMode,
            },
        });

        steps.push({
            label: 'cosmos.database',
            executeFn: cosmosDatabaseCreatePlan.execute,
            args: {
                instance: instanceName,
                resourceGroup: target.resourceGroup,
                accountName: resources.cosmos.account,
                databaseName: resources.cosmos.database,
                throughputModel: resources.cosmos.throughputModel,
            },
        });

        for (const container of resources.cosmos.containers || []) {
            steps.push({
                label: `cosmos.containers.${container.name}`,
                executeFn: cosmosContainerCreatePlan.execute,
                args: {
                    instance: instanceName,
                    resourceGroup: target.resourceGroup,
                    accountName: resources.cosmos.account,
                    databaseName: resources.cosmos.database,
                    containerName: container.name,
                    partitionKey: normalizePartitionKey(container.partitionKey),
                    throughputModel: container.throughputModel,
                    indexingPolicy: container.indexingPolicy,
                    uniqueKeyPolicy: container.uniqueKeyPolicy,
                    defaultTtl: 'defaultTtl' in container ? container.defaultTtl : null,
                    analyticalStore: container.analyticalStore,
                },
            });
        }
    }

    if (resources.functionApp) {
        steps.push({
            label: 'functionApp',
            executeFn: functionAppCreatePlan.execute,
            args: {
                instance: instanceName,
                resourceGroup: target.resourceGroup,
                name: resources.functionApp.name,
                location: resources.functionApp.location || target.location,
                hostingPlanName: resources.functionApp.hostingPlanName,
                storageAccountName: resources.functionApp.storageAccountName || (resources.storage && resources.storage.name),
                appInsightsName: resources.functionApp.appInsightsName,
                runtime: resources.functionApp.runtime,
                identity: resources.functionApp.identity,
            },
        });
    }

    if (resources.staticWebApp) {
        steps.push({
            label: 'staticWebApp',
            executeFn: staticWebAppCreatePlan.execute,
            args: {
                instance: instanceName,
                resourceGroup: target.resourceGroup,
                name: resources.staticWebApp.name,
                location: resources.staticWebApp.location || target.location,
                sku: resources.staticWebApp.sku,
                repositoryUrl: resources.staticWebApp.repositoryUrl,
                branch: resources.staticWebApp.branch,
            },
        });

        if (resources.staticWebApp.backend && resources.staticWebApp.backend.functionApp) {
            steps.push({
                label: 'staticWebApp.backend',
                executeFn: backendLinkPlan.execute,
                args: {
                    instance: instanceName,
                    resourceGroup: target.resourceGroup,
                    name: resources.staticWebApp.name,
                    functionApp: { name: resources.staticWebApp.backend.functionApp },
                },
            });
        }
    }

    return steps;
}

function stepIsBlocked(step) {
    if (!step.ok) return true;
    const r = step.result;
    if (!r) return false;
    if (r.canApply === false || r.canCreate === false || r.willCreate === false) return true;
    return false;
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['contractYaml']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const contract = parseStackContract(args.contractYaml);
    const instanceName = args.instance || contract.target.instance;
    if (!instanceName) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'target.instance is required in the contract (or pass `instance` explicitly)');
    assertPermitted(instanceName, 'stack', 'plan');

    const steps = buildSteps(contract, instanceName);
    const results = [];
    for (const step of steps) {
        results.push(await runStep(step.label, step.executeFn, step.args));
    }

    const blockers = results.filter(stepIsBlocked).map((s) => ({
        step: s.label,
        reason: s.ok ? (s.result.blockers || s.result.conflicts || ['not ready']) : s.error,
    }));

    return {
        target: contract.target,
        steps: results,
        totalSteps: results.length,
        blockedSteps: blockers.length,
        blockers,
        readyToCreate: blockers.length === 0,
    };
}

module.exports = { execute, buildSteps, stepIsBlocked };
