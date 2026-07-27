/**
 * Shared Azure credential for the Estate MCP.
 *
 * DefaultAzureCredential chains ManagedIdentityCredential (when running as
 * the Function App in Azure) with AzureCliCredential/local dev fallbacks —
 * no connection strings, no client secrets. Kept at module scope so every
 * ARM/data-plane client reuses the same credential instance.
 */

'use strict';

const { DefaultAzureCredential } = require('@azure/identity');

let _credential = null;

function getCredential() {
    if (!_credential) {
        _credential = new DefaultAzureCredential();
    }
    return _credential;
}

module.exports = { getCredential };
