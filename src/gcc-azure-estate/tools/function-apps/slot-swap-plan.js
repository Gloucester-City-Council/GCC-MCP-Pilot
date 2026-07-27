/**
 * Tool: azure_function_slot_swap_plan
 *
 * Describes what a slot swap would do without performing it. `sourceSlot`
 * is the slot being promoted; `targetSlot` defaults to "production". Swaps
 * into production use the Azure swapSlotWithProduction operation; swaps
 * between two named slots use swapSlot.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function getSlotOrProduction(client, resourceGroup, name, slot, instanceName) {
    try {
        if (!slot || slot === 'production') {
            return await client.webApps.get(resourceGroup, name);
        }
        return await client.webApps.getSlot(resourceGroup, name, slot);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Slot "${slot || 'production'}" not found on Function App "${name}" in resource group "${resourceGroup}" (instance "${instanceName}")`);
        }
        throw err;
    }
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'sourceSlot']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'plan');
    const client = getWebSiteClient(instance);
    const targetSlot = args.targetSlot || 'production';
    const preserveVnet = args.preserveVnet !== false;

    const source = await getSlotOrProduction(client, args.resourceGroup, args.name, args.sourceSlot, instance.name);
    const target = await getSlotOrProduction(client, args.resourceGroup, args.name, targetSlot, instance.name);

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        sourceSlot: args.sourceSlot,
        targetSlot,
        operation: targetSlot === 'production' ? 'swapSlotWithProduction' : 'swapSlot',
        preserveVnet,
        current: {
            source: { slot: args.sourceSlot, hostNames: source.hostNames || [], state: source.state || null },
            target: { slot: targetSlot, hostNames: target.hostNames || [], state: target.state || null },
        },
        description: `After this swap, the app currently running in "${args.sourceSlot}" will be serving traffic at "${targetSlot}", and vice versa.`,
        requiredPermission: { resourceFamily: 'function-apps', operationClass: 'deploy' },
    };
}

module.exports = { execute };
