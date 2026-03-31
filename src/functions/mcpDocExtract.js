/**
 * Azure Functions v4 HTTP Trigger — Document Extraction MCP
 *
 * Exposes a single MCP tool: fetch_document_content
 * Endpoint: POST /api/mcp-doc-extract
 *
 * Fetches PDF or DOCX files from public URLs and returns AI-usable extracted text.
 * Respects robots.txt, enforces per-domain rate limiting, and blocks SSRF
 * attempts against private IP ranges.
 *
 * Supported formats: PDF (.pdf), DOCX (.docx)
 * Note: Image-based content and OCR are not supported at this stage.
 *
 * User-Agent: DocExtractMCP/1.0 (Azure Function MCP; respects robots.txt)
 */

'use strict';

const { app } = require('@azure/functions');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const USER_AGENT = 'DocExtractMCP/1.0 (Azure Function MCP; respects robots.txt)';
const FETCH_TIMEOUT_MS = 30_000; // Documents can be larger than HTML pages
const MIN_CRAWL_DELAY_MS = 2_000;
const ROBOTS_CACHE_TTL_MS = 3_600_000; // 1 hour
const MAX_DOCUMENT_BYTES = 20_971_520; // 20 MB safety limit

// Module-scope caches — reset on cold start, good enough for personal/internal use
/** @type {Map<string, { fetchedAt: number, rules: object }>} */
const robotsCache = new Map();
/** @type {Map<string, number>} domain → last fetch timestamp (ms) */
const rateLimitMap = new Map();

// ─── SSRF guard ───────────────────────────────────────────────────────────────
const PRIVATE_HOSTNAME_RE = /^(localhost|.*\.local)$/i;
const PRIVATE_IP_RE = /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|127\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+|::1|0\.0\.0\.0)$/;

function isPrivateHost(hostname) {
    if (PRIVATE_HOSTNAME_RE.test(hostname)) return true;
    if (PRIVATE_IP_RE.test(hostname)) return true;
    return false;
}

// ─── URL validation ───────────────────────────────────────────────────────────
function validateUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { ok: false, reason: 'url is required and must be a string' };
    }
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { ok: false, reason: 'Malformed URL — could not parse' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { ok: false, reason: `URL protocol must be http or https, got: ${parsed.protocol}` };
    }
    if (isPrivateHost(parsed.hostname)) {
        return { ok: false, reason: `Requests to private/internal hosts are not permitted (${parsed.hostname})` };
    }
    return { ok: true, parsed };
}

// ─── robots.txt helpers ───────────────────────────────────────────────────────
function parseRobots(text) {
    const rules = { agents: {} };
    let currentAgents = [];

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) {
            currentAgents = [];
            continue;
        }

        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;

        const field = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();

        if (field === 'user-agent') {
            const agent = value.toLowerCase();
            if (!rules.agents[agent]) rules.agents[agent] = { disallow: [], crawlDelay: 0 };
            currentAgents.push(agent);
        } else if (field === 'disallow') {
            for (const agent of currentAgents) {
                if (!rules.agents[agent]) rules.agents[agent] = { disallow: [], crawlDelay: 0 };
                rules.agents[agent].disallow.push(value);
            }
        } else if (field === 'crawl-delay') {
            const delay = parseFloat(value);
            if (!isNaN(delay) && delay > 0) {
                for (const agent of currentAgents) {
                    if (!rules.agents[agent]) rules.agents[agent] = { disallow: [], crawlDelay: 0 };
                    rules.agents[agent].crawlDelay = delay * 1000;
                }
            }
        } else {
            // Any non-agent-block directive resets current agent scope
            currentAgents = [];
        }
    }
    return rules;
}

function isPathDisallowed(path, disallowList) {
    for (const rule of disallowList) {
        if (!rule) continue; // empty Disallow means allow all
        if (path.startsWith(rule)) return true;
    }
    return false;
}

function getRulesForBot(rules) {
    // Prefer specific agent match, fall back to wildcard
    return rules.agents['docextractmcp'] || rules.agents['*'] || { disallow: [], crawlDelay: 0 };
}

async function fetchRobotsRules(origin) {
    const cached = robotsCache.get(origin);
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL_MS) {
        return cached.rules;
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        const res = await fetch(`${origin}/robots.txt`, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) {
            const text = await res.text();
            const rules = parseRobots(text);
            robotsCache.set(origin, { fetchedAt: Date.now(), rules });
            return rules;
        }
    } catch {
        // Unreachable robots.txt → treat as allow-all
    }

    const empty = { agents: {} };
    robotsCache.set(origin, { fetchedAt: Date.now(), rules: empty });
    return empty;
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
async function applyRateLimit(domain, crawlDelayMs) {
    const minDelay = Math.max(MIN_CRAWL_DELAY_MS, crawlDelayMs);
    const last = rateLimitMap.get(domain) || 0;
    const wait = last + minDelay - Date.now();
    if (wait > 0) {
        await new Promise(r => setTimeout(r, wait));
    }
    rateLimitMap.set(domain, Date.now());
}

