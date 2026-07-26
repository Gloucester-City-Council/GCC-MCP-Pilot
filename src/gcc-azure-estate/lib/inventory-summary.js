/**
 * Shared summarisation helpers for *_inventory tools. A resource group is
 * an operational boundary, not merely a filter — these functions turn a
 * flat ARM resource list into the summary shape the spec asks for:
 * resources by type, regions, tags, and managed identities.
 */

'use strict';

function summarizeByType(resources) {
    const byType = {};
    for (const r of resources) {
        byType[r.type] = (byType[r.type] || 0) + 1;
    }
    return byType;
}

function summarizeByRegion(resources) {
    const byRegion = {};
    for (const r of resources) {
        const region = r.location || 'global';
        byRegion[region] = (byRegion[region] || 0) + 1;
    }
    return byRegion;
}

function summarizeTags(resources) {
    const tagKeys = {};
    for (const r of resources) {
        for (const key of Object.keys(r.tags || {})) {
            tagKeys[key] = (tagKeys[key] || 0) + 1;
        }
    }
    return tagKeys;
}

function summarizeIdentities(resources) {
    return resources
        .filter((r) => r.identity && r.identity.type && r.identity.type !== 'None')
        .map((r) => ({ name: r.name, type: r.type, identityType: r.identity.type }));
}

function isCrossRegion(resources, resourceGroupLocation) {
    const regions = new Set(resources.map((r) => r.location).filter(Boolean));
    regions.delete(resourceGroupLocation);
    return regions.size > 0 ? [...regions] : [];
}

module.exports = { summarizeByType, summarizeByRegion, summarizeTags, summarizeIdentities, isCrossRegion };
