/**
 * Shared helpers for the Cosmos DB family (accounts / databases / containers).
 *
 * Cosmos DB's control-plane ARM surface (@azure/arm-cosmosdb ^17) exposes
 * "API type" as a combination of `kind` (GlobalDocumentDB | MongoDB | Parse)
 * plus a `capabilities[]` array for API surfaces layered on top of the SQL
 * engine (Cassandra, Gremlin, Table). There is no single "apiType" field on
 * the wire — these helpers translate between the ARM shape and a single
 * human-facing `apiType` string so every tool in the family agrees on one
 * vocabulary: 'Sql' | 'MongoDB' | 'Cassandra' | 'Gremlin' | 'Table'.
 */

'use strict';

const API_TYPE_CAPABILITY = {
    Sql: null,
    MongoDB: null, // distinguished by kind, not a capability
    Cassandra: 'EnableCassandra',
    Gremlin: 'EnableGremlin',
    Table: 'EnableTable',
};

const VALID_API_TYPES = Object.keys(API_TYPE_CAPABILITY);

/** Maps a requested apiType to the ARM `kind` + `capabilities[]` needed at account-create time. */
function kindAndCapabilitiesFromApiType(apiType, extraCapabilities = []) {
    if (!VALID_API_TYPES.includes(apiType)) {
        return null;
    }
    const kind = apiType === 'MongoDB' ? 'MongoDB' : 'GlobalDocumentDB';
    const capabilityName = API_TYPE_CAPABILITY[apiType];
    const capabilities = [
        ...(capabilityName ? [{ name: capabilityName }] : []),
        ...extraCapabilities.map((name) => ({ name })),
    ];
    return { kind, capabilities };
}

/** Reverses kindAndCapabilitiesFromApiType — derives the human-facing apiType from an existing account. */
function apiTypeFromAccount(account) {
    const kind = account.kind || 'GlobalDocumentDB';
    const capabilityNames = (account.capabilities || []).map((c) => c.name);
    if (kind === 'MongoDB') return 'MongoDB';
    if (capabilityNames.includes('EnableCassandra')) return 'Cassandra';
    if (capabilityNames.includes('EnableGremlin')) return 'Gremlin';
    if (capabilityNames.includes('EnableTable')) return 'Table';
    return 'Sql';
}

function isServerless(account) {
    return (account.capabilities || []).some((c) => c.name === 'EnableServerless');
}

/** Summarises the backup policy union (Periodic | Continuous) into a flat, tool-friendly shape. */
function summarizeBackupPolicy(backupPolicy) {
    if (!backupPolicy) {
        return { type: null, note: 'No backup policy reported by the SDK.' };
    }
    if (backupPolicy.type === 'Continuous') {
        return {
            type: 'Continuous',
            continuousTier: (backupPolicy.continuousModeProperties || {}).tier || null,
        };
    }
    if (backupPolicy.type === 'Periodic') {
        const props = backupPolicy.periodicModeProperties || {};
        return {
            type: 'Periodic',
            backupIntervalInMinutes: props.backupIntervalInMinutes ?? null,
            backupRetentionIntervalInHours: props.backupRetentionIntervalInHours ?? null,
            backupStorageRedundancy: props.backupStorageRedundancy || null,
        };
    }
    return { type: backupPolicy.type || null };
}

/** Summarises the regions/locations array with failover priority — the "regions" view every account tool shares. */
function summarizeRegions(locations = []) {
    return locations
        .slice()
        .sort((a, b) => (a.failoverPriority ?? 0) - (b.failoverPriority ?? 0))
        .map((l) => ({
            locationName: l.locationName,
            failoverPriority: l.failoverPriority ?? null,
            isZoneRedundant: !!l.isZoneRedundant,
        }));
}

/** True when err looks like an ARM 404 (RestError with statusCode, or the classic .code shape). */
function isNotFoundError(err) {
    return err && (err.statusCode === 404 || err.code === 'NotFound');
}

/**
 * Compares two partition key definitions for equality. Order of `paths`
 * matters (Cosmos partition key paths are ordered), kind and version must
 * match exactly. Used to enforce partition-key immutability on container
 * create.
 */
function partitionKeysEqual(a, b) {
    if (!a || !b) return false;
    const aPaths = a.paths || [];
    const bPaths = b.paths || [];
    if (aPaths.length !== bPaths.length) return false;
    for (let i = 0; i < aPaths.length; i += 1) {
        if (aPaths[i] !== bPaths[i]) return false;
    }
    const aKind = a.kind || 'Hash';
    const bKind = b.kind || 'Hash';
    if (aKind !== bKind) return false;
    const aVersion = a.version ?? 1;
    const bVersion = b.version ?? 1;
    return aVersion === bVersion;
}

const RESOURCE_GROUP_FROM_ID = /\/resourceGroups\/([^/]+)\//i;

/** Extracts the resource group name out of an ARM resource id. Returns null if not found. */
function resourceGroupFromId(id) {
    const match = RESOURCE_GROUP_FROM_ID.exec(id || '');
    return match ? match[1] : null;
}

/**
 * Builds the ARM DatabaseAccountCreateUpdateParameters body from the
 * MCP-facing create-account contract. Every field the design spec calls
 * "never defaulted silently" (apiType, consistencyPolicy, regions,
 * capacityMode) must already be present on `args` — this function does not
 * invent values, it only translates the ones it's given.
 */
