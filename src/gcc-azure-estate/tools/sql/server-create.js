/**
 * Tool: azure_sql_server_create
 *
 * Creates an Azure SQL logical server with Microsoft Entra-only
 * authentication (no SQL password exists) and TLS 1.2. The Entra admin
 * must be a group, given by name and object ID. Fails with CONFLICT if
 * the server exists. No delete tool exists.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getSqlClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { settle, GUID } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'name', 'location', 'adminGroupName', 'adminGroupObjectId']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);
    if (!GUID.test(args.adminGroupObjectId)) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'adminGroupObjectId must be the Entra group object ID (a GUID)');
    }

    const instance = assertPermitted(args.instance, 'sql', 'create');
    const client = getSqlClient(instance);

    let existing = null;
    try {
        existing = await client.servers.get(args.resourceGroup, args.name);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    if (existing) {
        throw new AzureEstateError(ERROR_CODES.CONFLICT, `SQL server "${args.name}" already exists in resource group "${args.resourceGroup}" (instance "${instance.name}")`);
    }

    const server = await settle(await client.servers.createOrUpdate(args.resourceGroup, args.name, {
        location: args.location,
        minimalTlsVersion: '1.2',
        administrators: {
            administratorType: 'ActiveDirectory',
            principalType: 'Group',
            login: args.adminGroupName,
            sid: args.adminGroupObjectId,
            azureADOnlyAuthentication: true,
        },
        tags: args.tags || {},
    }));

    return {
        created: true,
        name: server.name || args.name,
        resourceGroup: args.resourceGroup,
        location: server.location || args.location,
        fullyQualifiedDomainName: server.fullyQualifiedDomainName || `${args.name}.database.windows.net`,
        authentication: 'Microsoft Entra only',
        adminGroup: args.adminGroupName,
    };
}

module.exports = { execute };
