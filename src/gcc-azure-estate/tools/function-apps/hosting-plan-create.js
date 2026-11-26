/**
 * Tool: azure_hosting_plan_create
 *
 * Creates a hosting plan for Function Apps: classic Consumption (Y1, Linux
 * or Windows) or Flex Consumption (FC1, Linux only). Fails with CONFLICT if a plan of that name
 * already exists in the resource group. No delete tool exists.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

const SKUS = {
    Y1: { name: 'Y1', tier: 'Dynamic' },
    FC1: { name: 'FC1', tier: 'FlexConsumption' },
};

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'location', 'sku']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const sku = SKUS[args.sku];
    if (!sku) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `sku must be one of ${Object.keys(SKUS).join(', ')} (got "${args.sku}")`, { validSkus: Object.keys(SKUS) });
    }

    const osType = args.osType || 'Linux';
    if (osType !== 'Linux' && osType !== 'Windows') {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `osType must be Linux or Windows (got "${args.osType}")`);
    }
    if (args.sku === 'FC1' && osType === 'Windows') {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'Flex Consumption (FC1) supports Linux only');
    }

    const instance = assertPermitted(args.instance, 'function-apps', 'create');
    const client = getWebSiteClient(instance);

    let existing = null;
    try {
        existing = await client.appServicePlans.get(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    if (existing) {
        throw new AzureEstateError(
            ERROR_CODES.CONFLICT,
            `Hosting plan "${args.name}" already exists in resource group "${args.resourceGroup}" (instance "${instance.name}")`,
            { existingSku: existing.sku && existing.sku.name }
        );
    }

    const poller = await client.appServicePlans.createOrUpdate(args.resourceGroup, args.name, {
        location: args.location,
        kind: 'functionapp',
        reserved: osType === 'Linux',
        sku,
        tags: args.tags || {},
    });
    const plan = poller && typeof poller.pollUntilDone === 'function' ? await poller.pollUntilDone() : poller;

    return {
        created: true,
        name: plan.name || args.name,
        resourceGroup: args.resourceGroup,
        location: plan.location || args.location,
        sku: (plan.sku && plan.sku.name) || sku.name,
        tier: (plan.sku && plan.sku.tier) || sku.tier,
        osType,
    };
}

module.exports = { execute };
