/**
 * Tool: azure_static_web_app_domain_plan
 *
 * Validates a proposed custom domain against the Static Web App's current
 * domains and returns a dependency-explicit plan (no write API called).
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { toCustomDomainSummary, collectAsyncIterable, getStaticSiteOrNotFound } = require('./_shared');

/** Apex domains (single label + TLD, e.g. "example.com") need a TXT record; subdomains use CNAME delegation. */
function inferValidationMethod(domainName) {
    const labelCount = domainName.split('.').filter(Boolean).length;
    return labelCount <= 2 ? 'dns-txt-token' : 'cname-delegation';
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'domainName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'static-web-apps', 'plan');
    const client = getWebSiteClient(instance);

    await getStaticSiteOrNotFound(client, args.resourceGroup, args.name, instance.name);

    const existingDomains = await collectAsyncIterable(client.staticSites.listStaticSiteCustomDomains(args.resourceGroup, args.name));
    const conflict = existingDomains.find((d) => (d.domainName || d.name) === args.domainName);

    const validationMethod = inferValidationMethod(args.domainName);

    const steps = [
        {
            step: 1,
            action: 'Confirm domain is not already attached',
            status: conflict ? 'blocked' : 'satisfied',
            note: conflict ? `"${args.domainName}" is already attached with status ${conflict.status}.` : undefined,
        },
        {
            step: 2,
            action: 'Create the custom domain binding',
            tool: 'azure_static_web_app_domain_apply',
            dependsOn: [1],
            validationMethod,
            note: validationMethod === 'dns-txt-token'
                ? 'Apex domain — Azure will issue a TXT validation token after the binding is created; add it at your DNS provider, then the domain moves to Ready once validated.'
                : 'Subdomain — point a CNAME record at the Static Web App\'s default hostname before or shortly after creating the binding.',
        },
    ];

    return {
        name: args.name,
        resourceGroup: args.resourceGroup,
        domainName: args.domainName,
        canApply: !conflict,
        existingCustomDomains: existingDomains.map(toCustomDomainSummary),
        validationMethod,
        steps,
        requiredPermission: { resourceFamily: 'static-web-apps', operationClass: 'network' },
    };
}

module.exports = { execute };
