/**
 * Tool: azure_application_stack_diagnose
 *
 * Runs each named component's own *_diagnose tool, plus relationship
 * health checks: does the Function App's storage dependency resolve to
 * the named storage account, and does its backend link (if any) resolve
 * to the named Function App.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { execute: inspectStack } = require('./application-stack-inspect');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'stack', 'diagnose');
    const componentDiagnostics = {};

    if (args.functionApp) {
        const { execute: diagnoseFunctionApp } = require('../function-apps/diagnose');
        componentDiagnostics.functionApp = await diagnoseFunctionApp({ instance: instance.name, resourceGroup: args.resourceGroup, name: args.functionApp });
    }
    if (args.staticWebApp) {
        const { execute: diagnoseStaticWebApp } = require('../static-web-apps/diagnose');
        componentDiagnostics.staticWebApp = await diagnoseStaticWebApp({ instance: instance.name, resourceGroup: args.resourceGroup, name: args.staticWebApp });
    }
    if (args.storageAccount) {
        const { execute: diagnoseStorage } = require('../storage-accounts/diagnose');
        componentDiagnostics.storageAccount = await diagnoseStorage({ instance: instance.name, resourceGroup: args.resourceGroup, name: args.storageAccount });
    }
    if (args.cosmosAccount) {
        const { execute: diagnoseCosmosAccount } = require('../cosmos-accounts/diagnose');
        componentDiagnostics.cosmosAccount = await diagnoseCosmosAccount({ instance: instance.name, resourceGroup: args.resourceGroup, accountName: args.cosmosAccount });
    }

    const stack = await inspectStack(args);
    const relationshipFindings = [];

    if (args.functionApp && args.storageAccount) {
        const linked = stack.components.functionApp.storageDependency.accountName;
        if (!linked || linked.toLowerCase() !== args.storageAccount.toLowerCase()) {
            relationshipFindings.push(`Function App "${args.functionApp}" storage dependency resolves to "${linked || '(none)'}", not the declared "${args.storageAccount}".`);
        }
    }

    if (args.staticWebApp && args.functionApp) {
        const linkedNames = (stack.components.staticWebApp.linkedBackends || []).map((b) => b.name);
        if (!linkedNames.includes(args.functionApp)) {
            relationshipFindings.push(`Static Web App "${args.staticWebApp}" has no linked backend matching Function App "${args.functionApp}".`);
        }
    }

    const componentFindings = Object.entries(componentDiagnostics).map(([component, result]) => ({
        component, overallStatus: result.overallStatus, failedChecks: result.failedChecks || [],
    }));

    const anyFindings = componentFindings.some((f) => f.overallStatus === 'FINDINGS') || relationshipFindings.length > 0;

    return {
        resourceGroup: args.resourceGroup,
        componentDiagnostics: componentFindings,
        relationshipFindings,
        overallStatus: anyFindings ? 'FINDINGS' : 'PASS',
    };
}

module.exports = { execute };
