/**
 * Tool: azure_cosmos_account_inspect
 *
 * Full operational view of a single Cosmos DB account: API type,
 * consistency policy, regions + failover priorities, automatic failover,
 * multiple-write-regions, capacity mode (serverless vs provisioned),
 * backup policy, public network access, IP firewall rules, private
 * endpoint connections, local auth, managed identity, and diagnostic
 * settings coverage.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient, getMonitorClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const {
    apiTypeFromAccount, isServerless, summarizeBackupPolicy, summarizeRegions, isNotFoundError,
} = require('../../lib/cosmos-helpers');

async function fetchDiagnosticSettings(monitorClient, resourceId) {
    const settings = [];
    try {
        for await (const s of monitorClient.diagnosticSettings.list(resourceId)) {
            settings.push({ name: s.name, logsEnabled: (s.logs || []).some((l) => l.enabled), metricsEnabled: (s.metrics || []).some((m) => m.enabled) });
        }
    } catch (_err) {
        // Diagnostic settings aren't available for every account shape — best-effort only.
    }
    return settings;
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'inspect');
    const client = getCosmosClient(instance);
    const monitorClient = getMonitorClient(instance);

    let account;
    try {
        account = await client.databaseAccounts.get(args.resourceGroup, args.accountName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Cosmos DB account "${args.accountName}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const diagnosticSettings = await fetchDiagnosticSettings(monitorClient, account.id);

    return {
        name: account.name,
        id: account.id,
        location: account.location,
        resourceGroup: args.resourceGroup,
        apiType: apiTypeFromAccount(account),
        capabilities: (account.capabilities || []).map((c) => c.name),
        consistencyPolicy: account.consistencyPolicy || null,
        regions: summarizeRegions(account.locations),
        automaticFailoverEnabled: !!account.enableAutomaticFailover,
        multipleWriteRegionsEnabled: !!account.enableMultipleWriteLocations,
        capacityMode: isServerless(account) ? 'Serverless' : 'Provisioned',
        backupPolicy: summarizeBackupPolicy(account.backupPolicy),
        publicNetworkAccess: account.publicNetworkAccess || null,
        ipFirewallRules: {
            count: (account.ipRules || []).length,
            rules: (account.ipRules || []).map((r) => r.ipAddressOrRange),
        },
        privateEndpointConnections: {
            count: (account.privateEndpointConnections || []).length,
            connections: (account.privateEndpointConnections || []).map((p) => ({
                name: p.name,
                status: (p.privateLinkServiceConnectionState || {}).status || null,
            })),
        },
        localAuthDisabled: !!account.disableLocalAuth,
        identity: account.identity ? { type: account.identity.type, principalId: account.identity.principalId || null } : null,
        diagnosticSettings: {
            count: diagnosticSettings.length,
            settings: diagnosticSettings,
        },
        provisioningState: account.provisioningState || null,
    };
}

module.exports = { execute };
