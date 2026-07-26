/**
 * Tool: azure_storage_account_inspect
 *
 * Full configuration detail for a single storage account: kind, SKU/tier,
 * replication, access tier, public network access, shared-key access,
 * minimum TLS, HTTPS-only, network firewall rules (summarised), private
 * endpoint connections, managed identity, encryption key source, blob
 * soft-delete/versioning, lifecycle-management rule count, and diagnostic
 * settings coverage.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getStorageMgmtClient, getMonitorClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function getFirstBlobServiceProperties(client, resourceGroup, name) {
    for await (const props of client.blobServices.list(resourceGroup, name)) {
        return props;
    }
    return null;
}

async function getManagementPolicy(client, resourceGroup, name) {
    try {
        return await client.managementPolicies.get(resourceGroup, name, 'default');
    } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
    }
}

async function listPrivateEndpointConnections(client, resourceGroup, name) {
    const connections = [];
    try {
        for await (const conn of client.privateEndpointConnections.list(resourceGroup, name)) {
            connections.push(conn);
        }
    } catch (_err) {
        // Not fatal — some accounts/SKUs don't support private endpoints.
    }
    return connections;
}

async function countDiagnosticSettings(monitorClient, resourceId) {
    let count = 0;
    try {
        for await (const _s of monitorClient.diagnosticSettings.list(resourceId)) {
            count += 1;
        }
    } catch (_err) {
        // Diagnostic settings not supported/available — treat as zero.
    }
    return count;
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'storage', 'inspect');
    const client = getStorageMgmtClient(instance);
    const monitorClient = getMonitorClient(instance);

    let account;
    try {
        account = await client.storageAccounts.getProperties(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Storage account "${args.name}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const [blobServiceProps, managementPolicy, privateEndpointConnections, diagnosticSettingsCount] = await Promise.all([
        getFirstBlobServiceProperties(client, args.resourceGroup, args.name),
        getManagementPolicy(client, args.resourceGroup, args.name),
        listPrivateEndpointConnections(client, args.resourceGroup, args.name),
        countDiagnosticSettings(monitorClient, account.id),
    ]);

    const networkRuleSet = account.networkRuleSet || {};
    const deleteRetention = (blobServiceProps && blobServiceProps.deleteRetentionPolicy) || {};

    return {
        name: account.name,
        resourceGroup: args.resourceGroup,
        location: account.location,
        kind: account.kind || null,
        sku: account.sku ? { name: account.sku.name, tier: account.sku.tier } : null,
        accessTier: account.accessTier || null,
        publicNetworkAccess: account.publicNetworkAccess || null,
        allowSharedKeyAccess: account.allowSharedKeyAccess !== false,
        minimumTlsVersion: account.minimumTlsVersion || null,
        httpsOnly: account.enableHttpsTrafficOnly !== false,
        networkAcls: {
            defaultAction: networkRuleSet.defaultAction || null,
            bypass: networkRuleSet.bypass || null,
            ipRuleCount: (networkRuleSet.ipRules || []).length,
            virtualNetworkRuleCount: (networkRuleSet.virtualNetworkRules || []).length,
        },
        privateEndpointConnections: {
            count: privateEndpointConnections.length,
            names: privateEndpointConnections.map((c) => c.name),
        },
        identity: account.identity ? { type: account.identity.type, principalId: account.identity.principalId || null } : null,
        encryption: { keySource: (account.encryption && account.encryption.keySource) || null },
        blobService: {
            softDelete: { enabled: !!deleteRetention.enabled, days: deleteRetention.days || null },
            versioningEnabled: !!(blobServiceProps && blobServiceProps.isVersioningEnabled),
        },
        lifecycleManagement: {
            hasPolicy: !!managementPolicy,
            ruleCount: ((managementPolicy && managementPolicy.policy && managementPolicy.policy.rules) || []).length,
        },
        diagnosticSettings: { count: diagnosticSettingsCount },
        provisioningState: account.provisioningState || null,
    };
}

module.exports = { execute };
