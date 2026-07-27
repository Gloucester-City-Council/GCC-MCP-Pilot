/**
 * Lazy, cached ARM + data-plane client factory.
 *
 * Clients are cached per (clientKind, subscriptionId) so warm Function
 * invocations reuse connections — the same rationale as the module-scope
 * blob client singleton in src/functions/mcpNotes.js.
 */

'use strict';

const { getCredential } = require('./credential');

const _cache = new Map();

function cached(key, factory) {
    if (!_cache.has(key)) {
        _cache.set(key, factory());
    }
    return _cache.get(key);
}

function getSubscriptionClient() {
    const { SubscriptionClient } = require('@azure/arm-subscriptions');
    return cached('subscriptions', () => new SubscriptionClient(getCredential()));
}

function getResourceClient(instance) {
    const { ResourceManagementClient } = require('@azure/arm-resources');
    return cached(`resources:${instance.subscriptionId}`, () =>
        new ResourceManagementClient(getCredential(), instance.subscriptionId));
}

function getWebSiteClient(instance) {
    const { WebSiteManagementClient } = require('@azure/arm-appservice');
    return cached(`websites:${instance.subscriptionId}`, () =>
        new WebSiteManagementClient(getCredential(), instance.subscriptionId));
}

function getStorageMgmtClient(instance) {
    const { StorageManagementClient } = require('@azure/arm-storage');
    return cached(`storage:${instance.subscriptionId}`, () =>
        new StorageManagementClient(getCredential(), instance.subscriptionId));
}

function getCosmosClient(instance) {
    const { CosmosDBManagementClient } = require('@azure/arm-cosmosdb');
    return cached(`cosmos:${instance.subscriptionId}`, () =>
        new CosmosDBManagementClient(getCredential(), instance.subscriptionId));
}

function getAppInsightsClient(instance) {
    const { ApplicationInsightsManagementClient } = require('@azure/arm-appinsights');
    return cached(`appinsights:${instance.subscriptionId}`, () =>
        new ApplicationInsightsManagementClient(getCredential(), instance.subscriptionId));
}

function getMonitorClient(instance) {
    const { MonitorClient } = require('@azure/arm-monitor');
    return cached(`monitor:${instance.subscriptionId}`, () =>
        new MonitorClient(getCredential(), instance.subscriptionId));
}

/**
 * Data-plane blob client for container/metadata operations only — never
 * blob content (out of scope for this MCP; see lib/response.js redaction
 * and the blob-containers tool family for the enforced boundary).
 */
function getBlobServiceClient(accountName) {
    const { BlobServiceClient } = require('@azure/storage-blob');
    return cached(`blob:${accountName}`, () =>
        new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, getCredential()));
}

/** Reset cached clients — test-only helper. */
function _resetForTests() {
    _cache.clear();
}

module.exports = {
    getSubscriptionClient,
    getResourceClient,
    getWebSiteClient,
    getStorageMgmtClient,
    getCosmosClient,
    getAppInsightsClient,
    getMonitorClient,
    getBlobServiceClient,
    _resetForTests,
};
