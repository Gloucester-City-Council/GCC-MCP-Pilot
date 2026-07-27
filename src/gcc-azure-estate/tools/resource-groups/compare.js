/**
 * Tool: azure_resource_group_compare
 *
 * Compares two resource groups — typically the same logical environment
 * across two instances (e.g. azure-prod vs azure-dev), or two resource
 * groups within one instance. Flags resources present in one side but
 * absent from the other, plus type/tag/region drift.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getResourceClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { summarizeByType, summarizeByRegion, summarizeTags } = require('../../lib/inventory-summary');

async function fetchSide(side) {
    const instance = assertPermitted(side.instance, 'resource-groups', 'compare');
    const client = getResourceClient(instance);

    let rg;
    try {
        rg = await client.resourceGroups.get(side.resourceGroup);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Resource group "${side.resourceGroup}" not found in instance "${instance.name}"`);
        }
        throw err;
    }

    const resources = [];
    for await (const r of client.resources.listByResourceGroup(side.resourceGroup)) {
        resources.push(r);
    }

    return { instance: instance.name, resourceGroup: rg.name, location: rg.location, tags: rg.tags || {}, resources };
}

function resourceKey(r) {
    return `${r.type}::${r.name}`;
}

function execute_impl(left, right) {
    const leftKeys = new Set(left.resources.map(resourceKey));
    const rightKeys = new Set(right.resources.map(resourceKey));

    const onlyInLeft = left.resources.filter((r) => !rightKeys.has(resourceKey(r))).map((r) => ({ type: r.type, name: r.name }));
    const onlyInRight = right.resources.filter((r) => !leftKeys.has(resourceKey(r))).map((r) => ({ type: r.type, name: r.name }));

    const tagKeysLeft = new Set(Object.keys(left.tags));
    const tagKeysRight = new Set(Object.keys(right.tags));
    const tagKeyDrift = {
        onlyInLeft: [...tagKeysLeft].filter((k) => !tagKeysRight.has(k)),
        onlyInRight: [...tagKeysRight].filter((k) => !tagKeysLeft.has(k)),
    };

    return {
        left: { instance: left.instance, resourceGroup: left.resourceGroup, location: left.location, resourceCount: left.resources.length },
        right: { instance: right.instance, resourceGroup: right.resourceGroup, location: right.location, resourceCount: right.resources.length },
        resourcesOnlyInLeft: onlyInLeft,
        resourcesOnlyInRight: onlyInRight,
        identical: onlyInLeft.length === 0 && onlyInRight.length === 0,
        byType: { left: summarizeByType(left.resources), right: summarizeByType(right.resources) },
        byRegion: { left: summarizeByRegion(left.resources), right: summarizeByRegion(right.resources) },
        tagKeyDrift,
        locationDrift: left.location !== right.location ? { left: left.location, right: right.location } : null,
    };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['left', 'right']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);
    for (const side of ['left', 'right']) {
        const sideMissing = validateRequired(args[side] || {}, ['instance', 'resourceGroup']);
        if (sideMissing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `${side}.${sideMissing.replace('Missing required field: ', '')} is required`);
    }

    const [left, right] = await Promise.all([fetchSide(args.left), fetchSide(args.right)]);
    return execute_impl(left, right);
}

module.exports = { execute };
