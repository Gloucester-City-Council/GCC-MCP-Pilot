/**
 * Tool: azure_function_app_settings_apply
 *
 * Applies an app-settings update computed by azure_function_app_settings_plan.
 * Merges (does not replace) — existing settings not mentioned in
 * `appSettings` are left untouched. The response only ever lists setting
 * NAMES, never values.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'appSettings']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'modify');
    const client = getWebSiteClient(instance);

    let current;
    try {
        current = await client.webApps.listApplicationSettings(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Function App "${args.name}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const merged = { ...(current.properties || {}), ...args.appSettings };
    await client.webApps.updateApplicationSettings(args.resourceGroup, args.name, { properties: merged });

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        appSettingNames: Object.keys(merged),
        updatedNames: Object.keys(args.appSettings),
    };
}

module.exports = { execute };
