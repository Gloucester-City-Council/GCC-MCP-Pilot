/**
 * Tool: azure_function_slot_create
 *
 * Creates a deployment slot, cloning the parent app's location/kind and
 * runtime-relevant siteConfig so the new slot starts on a matching stack.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'slotName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'deploy');
    const client = getWebSiteClient(instance);

    let site;
    try {
        site = await client.webApps.get(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Function App "${args.name}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    let existingSlot = null;
    try {
        existingSlot = await client.webApps.getSlot(args.resourceGroup, args.name, args.slotName);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    if (existingSlot) {
        throw new AzureEstateError(ERROR_CODES.CONFLICT, `Slot "${args.slotName}" already exists on Function App "${args.name}"`);
    }

    const parentConfig = await client.webApps.getConfiguration(args.resourceGroup, args.name);

    const slotEnvelope = {
        location: site.location,
        kind: site.kind,
        reserved: site.reserved,
        serverFarmId: site.serverFarmId,
        siteConfig: {
            linuxFxVersion: parentConfig.linuxFxVersion,
            windowsFxVersion: parentConfig.windowsFxVersion,
            nodeVersion: parentConfig.nodeVersion,
            netFrameworkVersion: parentConfig.netFrameworkVersion,
        },
    };

    const poller = await client.webApps.createOrUpdateSlot(args.resourceGroup, args.name, args.slotName, slotEnvelope);
    const created = await poller.pollUntilDone();

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        slotName: args.slotName,
        created: true,
        hostNames: created.hostNames || [],
        state: created.state || null,
    };
}

module.exports = { execute };
