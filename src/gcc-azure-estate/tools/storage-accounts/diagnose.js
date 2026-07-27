/**
 * Tool: azure_storage_account_diagnose
 *
 * Deterministic checklist against a single storage account, mirroring the
 * shape of azure_resource_group_diagnose: public network access with no
 * firewall rules, shared-key access left enabled, minimum TLS below 1.2,
 * HTTPS-only disabled, blob soft delete disabled, versioning disabled, and
 * no diagnostic settings.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { execute: inspect } = require('./inspect');

const TLS_ORDER = { TLS1_0: 0, TLS1_1: 1, TLS1_2: 2, TLS1_3: 3 };

function checkPublicNetworkExposure(inv) {
    const isPublic = inv.publicNetworkAccess !== 'Disabled';
    const hasNoFirewallRules = inv.networkAcls.defaultAction !== 'Deny'
        && inv.networkAcls.ipRuleCount === 0
        && inv.networkAcls.virtualNetworkRuleCount === 0;
    const pass = !(isPublic && hasNoFirewallRules);
    return {
        pass,
        publicNetworkAccess: inv.publicNetworkAccess,
        networkAcls: inv.networkAcls,
        message: pass
            ? 'Public network access is disabled or restricted by firewall rules'
            : 'Public network access is enabled with no IP/vnet firewall rules restricting it',
    };
}

function checkSharedKeyAccess(inv) {
    const pass = inv.allowSharedKeyAccess === false;
    return {
        pass,
        allowSharedKeyAccess: inv.allowSharedKeyAccess,
        message: pass ? 'Shared-key access is disabled (Azure AD only)' : 'Shared-key access is enabled — consider disabling it if all clients can use Azure AD',
    };
}

function checkMinimumTls(inv) {
    const current = TLS_ORDER[inv.minimumTlsVersion];
    const pass = current !== undefined && current >= TLS_ORDER.TLS1_2;
    return {
        pass,
        minimumTlsVersion: inv.minimumTlsVersion,
        message: pass ? 'Minimum TLS version is 1.2 or higher' : `Minimum TLS version is "${inv.minimumTlsVersion || 'unset'}" — should be TLS1_2 or higher`,
    };
}

function checkHttpsOnly(inv) {
    return {
        pass: inv.httpsOnly === true,
        httpsOnly: inv.httpsOnly,
        message: inv.httpsOnly ? 'HTTPS-only traffic is enforced' : 'HTTPS-only traffic is NOT enforced',
    };
}

function checkSoftDelete(inv) {
    const enabled = inv.blobService.softDelete.enabled;
    return {
        pass: enabled === true,
        softDelete: inv.blobService.softDelete,
        message: enabled ? 'Blob soft delete is enabled' : 'Blob soft delete is disabled',
    };
}

function checkVersioning(inv) {
    return {
        pass: inv.blobService.versioningEnabled === true,
        versioningEnabled: inv.blobService.versioningEnabled,
        message: inv.blobService.versioningEnabled ? 'Blob versioning is enabled' : 'Blob versioning is disabled',
    };
}

function checkDiagnosticSettings(inv) {
    const count = inv.diagnosticSettings.count;
    return {
        pass: count > 0,
        count,
        message: count > 0 ? `${count} diagnostic setting(s) configured` : 'No diagnostic settings configured',
    };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    assertPermitted(args.instance, 'storage', 'diagnose');

    const inv = await inspect({ instance: args.instance, resourceGroup: args.resourceGroup, name: args.name });

    const findings = {
        publicNetworkExposure: checkPublicNetworkExposure(inv),
        sharedKeyAccess: checkSharedKeyAccess(inv),
        minimumTlsVersion: checkMinimumTls(inv),
        httpsOnly: checkHttpsOnly(inv),
        softDelete: checkSoftDelete(inv),
        versioning: checkVersioning(inv),
        diagnosticSettings: checkDiagnosticSettings(inv),
    };

    const failedChecks = Object.entries(findings)
        .filter(([, v]) => v.pass === false)
        .map(([key]) => key);

    return {
        name: inv.name,
        resourceGroup: inv.resourceGroup,
        overallStatus: failedChecks.length === 0 ? 'PASS' : 'FINDINGS',
        failedChecks,
        findings,
    };
}

module.exports = { execute };
