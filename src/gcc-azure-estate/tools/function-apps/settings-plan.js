/**
 * Tool: azure_function_app_settings_plan
 *
 * Mirrors resource-groups' tags-plan pattern for app settings: computes
 * add/change/unchanged without applying it. Merge semantics — settings not
 * mentioned in `appSettings` are left untouched. Secret-like setting
 * values (name-classified) are never shown, even the caller's own
 * requested value, to keep the plan output safe to log/display.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { classifySettingName } = require('./shared');

const REDACTED = '<redacted:secret-like>';

function displayValue(key, value) {
    return classifySettingName(key) === 'secret-like' ? REDACTED : value;
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'appSettings']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'plan');
    const client = getWebSiteClient(instance);

    try {
        await client.webApps.get(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Function App "${args.name}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const current = (await client.webApps.listApplicationSettings(args.resourceGroup, args.name)).properties || {};
    const requested = args.appSettings;

    const toAdd = {};
    const toChange = {};
    const unchanged = {};

    for (const [key, value] of Object.entries(requested)) {
        if (!(key in current)) {
            toAdd[key] = displayValue(key, value);
        } else if (current[key] !== value) {
            toChange[key] = { from: displayValue(key, current[key]), to: displayValue(key, value) };
        } else {
            unchanged[key] = displayValue(key, value);
        }
    }

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        currentAppSettingNames: Object.keys(current),
        plan: { toAdd, toChange, unchanged },
        requiredPermission: { resourceFamily: 'function-apps', operationClass: 'modify' },
        willChange: Object.keys(toAdd).length > 0 || Object.keys(toChange).length > 0,
    };
}

module.exports = { execute };