function buildAccountCreateBody(args) {
    const kindAndCaps = kindAndCapabilitiesFromApiType(args.apiType, args.extraCapabilities || []);
    if (!kindAndCaps) {
        return { error: `Invalid apiType "${args.apiType}". Must be one of: ${VALID_API_TYPES.join(', ')}` };
    }

    if (!Array.isArray(args.regions) || args.regions.length === 0) {
        return { error: 'regions must be a non-empty array of { locationName, failoverPriority }' };
    }

    if (args.capacityMode !== 'Serverless' && args.capacityMode !== 'Provisioned') {
        return { error: 'capacityMode must be "Serverless" or "Provisioned"' };
    }

    const capabilities = [...kindAndCaps.capabilities];
    if (args.capacityMode === 'Serverless') {
        capabilities.push({ name: 'EnableServerless' });
    }

    const warnings = [];
    if (args.capacityMode === 'Serverless' && args.regions.length > 1) {
        warnings.push('Serverless accounts do not support multiple write regions in most Azure Cosmos DB configurations — verify this combination is supported before applying.');
    }

    const body = {
        location: args.location,
        kind: kindAndCaps.kind,
        capabilities,
        consistencyPolicy: args.consistencyPolicy,
        locations: args.regions.map((r) => ({
            locationName: r.locationName,
            failoverPriority: r.failoverPriority,
            isZoneRedundant: !!r.isZoneRedundant,
        })),
        databaseAccountOfferType: 'Standard',
    };

    if (args.automaticFailoverEnabled !== undefined) body.enableAutomaticFailover = !!args.automaticFailoverEnabled;
    if (args.multipleWriteRegionsEnabled !== undefined) body.enableMultipleWriteLocations = !!args.multipleWriteRegionsEnabled;
    if (args.publicNetworkAccess !== undefined) body.publicNetworkAccess = args.publicNetworkAccess;
    if (args.ipRules !== undefined) body.ipRules = args.ipRules.map((ip) => ({ ipAddressOrRange: ip }));
    if (args.disableLocalAuth !== undefined) body.disableLocalAuth = !!args.disableLocalAuth;
    if (args.backupPolicy !== undefined) body.backupPolicy = args.backupPolicy;
    if (args.identity !== undefined) body.identity = args.identity;
    if (args.tags !== undefined) body.tags = args.tags;

    return { body, warnings };
}

const VALID_THROUGHPUT_MODES = ['Autoscale', 'Manual', 'Serverless'];

/**
 * Validates a { mode, throughput?, maxThroughput? } throughput model and
 * translates it into the ARM `resource` shape ({ throughput } or
 * { autoscaleSettings: { maxThroughput } }). Returns { error } if invalid.
 * Serverless mode returns { resource: null } — no throughput is ever sent
 * for a serverless database/container, the capacity mode lives on the
 * parent account instead.
 */
function buildThroughputResource(throughputModel) {
    if (!throughputModel || !VALID_THROUGHPUT_MODES.includes(throughputModel.mode)) {
        return { error: `throughputModel.mode must be one of: ${VALID_THROUGHPUT_MODES.join(', ')}` };
    }

    if (throughputModel.mode === 'Serverless') {
        return { resource: null };
    }

    if (throughputModel.mode === 'Autoscale') {
        if (typeof throughputModel.maxThroughput !== 'number') {
            return { error: 'throughputModel.maxThroughput (number) is required when mode is "Autoscale"' };
        }
        return { resource: { autoscaleSettings: { maxThroughput: throughputModel.maxThroughput } } };
    }

    // Manual
    if (typeof throughputModel.throughput !== 'number') {
        return { error: 'throughputModel.throughput (number) is required when mode is "Manual"' };
    }
    return { resource: { throughput: throughputModel.throughput } };
}

/** Reads a throughput mode + values back off a ThroughputSettingsGetResults-shaped resource. */
function describeThroughputResource(resource) {
    if (!resource) return { mode: null, throughput: null, maxThroughput: null };
    if (resource.autoscaleSettings) {
        return { mode: 'Autoscale', throughput: resource.throughput ?? null, maxThroughput: resource.autoscaleSettings.maxThroughput ?? null };
    }
    return { mode: 'Manual', throughput: resource.throughput ?? null, maxThroughput: null };
}

/** Summarises a container's indexing policy into the fields tools actually reason about. */
function summarizeIndexingPolicy(indexingPolicy) {
    if (!indexingPolicy) {
        return { automatic: null, indexingMode: null, includesAllPaths: null, includedPathCount: 0, excludedPathCount: 0 };
    }
    const includedPaths = indexingPolicy.includedPaths || [];
    const excludedPaths = indexingPolicy.excludedPaths || [];
    const includesAllPaths = includedPaths.some((p) => p.path === '/*') && excludedPaths.length === 0;
    return {
        automatic: indexingPolicy.automatic ?? null,
        indexingMode: indexingPolicy.indexingMode || null,
        includesAllPaths,
        includedPathCount: includedPaths.length,
        excludedPathCount: excludedPaths.length,
        compositeIndexCount: (indexingPolicy.compositeIndexes || []).length,
        spatialIndexCount: (indexingPolicy.spatialIndexes || []).length,
    };
}

module.exports = {
    VALID_API_TYPES,
    VALID_THROUGHPUT_MODES,
    summarizeIndexingPolicy,
    resourceGroupFromId,
    buildAccountCreateBody,
    buildThroughputResource,
    describeThroughputResource,
    kindAndCapabilitiesFromApiType,
    apiTypeFromAccount,
    isServerless,
    summarizeBackupPolicy,
    summarizeRegions,
    isNotFoundError,
    partitionKeysEqual,
};
