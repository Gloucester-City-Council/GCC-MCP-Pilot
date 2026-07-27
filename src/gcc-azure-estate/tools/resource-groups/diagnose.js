/**
 * Tool: azure_resource_group_diagnose
 *
 * Deterministic checks (no LLM judgement) against a resource group:
 * location metadata, required tags, naming convention, resource count,
 * unexpected resource types, cross-region deployment, orphaned
 * resources, diagnostic-settings coverage, policy compliance (where
 * available), and environment classification.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getResourceClient, getMonitorClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { execute: inventory } = require('./inventory');

const REQUIRED_TAGS = (process.env.AZURE_ESTATE_REQUIRED_TAGS || 'environment,owner').split(',').map((t) => t.trim()).filter(Boolean);
const NAME_PATTERN = new RegExp(process.env.AZURE_ESTATE_RG_NAME_PATTERN || '^rg-', 'i');
const DIAGNOSTIC_SAMPLE_LIMIT = 25;
const ENV_KEYWORDS = ['prod', 'production', 'dev', 'development', 'test', 'staging', 'uat'];

function checkRequiredTags(tags) {
    const missing = REQUIRED_TAGS.filter((tag) => !(tag in tags));
    return {
        pass: missing.length === 0,
        missingTags: missing,
        message: missing.length ? `Missing required tag(s): ${missing.join(', ')}` : 'All required tags present',
    };
}

function checkNamingConvention(name) {
    const pass = NAME_PATTERN.test(name);
    return {
        pass,
        pattern: NAME_PATTERN.source,
        message: pass ? 'Name matches convention' : `Name "${name}" does not match expected pattern /${NAME_PATTERN.source}/i`,
    };
}

function checkEnvironmentClassification(name, tags, instanceEnvironment) {
    const nameLower = name.toLowerCase();
    const nameKeyword = ENV_KEYWORDS.find((kw) => nameLower.includes(kw));
    const tagEnv = (tags.environment || '').toLowerCase();

    if (!nameKeyword && !tagEnv) {
        return { pass: false, message: 'No environment classification found in name or tags', inferred: null };
    }

    if (nameKeyword && tagEnv && !tagEnv.includes(nameKeyword.slice(0, 4)) && !nameKeyword.includes(tagEnv.slice(0, 4))) {
        return {
            pass: false,
            message: `Name suggests "${nameKeyword}" but environment tag is "${tagEnv}" — possible misclassification`,
            inferred: nameKeyword,
        };
    }

    return { pass: true, message: 'Environment classification is consistent', inferred: tagEnv || nameKeyword };
}

async function checkDiagnosticCoverage(monitorClient, resources) {
    const sample = resources.slice(0, DIAGNOSTIC_SAMPLE_LIMIT);
    let withSettings = 0;
    let checked = 0;

    for (const r of sample) {
        try {
            let hasAny = false;
            for await (const _s of monitorClient.diagnosticSettings.list(r.id)) {
                hasAny = true;
                break;
            }
            checked += 1;
            if (hasAny) withSettings += 1;
        } catch (_err) {
            // Not every resource type supports diagnostic settings — skip silently.
        }
    }

    return {
        checked,
        withDiagnosticSettings: withSettings,
        withoutDiagnosticSettings: checked - withSettings,
        truncated: resources.length > DIAGNOSTIC_SAMPLE_LIMIT,
        sampleLimit: DIAGNOSTIC_SAMPLE_LIMIT,
    };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'resource-groups', 'diagnose');
    const resourceClient = getResourceClient(instance);
    const monitorClient = getMonitorClient(instance);

    let rg;
    try {
        rg = await resourceClient.resourceGroups.get(args.resourceGroup);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Resource group "${args.resourceGroup}" not found in instance "${instance.name}"`);
        }
        throw err;
    }

    const inv = await inventory({ instance: args.instance, resourceGroup: args.resourceGroup });

    const resources = [];
    for await (const r of resourceClient.resources.listByResourceGroup(args.resourceGroup)) {
        resources.push(r);
    }

    const findings = {
        locationMetadata: { pass: !!rg.location, location: rg.location },
        requiredTags: checkRequiredTags(rg.tags || {}),
        namingConvention: checkNamingConvention(rg.name),
        resourceCount: { count: resources.length },
        unexpectedResourceTypes: {
            pass: inv.configurationFindings.length === 0,
            findings: inv.configurationFindings,
        },
        crossRegionDeployment: {
            pass: inv.crossRegionResources.length === 0,
            regions: inv.crossRegionResources,
        },
        orphanedResources: {
            pass: inv.orphanedResources.length === 0,
            resources: inv.orphanedResources,
        },
        diagnosticSettingsCoverage: await checkDiagnosticCoverage(monitorClient, resources),
        policyCompliance: {
            available: false,
            message: 'Policy compliance requires @azure/arm-policyinsights, which is not wired into this build. Not assessed.',
        },
        environmentClassification: checkEnvironmentClassification(rg.name, rg.tags || {}, instance.environment),
    };

    const failedChecks = Object.entries(findings)
        .filter(([, v]) => v.pass === false)
        .map(([key]) => key);

    return {
        resourceGroup: rg.name,
        overallStatus: failedChecks.length === 0 ? 'PASS' : 'FINDINGS',
        failedChecks,
        findings,
    };
}

module.exports = { execute };
