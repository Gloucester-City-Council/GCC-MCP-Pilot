/**
 * Shared graph-building helpers for the cross-resource relationship tools
 * (tools/relationships/*.js). No new Azure calls beyond what each
 * family's own inspect tools already make — this only combines results
 * already fetched into a dependency graph.
 *
 * Function App -> Cosmos DB linkage needs a raw app-setting VALUE scan
 * (which family the account belongs to), something function-apps/inspect
 * deliberately never returns (secret hygiene). This module makes that one
 * narrowly-scoped, un-exported lookup itself, exactly like
 * resource-groups/inventory.js's own orphaned-resource detection — the
 * account name is extracted, the raw setting value is never returned.
 */

'use strict';

const { getResourceClient, getWebSiteClient } = require('./clients');

const COSMOS_ENDPOINT_PATTERN = /https:\/\/([^.]+)\.documents\.azure\.com/i;

async function listResources(instance, resourceGroup) {
    const client = getResourceClient(instance);
    const resources = [];
    for await (const r of client.resources.listByResourceGroup(resourceGroup)) {
        resources.push(r);
    }
    return resources;
}

async function findCosmosAccountReference(instance, resourceGroup, functionAppName) {
    const webSiteClient = getWebSiteClient(instance);
    let settings;
    try {
        settings = await webSiteClient.webApps.listApplicationSettings(resourceGroup, functionAppName);
    } catch (_err) {
        return null;
    }

    for (const value of Object.values((settings && settings.properties) || {})) {
        if (typeof value !== 'string') continue;
        const match = value.match(COSMOS_ENDPOINT_PATTERN);
        if (match) return match[1];
    }
    return null;
}

/**
 * Builds the outbound dependency edges for a single Function App:
 * -> Storage Account, -> Application Insights (linkage flag only, target
 * unresolved by ARM), -> Managed Identity (self), -> Cosmos DB (best
 * effort, app-setting endpoint pattern).
 */
async function buildFunctionAppEdges(instance, resourceGroup, functionAppName) {
    const { execute: inspectFunctionApp } = require('../tools/function-apps/inspect');
    const inspected = await inspectFunctionApp({ instance: instance.name || instance, resourceGroup, name: functionAppName });

    const cosmosAccountName = await findCosmosAccountReference(instance, resourceGroup, functionAppName);

    const edges = [];
    if (inspected.storageDependency.configured) {
        edges.push({ from: functionAppName, to: inspected.storageDependency.accountName, kind: 'Microsoft.Storage/storageAccounts', relationship: 'AzureWebJobsStorage' });
    }
    if (inspected.applicationInsights.linked) {
        edges.push({ from: functionAppName, to: null, kind: 'Microsoft.Insights/components', relationship: 'APPLICATIONINSIGHTS_CONNECTION_STRING (target not resolvable via ARM)' });
    }
    if (inspected.managedIdentity.type && inspected.managedIdentity.type !== 'None') {
        edges.push({ from: functionAppName, to: functionAppName, kind: 'ManagedIdentity', relationship: inspected.managedIdentity.type });
    }
    if (cosmosAccountName) {
        edges.push({ from: functionAppName, to: cosmosAccountName, kind: 'Microsoft.DocumentDB/databaseAccounts', relationship: 'app-setting endpoint reference' });
    }

    return { inspected, edges };
}

/** Builds the whole resource-group dependency graph: every Function App's edges, plus Static Web App -> Function App backend links. */
async function buildResourceGroupTopology(instance, resourceGroup) {
    const { execute: inspectStaticWebApp } = require('../tools/static-web-apps/inspect');

    const resources = await listResources(instance, resourceGroup);
    const functionApps = resources.filter((r) => r.type === 'Microsoft.Web/sites' && (r.kind || '').includes('functionapp'));
    const staticWebApps = resources.filter((r) => r.type === 'Microsoft.Web/staticSites');

    const nodes = resources.map((r) => ({ name: r.name, type: r.type, location: r.location }));
    const edges = [];

    for (const app of functionApps) {
        const { edges: appEdges } = await buildFunctionAppEdges(instance, resourceGroup, app.name);
        edges.push(...appEdges);
    }

    for (const swa of staticWebApps) {
        let inspected;
        try {
            inspected = await inspectStaticWebApp({ instance: instance.name || instance, resourceGroup, name: swa.name });
        } catch (_err) {
            continue;
        }
        for (const backend of inspected.linkedBackends || []) {
            edges.push({
                from: swa.name,
                to: backend.name || backend.backendResourceId || null,
                kind: 'Microsoft.Web/sites',
                relationship: 'staticWebApp.backend',
            });
        }
    }

    return { resourceGroup, nodes, edges };
}

module.exports = { buildFunctionAppEdges, buildResourceGroupTopology, listResources };