// ─── Document type detection ──────────────────────────────────────────────────
/**
 * Determines whether the response is a PDF or DOCX based on Content-Type and URL.
 * @param {string} contentType - The HTTP Content-Type header value
 * @param {string} url - The final URL (after redirects)
 * @returns {'pdf'|'docx'|null}
 */
function detectDocumentType(contentType, url) {
    const ct = (contentType || '').toLowerCase();
    const urlLower = (url || '').toLowerCase().split('?')[0]; // strip query string for extension check

    if (ct.includes('application/pdf') || urlLower.endsWith('.pdf')) return 'pdf';
    if (
        ct.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
        ct.includes('application/msword') ||
        urlLower.endsWith('.docx') ||
        urlLower.endsWith('.doc')
    ) return 'docx';

    return null;
}

// ─── Text extraction ──────────────────────────────────────────────────────────
/**
 * Extracts text content from a PDF buffer.
 * @param {Buffer} buffer
 * @returns {Promise<{ text: string, pageCount: number, metadata: object }>}
 */
async function extractPdf(buffer) {
    const data = await pdfParse(buffer);
    return {
        text: data.text,
        pageCount: data.numpages,
        metadata: data.info || {},
    };
}

/**
 * Extracts text content from a DOCX buffer.
 * @param {Buffer} buffer
 * @returns {Promise<{ text: string, warnings: string[] }>}
 */
async function extractDocx(buffer) {
    const result = await mammoth.extractRawText({ buffer });
    return {
        text: result.value,
        warnings: result.messages.map(m => m.message),
    };
}

// ─── Tool definition ──────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'fetch_document_content',
        description: [
            'Fetches a PDF or DOCX document from a public URL and returns the extracted text content for AI analysis.',
            'Supported formats: PDF (.pdf) and Word documents (.docx / .doc).',
            '⚠️ Image-based (scanned) documents are not supported — OCR is out of scope at this stage; scanned pages will return empty or partial text.',
            'Respects robots.txt (checks * and DocExtractMCP user-agent rules).',
            'Enforces a minimum 2-second per-domain rate limit (or crawl-delay if longer).',
            'Blocks requests to private/internal IP ranges to prevent SSRF.',
            'Returns: documentType, extractedText, pageCount (PDF only), characterCount, metadata, and any extraction warnings.',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL of the PDF or DOCX document to fetch. Must use http or https.',
                },
            },
            required: ['url'],
        },
    },
];

// ─── Tool handler ─────────────────────────────────────────────────────────────
async function handleFetchDocumentContent({ url }, context) {
    // 1. Validate URL
    const validation = validateUrl(url);
    if (!validation.ok) {
        return { blocked: true, reason: validation.reason };
    }
    const { parsed } = validation;
    const origin = `${parsed.protocol}//${parsed.host}`;

    // 2. Fetch and parse robots.txt
    const rules = await fetchRobotsRules(origin);
    const agentRules = getRulesForBot(rules);

    // 3. Check path against disallow rules
    const path = parsed.pathname || '/';
    if (isPathDisallowed(path, agentRules.disallow)) {
        return {
            blocked: true,
            reason: `Path "${path}" is disallowed by robots.txt`,
            robotsOrigin: origin,
        };
    }

    // 4. Apply rate limit
    await applyRateLimit(parsed.hostname, agentRules.crawlDelay);

    // 5. Fetch the document as binary
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
            redirect: 'follow',
        });
    } catch (err) {
        clearTimeout(timer);
        const reason = err.name === 'AbortError'
            ? 'Request timed out after 30 seconds'
            : `Fetch failed: ${err.message}`;
        return { error: true, reason };
    }
    clearTimeout(timer);

    if (!response.ok) {
        return {
            error: true,
            reason: `Server returned HTTP ${response.status} for ${response.url}`,
            statusCode: response.status,
        };
    }

    const contentType = response.headers.get('content-type') || '';
    const finalUrl = response.url;

    // 6. Detect document type from Content-Type header and URL
    const docType = detectDocumentType(contentType, finalUrl);
    if (!docType) {
        return {
            error: true,
            reason: `Unsupported content type: "${contentType}". Expected a PDF or DOCX document.`,
            contentType,
            url: finalUrl,
            hint: 'Supported types: application/pdf (.pdf), application/vnd.openxmlformats-officedocument.wordprocessingml.document (.docx)',
        };
    }

    // 7. Read response body as binary buffer
    let buffer;
    try {
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_DOCUMENT_BYTES) {
            return {
                error: true,
                reason: `Document exceeds maximum allowed size of ${MAX_DOCUMENT_BYTES / 1_048_576} MB (document is ${(arrayBuffer.byteLength / 1_048_576).toFixed(1)} MB)`,
                url: finalUrl,
            };
        }
        buffer = Buffer.from(arrayBuffer);
    } catch (err) {
        return { error: true, reason: `Failed to read response body: ${err.message}` };
    }

    // 8. Extract text content
    try {
        if (docType === 'pdf') {
            const { text, pageCount, metadata } = await extractPdf(buffer);
            context.log(`fetch_document_content: PDF extracted ${pageCount} pages, ${text.length} chars from ${finalUrl}`);
            return {
                url: finalUrl,
                documentType: 'pdf',
                pageCount,
                characterCount: text.length,
                metadata,
                extractedText: text,
            };
        }

        if (docType === 'docx') {
            const { text, warnings } = await extractDocx(buffer);
            context.log(`fetch_document_content: DOCX extracted ${text.length} chars from ${finalUrl}`);
            const result = {
                url: finalUrl,
                documentType: 'docx',
                characterCount: text.length,
                extractedText: text,
            };
            if (warnings.length > 0) result.warnings = warnings;
            return result;
        }
    } catch (err) {
        return {
            error: true,
            reason: `Text extraction failed: ${err.message}`,
            documentType: docType,
            url: finalUrl,
        };
    }
}

