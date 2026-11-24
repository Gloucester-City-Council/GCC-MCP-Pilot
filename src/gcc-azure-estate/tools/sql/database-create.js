/**
 * Tool: azure_sql_database_create
 *
 * Creates a serverless General Purpose (Gen5) database on an existing SQL
 * server, optionally using the Azure SQL free offer. Fails with
 * DEPENDENCY_MISSING if the server is absent and CONFLICT if the database
 * exists. No delete tool exists.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getSqlClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { settle } = require('./_shared');

const BACKUP = ['Local', 'Zone', 'Geo', 'GeoZone'];
const EXHAUSTION = ['AutoPause', 'BillOverUsage'];

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'serverName', 'name', 'location']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);

    const vcores = args.maxVcores === undefined ? 1 : args.maxVcores;
    const useFree = args.useFreeOffer !== false;
    const backup = args.backupStorageRedundancy || 'Local';
    const exhaustion = args.freeLimitExhaustionBehavior || 'BillOverUsage';
    if (!Number.isInteger(vcores) || vcores < 1 || vcores > 40) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'maxVcores must be a whole number from 1 to 40');
    }
    if (!BACKUP.includes(backup)) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `backupStorageRedundancy must be one of ${BACKUP.join(', ')}`);
    if (!EXHAUSTION.includes(exhaustion)) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `freeLimitExhaustionBehavior must be one of ${EXHAUSTION.join(', ')}`);

    const instance = assertPermitted(args.instance, 'sql', 'create');
    const client = getSqlClient(instance);

    try {
        await client.servers.get(args.resourceGroup, args.serverName);
    } catch (err) {
        if (err.statusCode === 404) {
            throw new AzureEstateError(ERROR_CODES.DEPENDENCY_MISSING,
                `SQL server "${args.serverName}" not found in resource group "${args.resourceGroup}". Create it first with azure_sql_server_create.`);
        }
        throw err;
    }

    let existing = null;
    try {
        existing = await client.databases.get(args.resourceGroup, args.serverName, args.name);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    if (existing) {
        throw new AzureEstateError(ERROR_CODES.CONFLICT, `Database "${args.name}" already exists on server "${args.serverName}"`);
    }

    const body = {
        location: args.location,
        sku: { name: `GP_S_Gen5_${vcores}`, tier: 'GeneralPurpose', family: 'Gen5', capacity: vcores },
        requestedBackupStorageRedundancy: backup,
        tags: args.tags || {},
    };
    if (useFree) {
        body.useFreeLimit = true;
        body.freeLimitExhaustionBehavior = exhaustion;
    }

    const db = await settle(await client.databases.createOrUpdate(args.resourceGroup, args.serverName, args.name, body));

    return {
        created: true,
        name: db.name || args.name,
        serverName: args.serverName,
        resourceGroup: args.resourceGroup,
        sku: body.sku.name,
        freeOffer: useFree,
        freeLimitExhaustionBehavior: useFree ? exhaustion : null,
        backupStorageRedundancy: backup,
    };
}

module.exports = { execute };
