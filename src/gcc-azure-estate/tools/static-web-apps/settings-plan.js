/**
 * Tool: azure_static_web_app_settings_plan
 *
 * Computes an add/change/unchanged diff for a proposed application
 * settings update without applying it. Mirrors
 * azure_resource_group_tags_plan's shape, with one deliberate difference:
 * the "current" side of the diff is NAMES ONLY. Existing setting values
 * are read internally (required to tell add vs change vs unchanged
 * apart) but are never placed anywhere in the returned result — only the
 * caller's own requested values (which they already know) ever appear.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { namesOnly, getStaticSiteOrNotFound } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'settings']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'static-web-apps', 'plan');
    const client = getWebSiteClient(instance);

    await getStaticSiteOrNotFound(client, args.resourceGroup, args.name, instance.name);

    // Fetched internally only to classify add/change/unchanged — the values
    // themselves never leave this function.
    const currentResult = await client.staticSites.listStaticSiteAppSettings(args.resourceGroup, args.name);
    const currentValues = (currentResult && currentResult.properties) || {};
    const currentNames = namesOnly(currentResult);

    const requested = args.settings;
    const toAdd = {};
    const toChange = {};
    const unchanged = [];

    for (const [key, value] of Object.entries(requested)) {
        if (!(key in currentValues)) {
            toAdd[key] = value;
        } else if (currentValues[key] !== value) {
            toChange[key] = { to: value };
        } else {
            unchanged.push(key);
        }
    }

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        currentSettingNames: currentNames,
        plan: { toAdd, toChange, unchanged },
        requiredPermission: { resourceFamily: 'static-web-apps', operationClass: 'modify' },
        willChange: Object.keys(toAdd).length > 0 || Object.keys(toChange).length > 0,
    };
}

module.exports = { execute };
