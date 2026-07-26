/**
 * Shared helpers for the Static Web Apps family.
 *
 * SECURITY: this family must never fetch or return a deployment token or
 * any repository/deployment secret. In particular, `staticSites.
 * listStaticSiteSecrets` must never be called anywhere below this
 * directory. Application-setting VALUES are treated the same way — only
 * setting NAMES are ever surfaced, classified as "secret-like" or "plain"
 * by name pattern so a caller can tell which settings likely hold
 * sensitive values without ever seeing them.
 */

'use strict';

const { AzureEstateError, ERROR_CODES } = require('../../lib/errors');

const SECRET_NAME_PATTERN = /(key|secret|password|token|connection[-_]?string|conn[-_]?str|sastoken|credential|apikey)/i;

/** Turn a StringDictionary-shaped ARM result into setting NAMES only — values are discarded immediately. */
function namesOnly(stringDictionaryResult) {
    const properties = (stringDictionaryResult && stringDictionaryResult.properties) || {};
    return Object.keys(properties);
}

/** Classify setting names as secret-like vs plain, by name pattern only — never by value. */
function classifySettingNames(names) {
    const secretLike = names.filter((n) => SECRET_NAME_PATTERN.test(n));
    const plain = names.filter((n) => !SECRET_NAME_PATTERN.test(n));
    return { secretLike, plain };
}

/** Map a StaticSiteARMResource to the safe, explicit subset of fields this MCP ever returns. */
function toSiteSummary(site, resourceGroup) {
    return {
        name: site.name,
        resourceGroup,
        location: site.location,
        sku: site.sku ? { name: site.sku.name, tier: site.sku.tier } : null,
        defaultHostname: site.defaultHostname || null,
        repositoryUrl: site.repositoryUrl || null,
        branch: site.branch || null,
        tags: site.tags || {},
    };
}

function toCustomDomainSummary(domain) {
    return {
        domainName: domain.domainName || domain.name,
        status: domain.status || null,
        createdOn: domain.createdOn || null,
        errorMessage: domain.errorMessage || null,
    };
}

function toEnvironmentSummary(build) {
    return {
        name: build.name || build.buildId,
        status: build.status || null,
        sourceBranch: build.sourceBranch || null,
        hostname: build.hostname || null,
        pullRequestTitle: build.pullRequestTitle || null,
        createdTimeUtc: build.createdTimeUtc || null,
        lastUpdatedOn: build.lastUpdatedOn || null,
    };
}

function toLinkedBackendSummary(backend) {
    return {
        name: backend.name || null,
        backendResourceId: backend.backendResourceId || null,
        region: backend.region || null,
        provisioningState: backend.provisioningState || null,
        createdOn: backend.createdOn || null,
    };
}

function functionAppResourceId(subscriptionId, resourceGroup, functionAppName) {
    return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${functionAppName}`;
}

async function collectAsyncIterable(iterable) {
    const items = [];
    for await (const item of iterable) items.push(item);
    return items;
}

async function getStaticSiteOrNotFound(client, resourceGroup, name, instanceName) {
    try {
        return await client.staticSites.getStaticSite(resourceGroup, name);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(
                ERROR_CODES.NOT_FOUND,
                `Static Web App "${name}" not found in resource group "${resourceGroup}" (instance "${instanceName}")`
            );
        }
        throw err;
    }
}

/** Await either an LRO poller (pollUntilDone) or a plain promise/value, transparently. */
async function awaitResult(pollerOrValue) {
    const resolved = await pollerOrValue;
    if (resolved && typeof resolved.pollUntilDone === 'function') {
        return resolved.pollUntilDone();
    }
    return resolved;
}

module.exports = {
    SECRET_NAME_PATTERN,
    namesOnly,
    classifySettingNames,
    toSiteSummary,
    toCustomDomainSummary,
    toEnvironmentSummary,
    toLinkedBackendSummary,
    functionAppResourceId,
    collectAsyncIterable,
    getStaticSiteOrNotFound,
    awaitResult,
};
