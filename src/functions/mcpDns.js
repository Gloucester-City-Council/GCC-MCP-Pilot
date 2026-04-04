/**
 * Azure Functions v4 HTTP Trigger — DNS Lookup MCP
 *
 * Exposes three MCP tools: get_dns, get_txt, get_mx
 * Endpoint: GET /api/mcp-dns (manifest), POST /api/mcp-dns (tool execution)
 *
 * Performs DNS lookups for public domains using Node.js built-in dns.promises.
 * Respects robots.txt (checked via HTTP before querying), enforces per-domain
 * rate limiting, and blocks SSRF attempts against private/internal domains.
 *
 * Uses an explicit Resolver instance pointed at public DNS servers (Google and
 * Cloudflare) rather than the OS resolver. On Azure Functions Consumption plan
 * the OS resolver (127.0.0.53 / systemd-resolved) may not be reachable via a
 * standard socket, causing all lookups to fail silently.
 *
 * User-Agent: DNSMCP/1.0 (Azure Function MCP; respects robots.txt)
 */

'use strict';

const { app } = require('@azure/functions');
const { Resolver } = require('dns').promises;

// Module-scope resolver pointing at well-known public DNS servers.
// Google (8.8.8.8 / 8.8.4.4) and Cloudflare (1.1.1.1 / 1.0.0.1) are used
// so that lookups work reliably on Azure Functions Consumption plan where the
// OS resolver socket path may not be accessible.
const resolver = new Resolver();
resolver.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);

const USER_AGENT = 'DNSMCP/1.0 (Azure Function MCP; respects robots.txt)';
const DNS_TIMEOUT_MS = 10_000;
const MIN_CRAWL_DELAY_MS = 2_000;
const ROBOTS_CACHE_TTL_MS = 3_600_000; // 1 hour

// Module-scope caches — reset on cold start, good enough for personal/internal use
/** @type {Map<string, { fetchedAt: number, rules: object }>} */
const robotsCache = new Map();
/** @type {Map<string, number>} domain → last query timestamp (ms) */
const rateLimitMap = new Map();

// ─── SSRF guard (domain-level) ────────────────────────────────────────────────
// Blocks private/internal hostnames and reserved TLDs to prevent DNS-based SSRF
const PRIVATE_HOSTNAME_RE = /^(localhost|(.*\.(local|internal|corp|lan|home|intranet|localdomain|example|test|invalid)))$/i;
const LOOPBACK_IP_RE = /^(127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0)$/;
const PRIVATE_IP_RE = /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)$/;
// Reserved / special-use TLDs (RFC 2606, RFC 6761)
const BLOCKED_TLDS = new Set(['arpa', 'local', 'localhost', 'test', 'example', 'invalid', 'onion']);
// Valid hostname label: starts and ends with alphanumeric, allows hyphens in the middle
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Validates a bare domain name for safety before any DNS or HTTP request.
 * @param {string} input
 * @returns {{ ok: true, domain: string } | { ok: false, reason: string }}
 */
function validateDomain(input) {
    if (!input || typeof input !== 'string') {
        return { ok: false, reason: 'domain is required and must be a string' };
    }

    // Normalise: trim whitespace, lowercase, remove optional trailing dot
    const domain = input.trim().toLowerCase().replace(/\.$/, '');

    if (!domain) {
        return { ok: false, reason: 'domain must not be empty' };
    }

    // Reject bare IP addresses — we query domain names, not IPs
    if (LOOPBACK_IP_RE.test(domain) || PRIVATE_IP_RE.test(domain)) {
        return { ok: false, reason: `Queries for private/internal addresses are not permitted (${domain})` };
    }
    // Catch public-looking IPs (four dotted octets) — not a valid hostname for DNS lookup
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) {
        return { ok: false, reason: 'Provide a domain name, not a raw IP address' };
    }

    // Validate each DNS label
    const labels = domain.split('.');
    if (labels.length < 2) {
        return { ok: false, reason: 'domain must include at least one dot (e.g. example.com)' };
    }
    for (const label of labels) {
        if (!label) {
            return { ok: false, reason: 'domain contains an empty label (consecutive or leading/trailing dots)' };
        }
        if (!LABEL_RE.test(label)) {
            return { ok: false, reason: `domain label "${label}" is invalid — labels must start/end with a letter or digit and contain only letters, digits, and hyphens` };
        }
    }

    // Block private/internal hostnames
    if (PRIVATE_HOSTNAME_RE.test(domain)) {
        return { ok: false, reason: `Queries for private/internal domains are not permitted (${domain})` };
    }

    // Block reserved/special-use TLDs
    const tld = labels[labels.length - 1];
    if (BLOCKED_TLDS.has(tld)) {
        return { ok: false, reason: `.${tld} is a reserved or special-use TLD — queries are not permitted` };
    }

    // Explicitly block reverse-lookup zones regardless of TLD check above
    if (domain.endsWith('.in-addr.arpa') || domain.endsWith('.ip6.arpa')) {
        return { ok: false, reason: 'Reverse DNS (PTR) lookups are not permitted' };
    }

    return { ok: true, domain };
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
            currentAgents = [];
        }
    }
    return rules;
}

