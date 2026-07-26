/**
 * Tool: azure_subscriptions_list
 *
 * Lists the Azure subscriptions visible to the Estate MCP's credential
 * (the Function App's Managed Identity in production). This is identity
 * discovery, not resource configuration — low sensitivity, so it is not
 * gated by a resource-family permission class (same rationale as
 * azure_ping / azure_instances_list).
 */

'use strict';

const { getSubscriptionClient } = require('../../lib/clients');

async function execute() {
    const client = getSubscriptionClient();
    const subscriptions = [];

    for await (const sub of client.subscriptions.list()) {
        subscriptions.push({
            subscriptionId: sub.subscriptionId,
            displayName: sub.displayName,
            state: sub.state,
            tenantId: sub.tenantId,
        });
    }

    return { subscriptions, totalCount: subscriptions.length };
}

module.exports = { execute };
