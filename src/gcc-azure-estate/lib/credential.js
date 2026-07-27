/**
 * Shared Azure credential for the Estate MCP.
 *
 * DefaultAzureCredential chains ManagedIdentityCredential (when running as
 * the Function App in Azure) with AzureCliCredential/local dev fallbacks —
 * no connection strings, no client secrets. The credential instance is
 * cached at module scope so every ARM/data-plane client reuses it, but
 * @azure/identity itself is required lazily, inside getCredential() —
 * not at module load time. @azure/identity requires Node >=20 while this
 * Function App runs Node 18; every other Azure SDK package in this MCP
 * (lib/clients.js) is already lazily required for the same reason. An
 * eager top-level require here would run during Azure Functions'
 * cold-start indexing of every function in the app (not just this MCP's
 * own tools), crashing the whole worker before any function — including
 * ones unrelated to Azure Estate — gets registered.
 */

'use strict';

let _credential = null;

function getCredential() {
    if (!_credential) {
        const { DefaultAzureCredential } = require('@azure/identity');
        _credential = new DefaultAzureCredential();
    }
    return _credential;
}

module.exports = { getCredential };
