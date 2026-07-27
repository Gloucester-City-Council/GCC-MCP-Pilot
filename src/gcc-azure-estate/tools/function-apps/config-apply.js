/**
 * Tool: azure_function_app_config_apply
 *
 * Applies a site-config change computed by azure_function_app_config_plan.
 * httpsOnly is a top-level Site property (PATCH via webApps.update);
 * minTlsVersion/corsAllowedOrigins/healthCheckPath/alwaysOn live on the
 * SiteConfig sub-resource (webApps.updateConfiguration) — both are called
 * only when a field targeting them was actually requested.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { CONFIGURABLE_FIELDS } = require('./config-plan');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'config']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'modify');
    const client = getWebSiteClient(instance);

    try {
        await client.webApps.get(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Function App "${args.name}" not found in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
        }
        throw err;
    }

    const config = args.config;
    const applied = [];

    if (Object.prototype.hasOwnProperty.call(config, 'httpsOnly')) {
        await client.webApps.update(args.resourceGroup, args.name, { httpsOnly: config.httpsOnly });
        applied.push('httpsOnly');
    }

    const siteConfigFields = ['minTlsVersion', 'corsAllowedOrigins', 'healthCheckPath', 'alwaysOn'].filter(
        (f) => Object.prototype.hasOwnProperty.call(config, f)
    );

    if (siteConfigFields.length > 0) {
        const current = await client.webApps.getConfiguration(args.resourceGroup, args.name);
        const merged = { ...current };
        if (config.minTlsVersion !== undefined) { merged.minTlsVersion = config.minTlsVersion; applied.push('minTlsVersion'); }
        if (config.corsAllowedOrigins !== undefined) {
            merged.cors = { ...(current.cors || {}), allowedOrigins: config.corsAllowedOrigins };
            applied.push('corsAllowedOrigins');
        }
        if (config.healthCheckPath !== undefined) { merged.healthCheckPath = config.healthCheckPath; applied.push('healthCheckPath'); }
        if (config.alwaysOn !== undefined) { merged.alwaysOn = config.alwaysOn; applied.push('alwaysOn'); }

        await client.webApps.updateConfiguration(args.resourceGroup, args.name, merged);
    }

    return {
        name: args.name, resourceGroup: args.resourceGroup, appliedFields: applied,
    };
}

module.exports = { execute, CONFIGURABLE_FIELDS };