function getRulesForBot(rules) {
    // Prefer specific agent match, fall back to wildcard
    return rules.agents['dnsmcp'] || rules.agents['*'] || { disallow: [], crawlDelay: 0 };
}

function isRootDisallowed(agentRules) {
    // For DNS we check whether the root path is blocked, which signals the operator
    // does not want automated tools interacting with this domain.
    for (const rule of agentRules.disallow) {
        if (rule === '/' || rule === '') continue; // empty = allow-all
        if ('/'.startsWith(rule)) return true;
        if (rule === '/') return true;
    }
    return false;
}

/**
 * Fetches robots.txt for a domain, trying https then http.
 * Treats unreachable robots.txt as allow-all (standard crawler convention).
 * @param {string} domain - validated domain name
 * @returns {Promise<object>} parsed robots rules
 */
async function fetchRobotsRules(domain) {
    const cached = robotsCache.get(domain);
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL_MS) {
        return cached.rules;
    }

    // Try https first; if it fails (connection error / timeout) try http.
    // If we get any HTTP response (even 4xx) we stop — the server is there.
    for (const scheme of ['https', 'http']) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5_000);
            const res = await fetch(`${scheme}://${domain}/robots.txt`, {
                headers: { 'User-Agent': USER_AGENT },
                signal: controller.signal,
                redirect: 'follow',
            });
            clearTimeout(timer);

            if (res.ok) {
                const text = await res.text();
                const rules = parseRobots(text);
                robotsCache.set(domain, { fetchedAt: Date.now(), rules });
                return rules;
            }
            // Non-ok response (4xx/5xx): server responded but no usable robots.txt — treat as allow-all
            break;
        } catch {
            // Network error or timeout: try next scheme
        }
    }

    // No robots.txt found or domain has no web server — allow-all
    const empty = { agents: {} };
    robotsCache.set(domain, { fetchedAt: Date.now(), rules: empty });
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
    return {
        waitMs: Math.max(wait, 0),
        minDelayMs: minDelay,
    };
}

// ─── DNS resolver helpers ─────────────────────────────────────────────────────
const SUPPORTED_DNS_TYPES = ['A', 'AAAA', 'CNAME', 'NS', 'SOA', 'CAA'];
const DEFAULT_DNS_TYPES = ['A', 'AAAA', 'CNAME', 'NS', 'SOA', 'CAA'];

/**
 * Resolves a single DNS record type with a timeout.
 * Returns { records } on success, { noData: true } when the type doesn't exist,
 * or { error } on failure.
 */
async function resolveSafe(domain, type) {
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('DNS query timed out'), { code: 'ETIMEOUT' })), DNS_TIMEOUT_MS)
    );

    try {
        let recordPromise;
        switch (type) {
            case 'SOA':
                recordPromise = resolver.resolveSoa(domain);
                break;
            case 'CAA':
                recordPromise = resolver.resolveCaa(domain);
                break;
            default:
                recordPromise = resolver.resolve(domain, type);
                break;
        }

        const records = await Promise.race([recordPromise, timeoutPromise]);
        return { records };
    } catch (err) {
        // ENODATA / ENOTFOUND mean no records of this type exist — not an error
        if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
            return { noData: true };
        }
        return { error: err.code || err.message };
    }
}

