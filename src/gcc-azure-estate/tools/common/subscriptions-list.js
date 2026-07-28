/**
 * Tool: azure_subscriptions_list
 *
 * Lists the Azure subscriptions visible to the Estate MCP's credential
 * (the Function App's Managed Identity in production). This is identity
 * discovery, not resource configuration — low sensitivity, so it is not
 * gated by a resource-family permission class (same rationale as
 * azure_ping / azure_instances_list).
 *
 * Calls the ARM REST API directly (GET /subscriptions) rather than going
 * through an SDK client: this classic, tenant-wide "list every
 * subscription the caller can see" operation isn't exposed by either
 * @azure/arm-subscriptions@6 (restructured around subscription
 * lifecycle/alias management — cancel/rename/enable, no list) or
 * @azure/arm-resources's ResourceManagementClient (scoped to operations
 * within one already-known subscriptionId) in their current shape.
 * The raw REST endpoint has been stable for years and needs only the
 * same credential every other tool already uses.
 */

'use strict';

const { getCredential } = require('../../lib/credential');

const ARM_ENDPOINT = 'https://management.azure.com';
const ARM_SCOPE = 'https://management.azure.com/.default';
const API_VERSION = '2022-12-01';

async function fetchPage(url, authHeader) {
    const response = await fetch(url, { headers: { Authorization: authHeader } });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Failed to list subscriptions: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
    }

    return response.json();
}

async function execute() {
    const credential = getCredential();
    const token = await credential.getToken(ARM_SCOPE);
    const authHeader = `Bearer ${token.token}`;

    const subscriptions = [];
    let url = `${ARM_ENDPOINT}/subscriptions?api-version=${API_VERSION}`;

    // ARM pages this endpoint via nextLink when the caller can see more
    // subscriptions than fit on one page — keep following it or results
    // (and totalCount) would silently be truncated.
    while (url) {
        const data = await fetchPage(url, authHeader);
        for (const sub of data.value || []) {
            subscriptions.push({
                subscriptionId: sub.subscriptionId,
                displayName: sub.displayName,
                state: sub.state,
                tenantId: sub.tenantId,
            });
        }
        url = data.nextLink || null;
    }

    return { subscriptions, totalCount: subscriptions.length };
}

module.exports = { execute };
