/**
 * Tool: azure_function_slot_swap
 *
 * Performs a deployment slot swap computed by azure_function_slot_swap_plan.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'sourceSlot']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'deploy');
    const client = getWebSiteClient(instance);
    const targetSlot = args.targetSlot || 'production';
    const preserveVnet = args.preserveVnet !== false;

    try {
        await client.webApps.getSlot(args.resourceGroup, args.name, args.sourceSlot);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Slot "${args.sourceSlot}" not found on Function App "${args.name}" in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const slotSwapEntity = { targetSlot: targetSlot === 'production' ? args.sourceSlot : targetSlot, preserveVnet };

    let poller;
    if (targetSlot === 'production') {
        poller = await client.webApps.swapSlotWithProduction(args.resourceGroup, args.name, slotSwapEntity);
    } else {
        poller = await client.webApps.swapSlot(args.resourceGroup, args.name, args.sourceSlot, slotSwapEntity);
    }
    await poller.pollUntilDone();

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        sourceSlot: args.sourceSlot,
        targetSlot,
        swapped: true,
    };
}

module.exports = { execute };