/**
 * Annotates TXT record values with recognised patterns (SPF, DMARC, BIMI, etc.)
 * @param {string[][]} records - raw TXT records (each record is an array of strings)
 * @returns {{ raw: string[], annotations: object }}
 */
function annotateTxtRecords(records) {
    // Each TXT record is an array of strings that should be joined
    const joined = records.map(parts => (Array.isArray(parts) ? parts.join('') : String(parts)));

    const annotations = {};

    for (const value of joined) {
        if (/^v=spf1\b/i.test(value)) {
            annotations.spf = value;
        } else if (/^v=DMARC1\b/i.test(value)) {
            annotations.dmarc = value;
        } else if (/^v=BIMI1\b/i.test(value)) {
            annotations.bimi = value;
        } else if (/^v=DKIM1\b/i.test(value)) {
            // DKIM TXT records live on selector._domainkey subdomains, but annotate if present
            annotations.dkim = value;
        } else if (/^(google-site-verification|MS=ms|facebook-domain-verification|apple-domain-verification|atlassian-domain-verification|docusign=|dropbox-domain-verification=|zoho-verification=|have-i-been-pwned-verification=)/i.test(value)) {
            if (!annotations.domainVerification) annotations.domainVerification = [];
            annotations.domainVerification.push(value);
        }
    }

    return { raw: joined, annotations };
}

// ─── Shared robots + rate-limit prologue ─────────────────────────────────────
/**
 * Checks robots.txt and applies rate limiting for a domain.
 * Returns { blocked, reason, robotsContext, rateLimit } on block,
 * or { robotsContext, rateLimit } on allow.
 */
async function checkPolicies(domain) {
    const rules = await fetchRobotsRules(domain);
    const agentRules = getRulesForBot(rules);
    const robotsContext = {
        checked: true,
        domain,
        userAgent: 'DNSMCP',
        crawlDelay: agentRules.crawlDelay,
        disallowRuleCount: Array.isArray(agentRules.disallow) ? agentRules.disallow.length : 0,
    };

    if (isRootDisallowed(agentRules)) {
        return {
            blocked: true,
            reason: `robots.txt for ${domain} disallows automated access — DNS lookup aborted`,
            robots: robotsContext,
        };
    }

    const rateLimit = await applyRateLimit(domain, agentRules.crawlDelay);
    return { robots: robotsContext, rateLimit };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'get_dns',
        description: [
            'Looks up DNS records for a domain.',
            'Queries A (IPv4), AAAA (IPv6), CNAME, NS (name servers), SOA (zone info), and CAA (certificate authority) records by default.',
            'Use record_types to restrict which types are queried.',
            'Respects robots.txt (checks * and DNSMCP user-agent rules) and enforces a 2-second per-domain rate limit.',
            'Blocks lookups for private/internal domains and reserved TLDs (SSRF protection).',
            'Returns a record map plus per-type error details for types with no data.',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                domain: {
                    type: 'string',
                    description: 'The domain name to query (e.g. "example.com"). Must be a public FQDN — IP addresses and private/internal domains are not permitted.',
                },
                record_types: {
                    type: 'array',
                    items: { type: 'string', enum: SUPPORTED_DNS_TYPES },
                    description: `Subset of record types to query. Defaults to all supported types: ${SUPPORTED_DNS_TYPES.join(', ')}.`,
                },
            },
            required: ['domain'],
        },
    },
    {
        name: 'get_txt',
        description: [
            'Looks up TXT records for a domain and annotates common patterns.',
            'Recognises SPF, DMARC, BIMI, DKIM, and domain verification tokens (Google, Microsoft, Facebook, Apple, etc.).',
            'Useful for auditing email authentication configuration (SPF/DMARC) and verifying domain ownership.',
            'Respects robots.txt and enforces a 2-second per-domain rate limit.',
            'Blocks lookups for private/internal domains (SSRF protection).',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                domain: {
                    type: 'string',
                    description: 'The domain name to query (e.g. "example.com" or "_dmarc.example.com"). Must be a public FQDN.',
                },
            },
            required: ['domain'],
        },
    },
    {
        name: 'get_mx',
        description: [
            'Looks up MX (mail exchange) records for a domain, returned sorted by priority (lowest = highest priority).',
            'Useful for understanding mail routing and diagnosing email delivery issues.',
            'Respects robots.txt and enforces a 2-second per-domain rate limit.',
            'Blocks lookups for private/internal domains (SSRF protection).',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                domain: {
                    type: 'string',
                    description: 'The domain name to query for MX records (e.g. "example.com"). Must be a public FQDN.',
                },
            },
            required: ['domain'],
        },
    },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────
