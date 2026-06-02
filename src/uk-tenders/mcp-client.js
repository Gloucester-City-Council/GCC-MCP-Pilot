'use strict';

const axios = require('axios');

const UK_TENDERS_ENDPOINT = 'https://tenders.run.cns.me/mcp';
const TIMEOUT_MS = 15000;

let _requestId = 1;

/**
 * Call a tool on the uk-tenders MCP endpoint.
 * @param {string} toolName - e.g. 'search_tenders'
 * @param {Record<string, unknown>} args - Tool arguments
 * @returns {Promise<unknown>} Parsed tool result
 */
async function callTool(toolName, args = {}) {
    const payload = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
            name: toolName,
            arguments: args,
        },
        id: _requestId++,
    };

    let response;
    try {
        response = await axios.post(UK_TENDERS_ENDPOINT, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: TIMEOUT_MS,
        });
    } catch (err) {
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
            throw new Error('UK Tenders endpoint timed out — try again or narrow your query');
        }
        throw new Error(`UK Tenders endpoint unreachable: ${err.message}`);
    }

    const body = response.data;

    // JSON-RPC error
    if (body.error) {
        throw new Error(`UK Tenders MCP error ${body.error.code}: ${body.error.message}`);
    }

    // MCP tool error (isError: true in the result)
    const result = body.result;
    if (result && result.isError) {
        const text = result.content?.[0]?.text || 'Unknown tool error';
        throw new Error(`UK Tenders tool error: ${text}`);
    }

    // Unwrap the content array — tools return { content: [{ type: 'text', text: '...' }] }
    const text = result?.content?.[0]?.text;
    if (!text) throw new Error('UK Tenders returned an empty response');

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

module.exports = { callTool };
