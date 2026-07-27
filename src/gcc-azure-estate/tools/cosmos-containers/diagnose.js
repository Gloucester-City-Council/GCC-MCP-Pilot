/**
 * Tool: azure_cosmos_container_diagnose
 *
 * Deterministic, deliberately narrow checklist for a Cosmos SQL container:
 *  - no TTL set on a container that looks (by name) like an audit/log
 *    container — informational only, never a hard failure
 *  - an "index everything" policy on a container that looks high-scale by
 *    its provisioned throughput — informational only, not prescriptive
 *    beyond flagging it
 *
 * Deliberately NOT checked: missing unique key policy. Most containers
 * don't need one, so flagging its absence would just be noise.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getCosmosClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { isNotFoundError, summarizeIndexingPolicy, describeThroughputResource } = require('../../lib/cosmos-helpers');

const AUDIT_LOG_NAME_PATTERN = /(audit|log|logs|history|event|events|activity|telemetry)/i;
const HIGH_SCALE_RU_THRESHOLD = 10000;

function checkTtlOnAuditLikeContainer(containerName, defaultTtl) {
    const looksLikeAuditLog = AUDIT_LOG_NAME_PATTERN.test(containerName);
    const hasTtl = defaultTtl !== null && defaultTtl !== undefined;
    const pass = !looksLikeAuditLog || hasTtl;
    return {
        pass,
        applicable: looksLikeAuditLog,
        defaultTtl: defaultTtl ?? null,
        message: !looksLikeAuditLog
            ? 'Container name does not match the audit/log naming heuristic — TTL absence is not flagged.'
            : (hasTtl
                ? 'Container looks like an audit/log container and has a default TTL configured.'
                : `Container "${containerName}" looks like an audit/log container by name but has no default TTL set — informational only, verify this is intentional (unbounded growth).`),
    };
}

function checkIndexEverythingOnHighScale(indexingSummary, throughputDetail) {
    const scale = throughputDetail.maxThroughput ?? throughputDetail.throughput;
    const looksHighScale = typeof scale === 'number' && scale >= HIGH_SCALE_RU_THRESHOLD;
    const indexesEverything = !!indexingSummary.includesAllPaths && indexingSummary.indexingMode === 'consistent';

    if (!looksHighScale || throughputDetail.mode === null) {
        return {
            pass: true,
            applicable: false,
            message: 'No high-scale throughput signal available (serverless, shared, or below the informational threshold) — indexing-policy breadth not flagged.',
        };
    }

    return {
        pass: !indexesEverything,
        applicable: true,
        provisionedThroughput: scale,
        message: indexesEverything
            ? `Container is provisioned at ${scale} RU/s and indexes every path by default — informational only: a custom indexing policy (excluding write-heavy/unused paths) may reduce RU cost at this scale.`
            : 'Indexing policy is already scoped (not indexing every path), or provisioned throughput is not high enough to flag.',
    };
}

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'accountName', 'databaseName', 'containerName']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const instance = assertPermitted(args.instance, 'cosmos', 'diagnose');
    const client = getCosmosClient(instance);

    let container;
    try {
        container = await client.sqlResources.getSqlContainer(args.resourceGroup, args.accountName, args.databaseName, args.containerName);
    } catch (err) {
        if (isNotFoundError(err)) {
            throw new AzureEstateError(ERROR_CODES.NOT_FOUND, `Container "${args.containerName}" not found in database "${args.databaseName}" (account "${args.accountName}", instance "${instance.name}")`);
        }
        throw err;
    }

    const resource = container.resource || {};

    let throughputDetail = { mode: null, throughput: null, maxThroughput: null };
    try {
        const throughputSettings = await client.sqlResources.getSqlContainerThroughput(args.resourceGroup, args.accountName, args.databaseName, args.containerName);
        throughputDetail = describeThroughputResource((throughputSettings || {}).resource);
    } catch (err) {
        if (!isNotFoundError(err)) throw err;
    }

    const findings = {
        noTtlOnAuditLikeContainer: checkTtlOnAuditLikeContainer(resource.id, resource.defaultTtl),
        indexEverythingOnHighScale: checkIndexEverythingOnHighScale(summarizeIndexingPolicy(resource.indexingPolicy), throughputDetail),
    };

    const failedChecks = Object.entries(findings)
        .filter(([, v]) => v.pass === false)
        .map(([key]) => key);

    return {
        containerName: resource.id,
        overallStatus: failedChecks.length === 0 ? 'PASS' : 'FINDINGS',
        failedChecks,
        findings,
    };
}

module.exports = { execute };
