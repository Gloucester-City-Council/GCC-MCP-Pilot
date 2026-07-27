/**
 * Tool: azure_cosmos_account_create_plan
 *
 * Dry-run for azure_cosmos_account_create. Surfaces the dependency chain
 * explicitly (does the target resource group exist? does an account of
 * this name already exist?) rather than letting a create call fail deep
 * inside the ARM SDK. Never defaults apiType, consistencyPolicy, regions,
 * or capacityMode — all four must be supplied by the caller.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient, getResourceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { buildAccountCreateBody, isNotFoundError } = require('../../lib/cosmos-helpers');

const REQUIRED_FIELDS = ['instance', 'resourceGroup', 'accountName', 'location', 'apiType', 'consistencyPolicy', 'regions', 'capacityMode'];

async function execute(args = {}) {
    const missing = validateRequired(args, REQUIRED_FIELDS);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'plan');
    const cosmosClient = getCosmosClient(instance);
    const resourceClient = getResourceClient(instance);

    const built = buildAccountCreateBody(args);
    if (built.error) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, built.error);
    }

    const dependencies = {};

    try {
        const rg = await resourceClient.resourceGroups.get(args.resourceGroup);
        dependencies.resourceGroup = { satisfied: true, location: rg.location };
    } catch (err) {
        if (!isNotFoundError(err)) throw err;
        dependencies.resourceGroup = { satisfied: false, message: `Resource group "${args.resourceGroup}" does not exist.` };
    }

    let accountExists = false;
    try {
        await cosmosClient.databaseAccounts.get(args.resourceGroup, args.accountName);
        accountExists = true;
    } catch (err) {
        if (!isNotFoundError(err)) throw err;
    }

    const blockers = [];
    if (!dependencies.resourceGroup.satisfied) blockers.push('resourceGroup');
    if (accountExists) blockers.push('accountAlreadyExists');

    return {
        accountName: args.accountName,
        resourceGroup: args.resourceGroup,
        dependencies,
        accountAlreadyExists: accountExists,
        proposedConfiguration: built.body,
        warnings: built.warnings,
        canApply: blockers.length === 0,
        blockers,
        requiredPermission: { resourceFamily: 'cosmos', operationClass: 'create' },
    };
}

module.exports = { execute };
