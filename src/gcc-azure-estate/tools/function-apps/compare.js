/**
 * Tool: azure_function_app_compare
 *
 * Compares two Function Apps (left/right), each identified by
 * {instance, resourceGroup, name}. Runtime/OS/plan/app-settings-name diff.
 * Values of secret-looking settings are never compared — only whether the
 * key exists on both sides. Plain settings' values are compared safely.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { classifySettingName, deriveRuntime, getHostingPlanSummary } = require('./shared');

async function fetchSide(side) {
    const instance = assertPermitted(side.instance, 'function-apps', 'compare');
    const client = getWebSiteClient(instance);

    let site;
    try {
        site = await client.webApps.get(side.resourceGroup, side.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Function App "${side.name}" not found in resource group "${side.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const siteConfig = await client.webApps.getConfiguration(side.resourceGroup, side.name);
    const appSettings = await client.webApps.listApplicationSettings(side.resourceGroup, side.name);
    const properties = appSettings.properties || {};
    const runtime = deriveRuntime(site, siteConfig);
    const hostingPlan = await getHostingPlanSummary(client, site.serverFarmId);

    return {
        instance: instance.name, resourceGroup: side.resourceGroup, name: site.name, site, siteConfig, properties, runtime, hostingPlan,
    };
}

function diffSettings(leftProps, rightProps) {
    const leftKeys = new Set(Object.keys(leftProps));
    const rightKeys = new Set(Object.keys(rightProps));

    const onlyInLeft = [...leftKeys].filter((k) => !rightKeys.has(k));
    const onlyInRight = [...rightKeys].filter((k) => !leftKeys.has(k));
    const inBoth = [...leftKeys].filter((k) => rightKeys.has(k));

    const comparable = inBoth.map((key) => {
        const classification = classifySettingName(key);
        if (classification === 'secret-like') {
            return { name: key, classification, valuesCompared: false, note: 'Secret-like — values never compared' };
        }
        const differs = leftProps[key] !== rightProps[key];
        return {
            name: key, classification, valuesCompared: true, differs,
        };
    });

    return {
        onlyInLeft, onlyInRight, inBoth: comparable, valueDrift: comparable.filter((c) => c.valuesCompared && c.differs).map((c) => c.name),
    };
}

function execute_impl(left, right) {
    return {
        left: {
            instance: left.instance, resourceGroup: left.resourceGroup, name: left.name, runtime: left.runtime, hostingPlan: left.hostingPlan,
        },
        right: {
            instance: right.instance, resourceGroup: right.resourceGroup, name: right.name, runtime: right.runtime, hostingPlan: right.hostingPlan,
        },
        runtimeDrift: JSON.stringify(left.runtime) !== JSON.stringify(right.runtime),
        osDrift: left.runtime.osType !== right.runtime.osType,
        planSkuDrift: (left.hostingPlan.skuName || null) !== (right.hostingPlan.skuName || null),
        appSettings: diffSettings(left.properties, right.properties),
        identical: left.runtime.osType === right.runtime.osType
            && left.runtime.runtimeName === right.runtime.runtimeName
            && (left.hostingPlan.skuName || null) === (right.hostingPlan.skuName || null),
    };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['left', 'right']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);
    for (const side of ['left', 'right']) {
        const sideMissing = validateRequired(args[side] || {}, ['instance', 'resourceGroup', 'name']);
        if (sideMissing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `${side}.${sideMissing.replace('Missing required field: ', '')} is required`);
    }

    const [left, right] = await Promise.all([fetchSide(args.left), fetchSide(args.right)]);
    return execute_impl(left, right);
}

module.exports = { execute };
