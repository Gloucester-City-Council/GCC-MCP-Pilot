/**
 * Tool: azure_static_web_app_compare
 *
 * Compares two Static Web Apps (same or different instances) — SKU,
 * region, custom-domain, and application-setting-NAME drift only. Setting
 * values are never fetched, so they cannot appear in a diff.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const {
    toCustomDomainSummary, namesOnly, collectAsyncIterable, getStaticSiteOrNotFound,
} = require('./_shared');

async function fetchSide(side) {
    const sideMissing = validateRequired(side || {}, ['instance', 'resourceGroup', 'name']);
    if (sideMissing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, sideMissing);

    const instance = assertPermitted(side.instance, 'static-web-apps', 'compare');
    const client = getWebSiteClient(instance);

    const site = await getStaticSiteOrNotFound(client, side.resourceGroup, side.name, instance.name);

    const [customDomains, appSettingsResult] = await Promise.all([
        collectAsyncIterable(client.staticSites.listStaticSiteCustomDomains(side.resourceGroup, side.name)).catch(() => []),
        client.staticSites.listStaticSiteAppSettings(side.resourceGroup, side.name).catch(() => ({ properties: {} })),
    ]);

    return {
        instance: instance.name,
        resourceGroup: side.resourceGroup,
        name: site.name,
        location: site.location,
        sku: site.sku ? { name: site.sku.name, tier: site.sku.tier } : null,
        customDomains: customDomains.map(toCustomDomainSummary),
        settingNames: namesOnly(appSettingsResult),
    };
}

function diffArrays(leftItems, rightItems) {
    const leftSet = new Set(leftItems);
    const rightSet = new Set(rightItems);
    return {
        onlyInLeft: leftItems.filter((i) => !rightSet.has(i)),
        onlyInRight: rightItems.filter((i) => !leftSet.has(i)),
        inBoth: leftItems.filter((i) => rightSet.has(i)),
    };
}

function execute_impl(left, right) {
    const leftDomains = left.customDomains.map((d) => d.domainName);
    const rightDomains = right.customDomains.map((d) => d.domainName);

    return {
        left: { instance: left.instance, resourceGroup: left.resourceGroup, name: left.name, location: left.location, sku: left.sku },
        right: { instance: right.instance, resourceGroup: right.resourceGroup, name: right.name, location: right.location, sku: right.sku },
        skuDrift: JSON.stringify(left.sku) !== JSON.stringify(right.sku) ? { left: left.sku, right: right.sku } : null,
        regionDrift: left.location !== right.location ? { left: left.location, right: right.location } : null,
        customDomainDrift: diffArrays(leftDomains, rightDomains),
        settingNameDrift: diffArrays(left.settingNames, right.settingNames),
        identical: left.sku && right.sku
            ? (JSON.stringify(left.sku) === JSON.stringify(right.sku)
                && left.location === right.location
                && diffArrays(leftDomains, rightDomains).onlyInLeft.length === 0
                && diffArrays(leftDomains, rightDomains).onlyInRight.length === 0
                && diffArrays(left.settingNames, right.settingNames).onlyInLeft.length === 0
                && diffArrays(left.settingNames, right.settingNames).onlyInRight.length === 0)
            : false,
    };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['left', 'right']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const [left, right] = await Promise.all([fetchSide(args.left), fetchSide(args.right)]);
    return execute_impl(left, right);
}

module.exports = { execute };