// ─── MCP manifest ─────────────────────────────────────────────────────────────
const MANIFEST = {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: {
        name: 'gcc-doc-extract-mcp',
        version: '1.0.0',
        instructions: `📄 DOCUMENT EXTRACTION MCP

Fetches PDF and DOCX documents from public URLs and returns AI-readable extracted text.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- fetch_document_content — Extract text from a PDF or DOCX at a given URL

⚠️  Respects robots.txt. Private/internal IP ranges are blocked (SSRF protection).
Rate limited to one request per domain per 2 seconds (or crawl-delay if longer).
Image-based (scanned) documents are not supported — OCR is out of scope at this stage.`,
    },
};

// ─── MCP JSON-RPC handler ─────────────────────────────────────────────────────
async function handleMcpRequest(request, context) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return {
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request: body must be a JSON object' },
            id: null,
        };
    }

    const { jsonrpc, method, params, id } = request;
    const requestId = Object.prototype.hasOwnProperty.call(request, 'id') && id !== undefined ? id : null;

    if (jsonrpc !== '2.0') {
        return {
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
            id: requestId,
        };
    }

    context.log(`Processing MCP Doc Extract method: ${method}`);

    switch (method) {
        case 'initialize':
            return { jsonrpc: '2.0', result: MANIFEST, id };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return { jsonrpc: '2.0', result: { tools: TOOLS }, id };

        case 'tools/call': {
            const { name, arguments: args } = params || {};
            const toolStart = Date.now();

            if (!name) {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: 'Invalid params: tool name is required' },
                    id,
                };
            }

            if (name !== 'fetch_document_content') {
                return {
                    jsonrpc: '2.0',
                    error: {
                        code: -32602,
                        message: `Unknown tool: ${name}. Available: fetch_document_content`,
                    },
                    id,
                };
            }

            try {
                context.log(`Executing tool: ${name} url=${args?.url}`);
                const result = await handleFetchDocumentContent(args || {}, context);
                context.log(`Doc Extract tool completed [${name}] in ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                    },
                    id,
                };
            } catch (error) {
                context.log.error(`Doc Extract tool error: ${error.message}`);
                if (error && error.stack) {
                    context.log.error(`Doc Extract tool error stack [${name}]: ${error.stack}`);
                }
                context.log.error(`Doc Extract tool failed [${name}] after ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
                        isError: true,
                    },
                    id,
                };
            }
        }

        case 'ping':
            return { jsonrpc: '2.0', result: {}, id };

        default:
            return {
                jsonrpc: '2.0',
                error: { code: -32601, message: `Method not found: ${method}` },
                id,
            };
    }
}

// ─── HTTP trigger registration ────────────────────────────────────────────────
app.http('mcpDocExtract', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp-doc-extract',
    handler: async (request, context) => {
        const requestStart = Date.now();
        context.log('MCP Doc Extract request received');

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.error('MCP Doc Extract parse error:', parseError);
                if (parseError && parseError.stack) {
                    context.log.error('MCP Doc Extract parse error stack:', parseError.stack);
                }
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        error: { code: -32700, message: 'Parse error: Invalid JSON' },
                        id: null,
                    }),
                };
            }

            const response = await handleMcpRequest(body, context);

            if (response === null) {
                context.log(`MCP Doc Extract request completed with 204 in ${Date.now() - requestStart}ms`);
                return { status: 204 };
            }

            context.log(`MCP Doc Extract request completed with 200 in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
            };
        } catch (error) {
            context.log.error('MCP Doc Extract unhandled error:', error);
            if (error && error.stack) {
                context.log.error('MCP Doc Extract unhandled error stack:', error.stack);
            }
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: error.message },
                    id: null,
                }),
            };
        }
    },
});
