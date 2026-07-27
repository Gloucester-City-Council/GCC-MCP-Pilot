/**
 * Tool: azure_cosmos_accounts_list
 *
 * Lists Cosmos DB accounts either subscription-wide or scoped to a single
 * resource group, depending on whether `resourceGroup` is provided.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { apiTypeFromAccount, isServerless, resourceGroupFromId } = require('../../lib/cosmos-helpers');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'inspect');
    const client = getCosmosClient(instance);

    const iterator = args.resourceGroup
        ? client.databaseAccounts.listByResourceGroup(args.resourceGroup)
        : client.databaseAccounts.list();

    const accounts = [];
    for await (const account of iterator) {
        accounts.push({
            name: account.name,
            resourceGroup: args.resourceGroup || resourceGroupFromId(account.id),
            location: account.location,
            apiType: apiTypeFromAccount(account),
            capacityMode: isServerless(account) ? 'Serverless' : 'Provisioned',
            consistencyLevel: (account.consistencyPolicy || {}).defaultConsistencyLevel || null,
            regionCount: (account.locations || []).length,
            provisioningState: account.provisioningState || null,
        });
    }

    return { accounts, totalCount: accounts.length };
}

module.exports = { execute };