async function handleGetDns({ domain: rawDomain, record_types: rawTypes }, context) {
    // 1. Validate domain
    const validation = validateDomain(rawDomain);
    if (!validation.ok) {
        return { blocked: true, reason: validation.reason };
    }
    const { domain } = validation;

    // 2. Validate record_types
    const types = rawTypes && rawTypes.length > 0 ? rawTypes : DEFAULT_DNS_TYPES;
    const invalidTypes = types.filter(t => !SUPPORTED_DNS_TYPES.includes(t));
    if (invalidTypes.length > 0) {
        return {
            blocked: true,
            reason: `Unsupported record type(s): ${invalidTypes.join(', ')}. Supported: ${SUPPORTED_DNS_TYPES.join(', ')}`,
        };
    }

    // 3. Check robots.txt and apply rate limit
    const policy = await checkPolicies(domain);
    if (policy.blocked) return policy;
    const { robots, rateLimit } = policy;

    // 4. Resolve each requested type
    const records = {};
    const errors = {};

    await Promise.all(types.map(async type => {
        const result = await resolveSafe(domain, type);
        if (result.noData) {
            records[type] = null;
        } else if (result.error) {
            records[type] = null;
            errors[type] = result.error;
        } else {
            records[type] = result.records;
        }
    }));

    context.log(`get_dns: ${domain} queried [${types.join(',')}]`);
    return {
        domain,
        queriedTypes: types,
        records,
        ...(Object.keys(errors).length > 0 && { errors }),
        robots,
        rateLimit,
    };
}

async function handleGetTxt({ domain: rawDomain }, context) {
    // 1. Validate domain
    const validation = validateDomain(rawDomain);
    if (!validation.ok) {
        return { blocked: true, reason: validation.reason };
    }
    const { domain } = validation;

    // 2. Check robots.txt and apply rate limit
    const policy = await checkPolicies(domain);
    if (policy.blocked) return policy;
    const { robots, rateLimit } = policy;

    // 3. Resolve TXT records
    const result = await resolveSafe(domain, 'TXT');

    if (result.noData) {
        context.log(`get_txt: ${domain} — no TXT records`);
        return { domain, records: [], annotations: {}, robots, rateLimit };
    }
    if (result.error) {
        context.log(`get_txt: ${domain} — error: ${result.error}`);
        return { domain, error: result.error, robots, rateLimit };
    }

    const { raw, annotations } = annotateTxtRecords(result.records);
    context.log(`get_txt: ${domain} — ${raw.length} TXT record(s)`);
    return {
        domain,
        recordCount: raw.length,
        records: raw,
        annotations,
        robots,
        rateLimit,
    };
}

async function handleGetMx({ domain: rawDomain }, context) {
    // 1. Validate domain
    const validation = validateDomain(rawDomain);
    if (!validation.ok) {
        return { blocked: true, reason: validation.reason };
    }
    const { domain } = validation;

    // 2. Check robots.txt and apply rate limit
    const policy = await checkPolicies(domain);
    if (policy.blocked) return policy;
    const { robots, rateLimit } = policy;

    // 3. Resolve MX records via the shared helper (uses public resolver + timeout)
    const result = await resolveSafe(domain, 'MX');

    let mxRecords;
    if (result.noData) {
        context.log(`get_mx: ${domain} — no MX records`);
        return { domain, records: [], robots, rateLimit };
    }
    if (result.error) {
        context.log(`get_mx: ${domain} — error: ${result.error}`);
        return { domain, error: result.error, robots, rateLimit };
    }
    mxRecords = result.records;

    // Sort by priority ascending (lowest priority value = highest mail preference)
    const sorted = [...mxRecords].sort((a, b) => a.priority - b.priority);
    context.log(`get_mx: ${domain} — ${sorted.length} MX record(s)`);
    return {
        domain,
        recordCount: sorted.length,
        records: sorted,
        robots,
        rateLimit,
    };
}

