/**
 * Tool: azure_resource_group_inventory
 *
 * Treats the resource group as an operational boundary, not merely a
 * filter. Summarises: resources by type, regions, tags, managed
 * identities, public exposure, diagnostic coverage, configuration
 * findings, and resources without expected relationships (orphaned).
 *
 * Deep, resource-type-specific exposure/diagnostic assessment is the job
 * of each family's own *_diagnose tool (azure_function_app_diagnose,
 * azure_storage_account_diagnose, ...) — this tool gives the estate-wide
 * view and points at what to drill into next.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getResourceClient, getWebSiteClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const {
    summarizeByType, summarizeByRegion, summarizeTags, summarizeIdentities, isCrossRegion,
} = require('../../lib/inventory-summary');

const STORAGE_ACCOUNT_NAME_PATTERN = /AccountName=([^;]+)/i;
const COSMOS_ENDPOINT_PATTERN = /https:\/\/([^.]+)\.documents\.azure\.com/i;

async function listAllResources(client, resourceGroup) {
    const resources = [];
    for await (const r of client.resources.listByResourceGroup(resourceGroup)) {
        resources.push(r);
    }
    return resources;
}

/** Best-effort cross-reference: Function App settings -> storage/cosmos accounts they mention. */
async function findReferencedAccountNames(webSiteClient, resourceGroup, functionApps) {
    const referenced = new Set();

    for (const app of functionApps) {
        let settings;
        try {
            settings = await webSiteClient.webApps.listApplicationSettings(resourceGroup, app.name);
        } catch (_err) {
            continue; // best-effort — a settings-read failure shouldn't fail the whole inventory
        }

        for (const value of Object.values(settings.properties || {})) {
            if (typeof value !== 'string') continue;
            const storageMatch = value.match(STORAGE_ACCOUNT_NAME_PATTERN);
            if (storageMatch) referenced.add(storageMatch[1].toLowerCase());
            const cosmosMatch = value.match(COSMOS_ENDPOINT_PATTERN);
            if (cosmosMatch) referenced.add(cosmosMatch[1].toLowerCase());
        }
    }

    return referenced;
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'resource-groups', 'inspect');
    const resourceClient = getResourceClient(instance);
    const webSiteClient = getWebSiteClient(instance);

    let rg;
    try {
        rg = await resourceClient.resourceGroups.get(args.resourceGroup);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Resource group "${args.resourceGroup}" not found in instance "${instance.name}"`);
        }
        throw err;
    }

    const resources = await listAllResources(resourceClient, args.resourceGroup);

    const functionApps = resources.filter((r) => r.type === 'Microsoft.Web/sites' && (r.kind || '').includes('functionapp'));
    const storageAccounts = resources.filter((r) => r.type === 'Microsoft.Storage/storageAccounts');
    const cosmosAccounts = resources.filter((r) => r.type === 'Microsoft.DocumentDB/databaseAccounts');

    const referencedAccountNames = await findReferencedAccountNames(webSiteClient, args.resourceGroup, functionApps);

    const orphanedResources = [
        ...storageAccounts, ...cosmosAccounts,
    ]
        .filter((r) => !referencedAccountNames.has((r.name || '').toLowerCase()))
        .map((r) => ({ name: r.name, type: r.type, reason: 'Not referenced by any Function App setting in this resource group' }));

    const unrecognizedTypes = [...new Set(
        resources
            .map((r) => r.type)
            .filter((type) => !/^Microsoft\.(Resources|Web|Storage|DocumentDB)\//.test(type))
    )];

    return {
        resourceGroup: rg.name,
        location: rg.location,
        tags: rg.tags || {},
        resourceCount: resources.length,
        summary: {
            byType: summarizeByType(resources),
            byRegion: summarizeByRegion(resources),
            tags: summarizeTags(resources),
            managedIdentities: summarizeIdentities(resources),
        },
        crossRegionResources: isCrossRegion(resources, rg.location),
        orphanedResources,
        exposureAndDiagnostics: {
            note: 'High-level view only. For a full exposure/diagnostic-coverage assessment of a specific resource, use its family\'s own *_diagnose tool (e.g. azure_function_app_diagnose, azure_storage_account_diagnose, azure_cosmos_account_diagnose).',
            trackedFamilyResourceCount: functionApps.length + storageAccounts.length + cosmosAccounts.length,
        },
        configurationFindings: unrecognizedTypes.length
            ? [`${unrecognizedTypes.length} resource type(s) in this group are outside the Estate MCP's tracked families: ${unrecognizedTypes.join(', ')}. They are counted in the summary but not individually inspectable by this MCP yet.`]
            : [],
    };
}

module.exports = { execute };
