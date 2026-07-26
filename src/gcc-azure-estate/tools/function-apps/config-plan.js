/**
 * Tool: azure_function_app_config_plan
 *
 * Computes what a site-config change (minTlsVersion, httpsOnly,
 * corsAllowedOrigins, healthCheckPath, alwaysOn) would do, without
 * applying it. httpsOnly lives on the Site resource itself; the rest live
 * on the SiteConfig sub-resource — both are read here so the diff is
 * accurate regardless of which fields are requested.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');

const CONFIGURABLE_FIELDS = ['minTlsVersion', 'httpsOnly', 'corsAllowedOrigins', 'healthCheckPath', 'alwaysOn'];

function currentValue(field, site, siteConfig) {
    switch (field) {
        case 'httpsOnly': return !!site.httpsOnly;
        case 'minTlsVersion': return siteConfig.minTlsVersion || null;
        case 'corsAllowedOrigins': return (siteConfig.cors && siteConfig.cors.allowedOrigins) || [];
        case 'healthCheckPath': return siteConfig.healthCheckPath || null;
        case 'alwaysOn': return !!siteConfig.alwaysOn;
        default: return undefined;
    }
}

function valuesEqual(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
    return a === b;
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'config']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'function-apps', 'plan');
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
    const siteConfig = await client.webApps.getConfiguration(args.resourceGroup, args.name);

    const requestedFields = Object.keys(args.config).filter((f) => CONFIGURABLE_FIELDS.includes(f));
    const unknownFields = Object.keys(args.config).filter((f) => !CONFIGURABLE_FIELDS.includes(f));

    const toChange = {};
    const unchanged = {};

    for (const field of requestedFields) {
        const from = currentValue(field, site, siteConfig);
        const to = args.config[field];
        if (valuesEqual(from, to)) {
            unchanged[field] = to;
        } else {
            toChange[field] = { from, to };
        }
    }

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        plan: { toChange, unchanged },
        unknownFields,
        requiredPermission: { resourceFamily: 'function-apps', operationClass: 'modify' },
        willChange: Object.keys(toChange).length > 0,
    };
}

module.exports = { execute, CONFIGURABLE_FIELDS };
