/**
 * Tool: azure_cosmos_account_diagnose
 *
 * Deterministic checklist (no LLM judgement) against a Cosmos DB account:
 *  - local auth enabled when it could be disabled (AAD/MSI-only access)
 *  - no automatic failover configured despite multiple regions
 *  - public network access enabled with no IP firewall rules
 *  - missing diagnostic settings
 *  - periodic backup policy with a very long retention vs. a very short
 *    backup interval (higher backup volume/cost than most workloads need)
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient, getMonitorClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError } = require('../../lib/cosmos-helpers');

// A periodic backup interval this short combined with a retention window this
// long produces a large number of retained backups — flagged informationally,
// not a hard failure, since some workloads genuinely need it.
const SHORT_BACKUP_INTERVAL_MINUTES = 60;
const LONG_BACKUP_RETENTION_HOURS = 168; // 7 days

async function countDiagnosticSettings(monitorClient, resourceId) {
    let count = 0;
    try {
        for await (const _s of monitorClient.diagnosticSettings.list(resourceId)) {
            count += 1;
        }
    } catch (_err) {
        // Not fatal — treated as "no visibility", same as zero settings.
    }
    return count;
}

function checkLocalAuth(account) {
    const pass = !!account.disableLocalAuth;
    return {
        pass,
        disableLocalAuth: !!account.disableLocalAuth,
        message: pass
            ? 'Local (key-based) authentication is disabled — AAD/MSI only.'
            : 'Local authentication is enabled. If clients can authenticate via AAD/managed identity, consider setting disableLocalAuth to reduce the account\'s key-leak blast radius.',
    };
}

function checkAutomaticFailover(account) {
    const regionCount = (account.locations || []).length;
    const pass = regionCount <= 1 || !!account.enableAutomaticFailover;
    return {
        pass,
        regionCount,
        automaticFailoverEnabled: !!account.enableAutomaticFailover,
        message: pass
            ? (regionCount <= 1 ? 'Single-region account — automatic failover not applicable.' : 'Automatic failover is enabled for this multi-region account.')
            : `Account has ${regionCount} regions but automatic failover is not enabled — a regional outage will not fail over automatically.`,
    };
}

function checkPublicNetworkExposure(account) {
    const publicAccess = account.publicNetworkAccess || 'Enabled';
    const hasFirewall = (account.ipRules || []).length > 0
        || (account.virtualNetworkRules || []).length > 0
        || (account.privateEndpointConnections || []).length > 0;
    const pass = publicAccess === 'Disabled' || hasFirewall;
    return {
        pass,
        publicNetworkAccess: publicAccess,
        ipRuleCount: (account.ipRules || []).length,
        virtualNetworkRuleCount: (account.virtualNetworkRules || []).length,
        privateEndpointConnectionCount: (account.privateEndpointConnections || []).length,
        message: pass
            ? 'Public network access is disabled, or restricted by firewall/VNet/private-endpoint rules.'
            : 'Public network access is enabled with no IP firewall rules, VNet rules, or private endpoints restricting it.',
    };
}

function checkDiagnosticSettings(count) {
    return {
        pass: count > 0,
        count,
        message: count > 0 ? `${count} diagnostic setting(s) configured.` : 'No diagnostic settings found — control-plane and data-plane activity on this account is not being exported.',
    };
}

function checkBackupPolicy(account) {
    const backupPolicy = account.backupPolicy;
    if (!backupPolicy || backupPolicy.type !== 'Periodic') {
        return {
            pass: true,
            applicable: false,
            message: backupPolicy && backupPolicy.type === 'Continuous'
                ? 'Continuous backup mode — periodic interval/retention checks do not apply.'
                : 'No periodic backup policy reported.',
        };
    }

    const props = backupPolicy.periodicModeProperties || {};
    const interval = props.backupIntervalInMinutes;
    const retention = props.backupRetentionIntervalInHours;
    const mismatch = typeof interval === 'number' && typeof retention === 'number'
        && interval <= SHORT_BACKUP_INTERVAL_MINUTES && retention >= LONG_BACKUP_RETENTION_HOURS;

    return {
        pass: !mismatch,
        applicable: true,
        backupIntervalInMinutes: interval ?? null,
        backupRetentionIntervalInHours: retention ?? null,
        message: mismatch
            ? `Backup interval (${interval} min) combined with retention (${retention}h) will retain a large number of backups — verify this is intentional (cost/storage impact).`
            : 'Periodic backup interval/retention combination looks reasonable.',
    };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'diagnose');
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

    const diagnosticSettingsCount = await countDiagnosticSettings(monitorClient, account.id);

    const findings = {
        localAuthEnabled: checkLocalAuth(account),
        noAutomaticFailoverMultiRegion: checkAutomaticFailover(account),
        publicNetworkNoFirewall: checkPublicNetworkExposure(account),
        missingDiagnosticSettings: checkDiagnosticSettings(diagnosticSettingsCount),
        backupRetentionFrequencyMismatch: checkBackupPolicy(account),
    };

    const failedChecks = Object.entries(findings)
        .filter(([, v]) => v.pass === false)
        .map(([key]) => key);

    return {
        accountName: account.name,
        overallStatus: failedChecks.length === 0 ? 'PASS' : 'FINDINGS',
        failedChecks,
        findings,
    };
}

module.exports = { execute };
