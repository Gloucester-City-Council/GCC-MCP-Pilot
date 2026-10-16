/**
 * Shields MCP Module
 *
 * Wires the tool definitions to the Blob-backed live badge store for the
 * mcpShields Azure Function.
 */

'use strict';

const { createStore, endpointJson, normaliseKey } = require('./store');
const { createTools, ShieldsError } = require('./tools');

function defaultBaseUrl() {
    if (process.env.SHIELDS_PUBLIC_BASE_URL) return process.env.SHIELDS_PUBLIC_BASE_URL.replace(/\/$/, '');
    if (process.env.WEBSITE_HOSTNAME) return `https://${process.env.WEBSITE_HOSTNAME}`;
    return null;
}

const store = createStore();
const { TOOLS, TOOL_HANDLERS } = createTools({ store, baseUrl: defaultBaseUrl });

const SERVER_INFO = {
    name: 'gcc-shields-mcp',
    version: '1.0.0',
    description: 'Builds Shields.io badges, including live badges whose value changes without editing the page that embeds them.',
    readOnly: false,
};

module.exports = { TOOLS, TOOL_HANDLERS, SERVER_INFO, store, endpointJson, normaliseKey, ShieldsError, createTools, createStore };
