/**
 * Tool: azure_sql_firewall_rule_create
 *
 * Creates a SQL server firewall rule. Requires the "network" operation
 * class. Refuses a rule that opens the server to the whole internet
 * (0.0.0.0 to 255.255.255.255). The special range 0.0.0.0 to 0.0.0.0
 * means "allow Azure services" and is accepted. Fails with CONFLICT if
 * a rule of that name exists.
 */

'use strict';

const { assertPermitted } = require('../../lib/permissions');
const { getSqlClient } = require('../../lib/clients');
const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { settle, IPV4 } = require('./_shared');

async function execute(args = {}) {
    const missing = validateRequired(args, ['instance', 'resourceGroup', 'serverName', 'name', 'startIpAddress', 'endIpAddress']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);
    if (!IPV4.test(args.startIpAddress) || !IPV4.test(args.endIpAddress)) {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'startIpAddress and endIpAddress must be IPv4 addresses such as 203.0.113.10');
    }
    if (args.startIpAddress === '0.0.0.0' && args.endIpAddress === '255.255.255.255') {
        throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'A rule covering 0.0.0.0 to 255.255.255.255 would open the server to the whole internet. Use a narrower range, or 0.0.0.0 to 0.0.0.0 to allow Azure services only.');
    }

    const instance = assertPermitted(args.instance, 'sql', 'network');
    const client = getSqlClient(instance);

    let existing = null;
    try {
        existing = await client.firewallRules.get(args.resourceGroup, args.serverName, args.name);
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    if (existing) {
        throw new AzureEstateError(ERROR_CODES.CONFLICT, `Firewall rule "${args.name}" already exists on server "${args.serverName}"`);
    }

    const rule = await settle(await client.firewallRules.createOrUpdate(args.resourceGroup, args.serverName, args.name, {
        startIpAddress: args.startIpAddress,
        endIpAddress: args.endIpAddress,
    }));

    return {
        created: true,
        name: rule.name || args.name,
        serverName: args.serverName,
        startIpAddress: args.startIpAddress,
        endIpAddress: args.endIpAddress,
        allowsAzureServices: args.startIpAddress === '0.0.0.0' && args.endIpAddress === '0.0.0.0',
    };
}

module.exports = { execute };
