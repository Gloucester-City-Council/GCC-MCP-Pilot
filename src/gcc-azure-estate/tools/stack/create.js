/**
 * Tool: azure_stack_create
 *
 * Performs steps 1-9 of the spec's ApplicationStack algorithm: everything
 * azure_stack_plan does, plus sequenced creation in dependency order
 * (Resource Group -> Storage Account -> Blob Containers -> Cosmos Account
 * -> Cosmos Database -> Cosmos Containers -> Function App -> Static Web
 * App -> backend link), each followed by a verification read-back.
 *
 * Aborts on the first hard failure and returns a partial-completion
 * report — already-created resources are NOT rolled back. A resource
 * that already exists and is not in conflict is skipped (idempotent
 * re-apply), not re-created.
 */

'use strict';

const { parseStackContract } = require('../../lib/yaml-contract');
const { runStep } = require('../../lib/stack-helpers');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { assertPermitted } = require('../../lib/permissions');
const { buildSteps: buildPlanSteps, stepIsBlocked } = require('./plan');

const rgCreate = require('../resource-groups/create');
const rgInspect = require('../resource-groups/inspect');
const storageCreate = require('../storage-accounts/create');
const containerCreate = require('../blob-containers/create');
const cosmosAccountCreate = require('../cosmos-accounts/create');
const cosmosDatabaseCreate = require('../cosmos-databases/create');
const cosmosContainerCreate = require('../cosmos-containers/create');
const functionAppCreate = require('../function-apps/create');
const staticWebAppCreate = require('../static-web-apps/create');
const backendLinkApply = require('../static-web-apps/backend-link-apply');

const CREATE_FN_BY_PREFIX = [
    ['storage.containers.', containerCreate.execute],
    ['storage', storageCreate.execute],
    ['cosmos.containers.', cosmosContainerCreate.execute],
    ['cosmos.account', cosmosAccountCreate.execute],
    ['cosmos.database', cosmosDatabaseCreate.execute],
    ['functionApp', functionAppCreate.execute],
    ['staticWebApp.backend', backendLinkApply.execute],
    ['staticWebApp', staticWebAppCreate.execute],
];

function createFnForLabel(label) {
    const match = CREATE_FN_BY_PREFIX.find(([prefix]) => label.startsWith(prefix));
    return match ? match[1] : null;
}

/** "Already exists" is the only blocker a re-apply may skip past — anything else (bad config, missing dependency, FORBIDDEN, partition-key mismatch) stops the run. */
function isBenignExists(planStep) {
    if (!planStep.ok) return false;
    const r = planStep.result;
    const blockers = r.blockers || [];
    const onlyExistsBlockers = blockers.every((b) => /already ?exists|AlreadyExists/i.test(String(b)));
    const conflictsAreExistsOnly = (r.conflicts || []).every((c) => /already exists/i.test(String(c)));
    return (blockers.length === 0 || onlyExistsBlockers) && conflictsAreExistsOnly
        && (r.accountAlreadyExists || r.databaseAlreadyExists || r.containerAlreadyExists || r.nameAlreadyExists
            || (r.conflicts && r.conflicts.length > 0) || false);
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['contractYaml']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const contract = parseStackContract(args.contractYaml);
    const instanceName = args.instance || contract.target.instance;
    if (!instanceName) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'target.instance is required in the contract (or pass `instance` explicitly)');
    assertPermitted(instanceName, 'stack', 'create');

    const completed = [];
    const skipped = [];

    // Step 1: resource group. Created only if target.location is supplied
    // and it doesn't already exist — this MCP never guesses a region.
    const rgStep = await runStep('resourceGroup', rgInspect.execute, { instance: instanceName, resourceGroup: contract.target.resourceGroup });
    if (!rgStep.ok && rgStep.error.code === ERROR_CODES.NOT_FOUND) {
        if (!contract.target.location) {
            return {
                target: contract.target,
                completed, skipped,
                aborted: true,
                abortedAt: 'resourceGroup',
                reason: 'Resource group does not exist and target.location was not supplied — cannot create it without a region.',
            };
        }
        const created = await runStep('resourceGroup', rgCreate.execute, { instance: instanceName, name: contract.target.resourceGroup, location: contract.target.location });
        if (!created.ok) {
            return {
                target: contract.target, completed, skipped, aborted: true, abortedAt: 'resourceGroup', reason: created.error,
            };
        }
        completed.push(created);
    } else if (rgStep.ok) {
        skipped.push({ label: 'resourceGroup', reason: 'already exists' });
    } else {
        return {
            target: contract.target, completed, skipped, aborted: true, abortedAt: 'resourceGroup', reason: rgStep.error,
        };
    }

    const planSteps = buildPlanSteps(contract, instanceName);

    for (const step of planSteps) {
        const dryRun = await runStep(step.label, step.executeFn, step.args);

        if (stepIsBlocked(dryRun) && !isBenignExists(dryRun)) {
            return {
                target: contract.target,
                completed,
                skipped,
                aborted: true,
                abortedAt: step.label,
                reason: dryRun.ok ? { blockers: dryRun.result.blockers || dryRun.result.conflicts } : dryRun.error,
            };
        }

        if (stepIsBlocked(dryRun) && isBenignExists(dryRun)) {
            skipped.push({ label: step.label, reason: 'already exists' });
            continue;
        }

        const createFn = createFnForLabel(step.label);
        if (!createFn) {
            skipped.push({ label: step.label, reason: 'no create action for this step (plan-only)' });
            continue;
        }

        const created = await runStep(step.label, createFn, step.args);
        if (!created.ok) {
            return {
                target: contract.target, completed, skipped, aborted: true, abortedAt: step.label, reason: created.error,
            };
        }
        completed.push(created);
    }

    return {
        target: contract.target,
        completed,
        skipped,
        aborted: false,
        totalCreated: completed.length,
        totalSkipped: skipped.length,
    };
}

module.exports = { execute };
