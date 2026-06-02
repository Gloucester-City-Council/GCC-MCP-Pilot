'use strict';

const UK_TENDERS_ENDPOINT = 'https://tenders.run.cns.me/mcp';
const TIMEOUT_MS = 15000;

let _requestId = 1;

/**
 * Parse an SSE response body and return the JSON-RPC message matching requestId.
 * SSE format: one or more "data: {json}\n\n" blocks. Pings and notifications
 * (no id field) are skipped; the block whose id matches is returned.
 */
function parseSseResponse(text, requestId) {
    for (const block of text.split('\n\n')) {
        let data = null;
        for (const line of block.split('\n')) {
            if (line.startsWith('data: ')) {
                data = line.slice(6).trim();
            }
        }
        if (!data) continue;
        try {
            const msg = JSON.parse(data);
            if (msg.id === requestId) return msg;
        } catch {
            // skip malformed events
        }
    }
    throw new Error('UK Tenders SSE response contained no message matching the request');
}

/**
 * POST a JSON-RPC message to the endpoint and return the raw Response.
 * Throws on timeout, network failure, or 403.
 */
async function post(body, sessionHeaders = {}) {
    let response;
    try {
        response = await fetch(UK_TENDERS_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                ...sessionHeaders,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
            throw new Error('UK Tenders endpoint timed out — try again or narrow your query');
        }
        throw new Error(`UK Tenders endpoint unreachable: ${err.message}`);
    }

    if (response.status === 403) {
        const reason = await response.text().catch(() => 'no detail');
        throw new Error(`UK Tenders endpoint rejected the request (403 Forbidden — ${reason.slice(0, 200)}). The endpoint may require this host to be allowlisted.`);
    }

    return response;
}

/**
 * Perform the MCP initialize handshake and return any session headers to
 * include on subsequent requests (e.g. Mcp-Session-Id).
 * The Function App is stateless so this runs on every tool call.
 */
async function initSession() {
    const initResponse = await post({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'gcc-procurement-mcp', version: '1.0.0' },
        },
        id: _requestId++,
    });

    if (!initResponse.ok) {
        const body = await initResponse.text().catch(() => '');
        throw new Error(`UK Tenders initialization failed HTTP ${initResponse.status}: ${body.slice(0, 200)}`);
    }

    // Consume body to release the connection
    await initResponse.text().catch(() => {});

    // Streamable HTTP transport may return a session ID to thread through subsequent requests
    const sessionId = initResponse.headers.get('mcp-session-id');
    const sessionHeaders = sessionId ? { 'Mcp-Session-Id': sessionId } : {};

    // Send the required initialized notification — fire-and-forget, ignore response
    await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sessionHeaders)
        .then(r => r.text().catch(() => {}))
        .catch(() => {});

    return sessionHeaders;
}

/**
 * Call a tool on the uk-tenders MCP endpoint.
 * @param {string} toolName - e.g. 'search_tenders'
 * @param {Record<string, unknown>} args - Tool arguments
 * @returns {Promise<unknown>} Parsed tool result
 */
async function callTool(toolName, args = {}) {
    // MCP requires initialize → initialized before tools/call.
    // Handshake on every call since the Function App holds no session state.
    const sessionHeaders = await initSession();

    const requestId = _requestId++;
    const payload = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
            name: toolName,
            arguments: args,
        },
        id: requestId,
    };

    const response = await post(payload, sessionHeaders);

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`UK Tenders endpoint returned HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    let body;

    if (contentType.includes('text/event-stream')) {
        const text = await response.text();
        body = parseSseResponse(text, requestId);
    } else {
        try {
            body = await response.json();
        } catch (err) {
            throw new Error(`UK Tenders endpoint returned invalid JSON: ${err.message}`);
        }
    }

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