// ─── MCP manifest ─────────────────────────────────────────────────────────────
const MANIFEST = {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: {
        name: 'gcc-dns-mcp',
        version: '1.0.0',
        instructions: `🔍 DNS LOOKUP MCP

Performs DNS lookups for public domains.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- get_dns  — Query A, AAAA, CNAME, NS, SOA, CAA records for a domain
- get_txt  — Query TXT records with annotation of SPF, DMARC, BIMI, and domain-verification tokens
- get_mx   — Query MX (mail exchange) records sorted by priority

⚠️  Respects robots.txt. Private/internal domains and reserved TLDs are blocked (SSRF protection).
Rate limited to one query per domain per 2 seconds (or crawl-delay if longer).
Reverse DNS (PTR) lookups are not supported.`,
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

    context.log(`Processing MCP DNS method: ${method}`);

    switch (method) {
        case 'initialize':
            return { jsonrpc: '2.0', result: MANIFEST, id };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return { jsonrpc: '2.0', result: { tools: TOOLS }, id };

        case 'tools/call': {
            const { name, arguments: rawArgs } = params || {};
            const toolStart = Date.now();

            if (!name) {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: 'Invalid params: tool name is required' },
                    id,
                };
            }

            const toolNames = TOOLS.map(t => t.name);
            if (!toolNames.includes(name)) {
                return {
                    jsonrpc: '2.0',
                    error: {
                        code: -32602,
                        message: `Unknown tool: ${name}. Available: ${toolNames.join(', ')}`,
                    },
                    id,
                };
            }

            try {
                let args = rawArgs;
                if (typeof rawArgs === 'string') {
                    try {
                        args = JSON.parse(rawArgs);
                    } catch {
                        return {
                            jsonrpc: '2.0',
                            error: { code: -32602, message: 'Invalid params: arguments must be valid JSON when provided as a string' },
                            id,
                        };
                    }
                }
                if (!args || typeof args !== 'object' || Array.isArray(args)) {
                    return {
                        jsonrpc: '2.0',
                        error: { code: -32602, message: 'Invalid params: arguments must be an object' },
                        id,
                    };
                }

                context.log(`Executing tool: ${name} domain=${args.domain}`);

                let result;
                switch (name) {
                    case 'get_dns':
                        result = await handleGetDns(args, context);
                        break;
                    case 'get_txt':
                        result = await handleGetTxt(args, context);
                        break;
                    case 'get_mx':
                        result = await handleGetMx(args, context);
                        break;
                }

                context.log(`DNS tool completed [${name}] in ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                    },
                    id,
                };
            } catch (error) {
                context.log.error(`DNS tool error: ${error.message}`);
                if (error && error.stack) {
                    context.log.error(`DNS tool error stack [${name}]: ${error.stack}`);
                }
                context.log.error(`DNS tool failed [${name}] after ${Date.now() - toolStart}ms`);
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
app.http('mcpDns', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'mcp-dns',
    handler: async (request, context) => {
        const requestStart = Date.now();
        context.log('MCP DNS request received');

        try {
            if (request.method === 'GET') {
                context.log(`MCP DNS manifest served with 200 in ${Date.now() - requestStart}ms`);
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(MANIFEST),
                };
            }

            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.error('MCP DNS parse error:', parseError);
                if (parseError && parseError.stack) {
                    context.log.error('MCP DNS parse error stack:', parseError.stack);
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
                context.log(`MCP DNS request completed with 204 in ${Date.now() - requestStart}ms`);
                return { status: 204 };
            }

            context.log(`MCP DNS request completed with 200 in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
            };
        } catch (error) {
            context.log.error('MCP DNS unhandled error:', error);
            if (error && error.stack) {
                context.log.error('MCP DNS unhandled error stack:', error.stack);
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
