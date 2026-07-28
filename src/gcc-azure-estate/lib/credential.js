/**
 * Shared Azure credential for the Estate MCP.
 *
 * In Azure (detected via WEBSITE_INSTANCE_ID, set by App Service/Functions
 * and absent from local `func start`), this goes straight to
 * ManagedIdentityCredential rather than the full DefaultAzureCredential
 * chain. DefaultAzureCredential tries several credential sources in
 * sequence (environment vars, workload identity, managed identity, Azure
 * CLI, Azure PowerShell, ...) — in a server environment where only
 * Managed Identity is ever going to work, cascading through the rest of
 * that chain before failing can take many seconds, long enough to look
 * like a hung/unresponsive tool call to an MCP client with a shorter
 * timeout, and long enough that the eventual error may never surface
 * anywhere useful. Going directly to ManagedIdentityCredential in Azure
 * means: if it's not configured, every tool that touches Azure fails
 * fast with a clear "ManagedIdentityCredential authentication failed"
 * error instead of a silent multi-second hang.
 *
 * If the Function App uses a user-assigned identity (selected via the
 * AZURE_CLIENT_ID app setting/env var), that selector is passed through
 * explicitly. DefaultAzureCredential reads AZURE_CLIENT_ID itself and
 * forwards it as ManagedIdentityCredential's clientId internally
 * (see createDefaultManagedIdentityCredential in @azure/identity) —
 * constructing ManagedIdentityCredential directly with no arguments does
 * NOT do this and silently selects the system-assigned identity instead,
 * which would either fail outright (no system-assigned identity exists)
 * or authenticate as the wrong principal entirely (one exists but lacks
 * the RBAC grants the user-assigned identity was set up with).
 *
 * Locally, DefaultAzureCredential is kept for developer convenience
 * (falls back to `az login`, VS Code, etc.).
 *
 * @azure/identity is required lazily, inside getCredential() — not at
 * module load time — because Azure Functions indexes every function in
 * the app by requiring this whole module tree at cold start; an eager
 * top-level require of any Azure SDK package here would risk crashing
 * that indexing for the entire app, not just this MCP's own tools, if
 * that package were ever incompatible with the runtime (see the git
 * history of this file for exactly that failure mode). The credential
 * instance itself is cached at module scope so every ARM/data-plane
 * client reuses it.
 */

'use strict';

let _credential = null;

function getCredential() {
    if (!_credential) {
        if (process.env.WEBSITE_INSTANCE_ID) {
            const { ManagedIdentityCredential } = require('@azure/identity');
            const userAssignedClientId = process.env.AZURE_CLIENT_ID;
            _credential = userAssignedClientId
                ? new ManagedIdentityCredential({ clientId: userAssignedClientId })
                : new ManagedIdentityCredential();
        } else {
            const { DefaultAzureCredential } = require('@azure/identity');
            _credential = new DefaultAzureCredential();
        }
    }
    return _credential;
}

/** Reset cached credential — test-only helper. */
function _resetForTests() {
    _credential = null;
}

module.exports = { getCredential, _resetForTests };
