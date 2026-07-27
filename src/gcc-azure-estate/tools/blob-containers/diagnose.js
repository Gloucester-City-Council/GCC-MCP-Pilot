/**
 * Tool: azure_blob_container_diagnose
 *
 * Deterministic checks against a single container: public access level not
 * "None" (containers should default private), no lifecycle-rule coverage,
 * and legal hold present (informational — not necessarily bad).
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { execute: inspect } = require('./inspect');

function checkPublicAccess(inv) {
    const pass = inv.publicAccess === 'None';
    return {
        pass,
        publicAccess: inv.publicAccess,
        message: pass ? 'Container is private (no public access)' : `Container allows public access ("${inv.publicAccess}") — containers should default to private`,
    };
}

function checkLifecycleCoverage(inv) {
    const pass = inv.lifecycleRuleCoverage.covered;
    return {
        pass,
        ...inv.lifecycleRuleCoverage,
        message: pass ? 'Covered by an account lifecycle-management rule' : 'Not covered by any account lifecycle-management rule',
    };
}

function checkLegalHold(inv) {
    // Informational only — a legal hold being present is not inherently a
    // finding, so this always reports pass:true and simply surfaces the fact.
    return {
        pass: true,
        present: inv.legalHold.present,
        tags: inv.legalHold.tags,
        message: inv.legalHold.present
            ? 'Legal hold present — informational, verify it is still required'
            : 'No legal hold present',
    };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'storageAccount', 'name']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    assertPermitted(args.instance, 'blob-containers', 'diagnose');

    const inv = await inspect({
        instance: args.instance, resourceGroup: args.resourceGroup, storageAccount: args.storageAccount, name: args.name,
    });

    const findings = {
        publicAccess: checkPublicAccess(inv),
        lifecycleCoverage: checkLifecycleCoverage(inv),
        legalHold: checkLegalHold(inv),
    };

    const failedChecks = Object.entries(findings)
        .filter(([, v]) => v.pass === false)
        .map(([key]) => key);

    return {
        name: inv.name,
        resourceGroup: inv.resourceGroup,
        storageAccount: inv.storageAccount,
        overallStatus: failedChecks.length === 0 ? 'PASS' : 'FINDINGS',
        failedChecks,
        findings,
    };
}

module.exports = { execute };
