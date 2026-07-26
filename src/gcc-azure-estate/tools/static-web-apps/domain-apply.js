/**
 * Tool: azure_static_web_app_domain_apply
 *
 * Applies a custom domain binding computed by
 * azure_static_web_app_domain_plan.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { toCustomDomainSummary, getStaticSiteOrNotFound, awaitResult } = require('./_shared');

function inferValidationMethod(domainName) {
    const labelCount = domainName.split('.').filter(Boolean).length;
    return labelCount <= 2 ? 'dns-txt-token' : 'cname-delegation';
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'domainName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'static-web-apps', 'network');
    const client = getWebSiteClient(instance);

    await getStaticSiteOrNotFound(client, args.resourceGroup, args.name, instance.name);

    const validationMethod = args.validationMethod || inferValidationMethod(args.domainName);
    const envelope = { validationMethod };

    const result = await awaitResult(
        client.staticSites.createOrUpdateStaticSiteCustomDomain(args.resourceGroup, args.name, args.domainName, envelope)
    );

    return { name: args.name, resourceGroup: args.resourceGroup, ...toCustomDomainSummary(result) };
}

module.exports = { execute };
