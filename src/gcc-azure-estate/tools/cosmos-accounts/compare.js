/**
 * Tool: azure_cosmos_account_compare
 *
 * Compares two Cosmos DB accounts (same or different instances) — typically
 * the same logical account across azure-prod vs. a second instance, or two
 * accounts that are meant to mirror each other. Flags drift in consistency,
 * regions, capacity mode, backup policy, network exposure, and local auth.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const {
    apiTypeFromAccount, isServerless, summarizeBackupPolicy, summarizeRegions, isNotFoundError,
} = require('../../lib/cosmos-helpers');

async function fetchSide(side) {
    const instance = assertPermitted(side.instance, 'cosmos', 'compare');
    const client = getCosmosClient(instance);

    let account;
    try {
        account = await client.databaseAccounts.get(side.resourceGroup, side.accountName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Cosmos DB account "${side.accountName}" not found in resource group "${side.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    return {
        instance: instance.name,
        accountName: account.name,
        location: account.location,
        apiType: apiTypeFromAccount(account),
        consistencyPolicy: account.consistencyPolicy || null,
        regions: summarizeRegions(account.locations),
        automaticFailoverEnabled: !!account.enableAutomaticFailover,
        multipleWriteRegionsEnabled: !!account.enableMultipleWriteLocations,
        capacityMode: isServerless(account) ? 'Serverless' : 'Provisioned',
        backupPolicy: summarizeBackupPolicy(account.backupPolicy),
        publicNetworkAccess: account.publicNetworkAccess || null,
        ipFirewallRuleCount: (account.ipRules || []).length,
        localAuthDisabled: !!account.disableLocalAuth,
    };
}

function diffField(left, right, field) {
    const l = JSON.stringify(left[field]);
    const r = JSON.stringify(right[field]);
    return l === r ? null : { left: left[field], right: right[field] };
}

function execute_impl(left, right) {
    const fields = [
        'apiType', 'consistencyPolicy', 'regions', 'automaticFailoverEnabled',
        'multipleWriteRegionsEnabled', 'capacityMode', 'backupPolicy',
        'publicNetworkAccess', 'ipFirewallRuleCount', 'localAuthDisabled',
    ];

    const drift = {};
    for (const field of fields) {
        const d = diffField(left, right, field);
        if (d) drift[field] = d;
    }

    return {
        left: { instance: left.instance, accountName: left.accountName, location: left.location },
        right: { instance: right.instance, accountName: right.accountName, location: right.location },
        identical: Object.keys(drift).length === 0,
        drift,
    };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['left', 'right']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);
    for (const side of ['left', 'right']) {
        const sideMissing = validateRequired(args[side] || {}, ['instance', 'resourceGroup', 'accountName']);
        if (sideMissing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `${side}.${sideMissing.replace('Missing required field: ', '')} is required`);
    }

    const [left, right] = await Promise.all([fetchSide(args.left), fetchSide(args.right)]);
    return execute_impl(left, right);
}

module.exports = { execute };
