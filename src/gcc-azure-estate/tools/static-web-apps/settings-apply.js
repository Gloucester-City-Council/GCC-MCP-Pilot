/**
 * Tool: azure_static_web_app_settings_apply
 *
 * Applies an application-settings update computed by
 * azure_static_web_app_settings_plan. createOrUpdateStaticSiteAppSettings
 * replaces the whole dictionary, so existing settings are read internally
 * and merged with the requested ones first — existing values are used
 * only to build the write payload and are never included in the
 * returned result, which reports setting NAMES plus the (caller-supplied)
 * values that were added or changed.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { namesOnly, getStaticSiteOrNotFound } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'settings']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'static-web-apps', 'modify');
    const client = getWebSiteClient(instance);

    await getStaticSiteOrNotFound(client, args.resourceGroup, args.name, instance.name);

    const currentResult = await client.staticSites.listStaticSiteAppSettings(args.resourceGroup, args.name);
    const currentValues = (currentResult && currentResult.properties) || {};

    const added = [];
    const changed = [];
    for (const [key, value] of Object.entries(args.settings)) {
        if (!(key in currentValues)) added.push(key);
        else if (currentValues[key] !== value) changed.push(key);
    }

    const merged = { ...currentValues, ...args.settings };
    const updated = await client.staticSites.createOrUpdateStaticSiteAppSettings(args.resourceGroup, args.name, merged);

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        added,
        changed,
        requestedValues: args.settings,
        settingNames: namesOnly(updated),
    };
}

module.exports = { execute };
