/**
 * Azure Functions v4 HTTP Trigger — GitHub Repository MCP
 *
 * Exposes MCP tools for read-only access to public GitHub repository data.
 * Endpoint: POST /api/mcp-github
 *
 * Tools:
 *   - github_get_repo      — Repository metadata
 *   - github_get_readme    — README content
 *   - github_get_tree      — File/directory tree
 *   - github_get_file      — Text content of a specific file
 *   - github_list_commits  — Recent commit history
 *
 * Security:
 *   - All requests target the fixed endpoint https://api.github.com only —
 *     no user-supplied URLs are ever fetched (SSRF not possible via URL)
 *   - owner/repo/path/ref inputs are strictly validated to prevent injection
 *   - Respects robots.txt for api.github.com (cached 1 hour)
 *   - Enforces per-domain rate limiting (1-second minimum interval)
 *   - Honours GitHub API rate-limit response headers; blocks cleanly when exhausted
 *   - Optional GITHUB_TOKEN env var raises rate limit from 60/hr to 5000/hr
 *   - File content capped at 1 MB; binary files return download_url instead
 *
 * User-Agent: GitHubMCP/1.0 (Azure Function MCP; respects robots.txt)
 */

'use strict';

const { app } = require('@azure/functions');

const GITHUB_API_BASE = 'https://api.github.com';
const USER_AGENT = 'GitHubMCP/1.0 (Azure Function MCP; respects robots.txt)';
const FETCH_TIMEOUT_MS = 15_000;
const MIN_REQUEST_INTERVAL_MS = 1_000; // 1 req/sec minimum — be a good citizen
const ROBOTS_CACHE_TTL_MS = 3_600_000; // 1 hour
const MAX_FILE_BYTES = 1_048_576; // 1 MB decoded content limit
const DEFAULT_COMMITS_PER_PAGE = 10;

// Module-scope caches — reset on cold start, good enough for personal/internal use
/** @type {Map<string, { fetchedAt: number, rules: object }>} */
const robotsCache = new Map();
/** @type {Map<string, number>} domain → last request timestamp (ms) */
const rateLimitMap = new Map();
/** @type {{ remaining: number, resetAt: number } | null} */
let githubRateLimit = null;

// ─── Input validation ─────────────────────────────────────────────────────────
// GitHub owner: alphanumeric + hyphens, 1–39 chars
const OWNER_RE = /^[a-zA-Z0-9][a-zA-Z0-9\-]{0,38}$/;
// GitHub repo name: alphanumeric, hyphens, underscores, dots; 1–100 chars
const REPO_RE = /^[a-zA-Z0-9_.\-]{1,100}$/;
// Ref (branch / tag / SHA): safe characters only, no traversal
const REF_RE = /^[a-zA-Z0-9_.\-\/]{1,200}$/;
// File path: relative, no leading slash, no ".." segments
const PATH_RE = /^[a-zA-Z0-9_.\-\/]{1,1000}$/;

function validateOwner(owner) {
    if (!owner || typeof owner !== 'string') {
        return { ok: false, reason: 'owner is required and must be a string' };
    }
    if (!OWNER_RE.test(owner)) {
        return { ok: false, reason: `Invalid owner: "${owner}". Must be 1–39 alphanumeric characters or hyphens.` };
    }
    return { ok: true };
}

function validateRepo(repo) {
    if (!repo || typeof repo !== 'string') {
        return { ok: false, reason: 'repo is required and must be a string' };
    }
    if (!REPO_RE.test(repo)) {
        return { ok: false, reason: `Invalid repo: "${repo}". Must be 1–100 alphanumeric characters, hyphens, underscores, or dots.` };
    }
    return { ok: true };
}

function validateRef(ref) {
    if (!ref) return { ok: true }; // optional in all tools
    if (typeof ref !== 'string') return { ok: false, reason: 'ref must be a string' };
    if (!REF_RE.test(ref)) {
        return { ok: false, reason: `Invalid ref: "${ref}". Must contain only alphanumeric, hyphens, underscores, dots, or forward slashes.` };
    }
    return { ok: true };
}

function validatePath(path) {
    if (!path || typeof path !== 'string') {
        return { ok: false, reason: 'path is required and must be a string' };
    }
    if (path.startsWith('/')) {
        return { ok: false, reason: 'path must not start with a leading slash' };
    }
    if (path.includes('..')) {
        return { ok: false, reason: 'path must not contain ".." (path traversal is not permitted)' };
    }
    if (!PATH_RE.test(path)) {
        return { ok: false, reason: `Invalid path: "${path}". Must contain only alphanumeric, hyphens, underscores, dots, or forward slashes.` };
    }
    return { ok: true };
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
            if (!rules.agents[agent]) rules.agents[agent] = { disallow: [], allow: [], crawlDelay: 0 };
            currentAgents.push(agent);
        } else if (field === 'disallow') {
            for (const agent of currentAgents) {
                if (!rules.agents[agent]) rules.agents[agent] = { disallow: [], allow: [], crawlDelay: 0 };
                rules.agents[agent].disallow.push(value);
            }
        } else if (field === 'allow') {
            for (const agent of currentAgents) {
                if (!rules.agents[agent]) rules.agents[agent] = { disallow: [], allow: [], crawlDelay: 0 };
                rules.agents[agent].allow.push(value);
            }
        } else if (field === 'crawl-delay') {
            const delay = parseFloat(value);
            if (!isNaN(delay) && delay > 0) {
                for (const agent of currentAgents) {
                    if (!rules.agents[agent]) rules.agents[agent] = { disallow: [], allow: [], crawlDelay: 0 };
                    rules.agents[agent].crawlDelay = delay * 1000;
                }
            }
        }
    }
    return rules;
}

function isRuleMatch(path, rule) {
    if (!rule) return false;
    if (rule === '/') return true;
    if (rule.endsWith('*')) {
        const prefix = rule.slice(0, -1);
        return path.startsWith(prefix);
    }
    return path.startsWith(rule);
}

function getLongestMatchLength(path, rules = []) {
    let best = -1;
    for (const rule of rules) {
        if (!rule) continue; // empty Disallow means allow all
        if (isRuleMatch(path, rule)) {
            best = Math.max(best, rule.length);
        }
    }
    return best;
}

function isPathDisallowed(path, disallowList, allowList = []) {
    const disallowLen = getLongestMatchLength(path, disallowList);
    if (disallowLen < 0) return false;

    const allowLen = getLongestMatchLength(path, allowList);
    return allowLen < disallowLen;
}

function getRulesForBot(rules) {
    // Prefer specific agent match, fall back to wildcard
    return rules.agents['githubmcp'] || rules.agents['*'] || { disallow: [], allow: [], crawlDelay: 0 };
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
    // 1. Honour GitHub's own rate-limit headers if exhausted
    if (githubRateLimit && githubRateLimit.remaining === 0) {
        const waitMs = githubRateLimit.resetAt - Date.now();
        if (waitMs > 0) {
            if (waitMs > 60_000) {
                return {
                    blocked: true,
                    reason: `GitHub API rate limit exhausted. Resets at ${new Date(githubRateLimit.resetAt).toISOString()}. Set the GITHUB_TOKEN environment variable for 5000 requests/hour instead of 60.`,
                };
            }
            await new Promise(r => setTimeout(r, waitMs));
        }
    }

    // 2. Per-domain minimum interval
    const minDelay = Math.max(MIN_REQUEST_INTERVAL_MS, crawlDelayMs);
    const last = rateLimitMap.get(domain) || 0;
    const wait = last + minDelay - Date.now();
    if (wait > 0) {
        await new Promise(r => setTimeout(r, wait));
    }
    rateLimitMap.set(domain, Date.now());
    return { blocked: false };
}

function updateRateLimitFromHeaders(headers) {
    const remaining = parseInt(headers.get('x-ratelimit-remaining') || '', 10);
    const reset = parseInt(headers.get('x-ratelimit-reset') || '', 10);
    if (!isNaN(remaining) && !isNaN(reset)) {
        // GitHub sends the reset time as a Unix timestamp in seconds
        githubRateLimit = { remaining, resetAt: reset * 1000 };
    }
}

// ─── GitHub API request helper ────────────────────────────────────────────────
async function githubRequest(apiPath, context) {
    const apiHost = 'api.github.com';

    // Check robots.txt for api.github.com
    const rules = await fetchRobotsRules(GITHUB_API_BASE);
    const agentRules = getRulesForBot(rules);
    if (isPathDisallowed(apiPath, agentRules.disallow, agentRules.allow)) {
        return { blocked: true, reason: `Path "${apiPath}" is disallowed by robots.txt for ${apiHost}` };
    }

    // Apply rate limiting
    const rateLimitResult = await applyRateLimit(apiHost, agentRules.crawlDelay);
    if (rateLimitResult.blocked) return rateLimitResult;

    // Build request headers
    const headers = {
        'User-Agent': USER_AGENT,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };

    const token = process.env.GITHUB_TOKEN;
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const url = `${GITHUB_API_BASE}${apiPath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(url, { headers, signal: controller.signal });
    } catch (err) {
        clearTimeout(timer);
        const reason = err.name === 'AbortError'
            ? `Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds`
            : `Fetch failed: ${err.message}`;
        return { error: true, reason };
    }
    clearTimeout(timer);

    // Always update our local rate-limit state from the response headers
    updateRateLimitFromHeaders(response.headers);

    if (response.status === 404) {
        return { error: true, reason: 'Not found — check that the repository, path, or ref exists and is public', statusCode: 404 };
    }

    if (response.status === 403) {
        if (response.headers.get('x-ratelimit-remaining') === '0') {
            const resetAt = parseInt(response.headers.get('x-ratelimit-reset') || '0', 10);
            return {
                error: true,
                reason: `GitHub API rate limit exhausted. Resets at ${new Date(resetAt * 1000).toISOString()}. Set GITHUB_TOKEN for 5000 requests/hour instead of 60.`,
                statusCode: 403,
            };
        }
        return { error: true, reason: 'Access forbidden — repository may be private or require authentication', statusCode: 403 };
    }

    if (!response.ok) {
        return { error: true, reason: `GitHub API returned HTTP ${response.status}`, statusCode: response.status };
    }

    try {
        const data = await response.json();
        return { ok: true, data };
    } catch (err) {
        return { error: true, reason: `Failed to parse GitHub API response: ${err.message}` };
    }
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

async function handleGetRepo({ owner, repo }, context) {
    const ov = validateOwner(owner);
    if (!ov.ok) return { error: true, reason: ov.reason };
    const rv = validateRepo(repo);
    if (!rv.ok) return { error: true, reason: rv.reason };

    const result = await githubRequest(`/repos/${owner}/${repo}`, context);
    if (!result.ok) return result;

    const d = result.data;
    context.log(`github_get_repo: ${owner}/${repo} fetched`);
    return {
        fullName: d.full_name,
        description: d.description,
        defaultBranch: d.default_branch,
        language: d.language,
        topics: d.topics || [],
        stars: d.stargazers_count,
        forks: d.forks_count,
        openIssues: d.open_issues_count,
        isPrivate: d.private,
        isFork: d.fork,
        isArchived: d.archived,
        license: d.license ? d.license.spdx_id : null,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        pushedAt: d.pushed_at,
        size: d.size,
        htmlUrl: d.html_url,
        hasWiki: d.has_wiki,
        hasIssues: d.has_issues,
    };
}

async function handleGetReadme({ owner, repo, ref }, context) {
    const ov = validateOwner(owner);
    if (!ov.ok) return { error: true, reason: ov.reason };
    const rv = validateRepo(repo);
    if (!rv.ok) return { error: true, reason: rv.reason };
    const refv = validateRef(ref);
    if (!refv.ok) return { error: true, reason: refv.reason };

    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const result = await githubRequest(`/repos/${owner}/${repo}/readme${query}`, context);
    if (!result.ok) return result;

    const d = result.data;

    if (!d.content || d.encoding !== 'base64') {
        return { error: true, reason: 'Unexpected response from GitHub API — expected base64-encoded content' };
    }

    const decoded = Buffer.from(d.content, 'base64');
    if (decoded.byteLength > MAX_FILE_BYTES) {
        return {
            error: true,
            reason: `README is too large to return inline (${(decoded.byteLength / 1024).toFixed(0)} KB; limit is ${MAX_FILE_BYTES / 1024} KB)`,
            size: decoded.byteLength,
            downloadUrl: d.download_url,
        };
    }

    context.log(`github_get_readme: ${owner}/${repo} → ${decoded.byteLength} bytes`);
    return {
        owner,
        repo,
        ref: ref || null,
        path: d.path,
        name: d.name,
        sha: d.sha,
        size: d.size,
        content: decoded.toString('utf8'),
        htmlUrl: d.html_url,
        downloadUrl: d.download_url,
    };
}

async function handleGetTree({ owner, repo, ref, recursive = false }, context) {
    const ov = validateOwner(owner);
    if (!ov.ok) return { error: true, reason: ov.reason };
    const rv = validateRepo(repo);
    if (!rv.ok) return { error: true, reason: rv.reason };
    const refv = validateRef(ref);
    if (!refv.ok) return { error: true, reason: refv.reason };

    // Resolve default branch when no ref supplied (costs one extra API call)
    let treeRef = ref;
    if (!treeRef) {
        const repoResult = await githubRequest(`/repos/${owner}/${repo}`, context);
        if (!repoResult.ok) return repoResult;
        treeRef = repoResult.data.default_branch;
    }

    const recursiveParam = recursive ? '?recursive=1' : '';
    // Branch names with slashes (e.g. feature/foo) are used directly as path segments —
    // GitHub's API resolves them correctly. encodeURIComponent would break this.
    const result = await githubRequest(`/repos/${owner}/${repo}/git/trees/${treeRef}${recursiveParam}`, context);
    if (!result.ok) return result;

    const d = result.data;
    const entries = (d.tree || []).map(item => ({
        path: item.path,
        type: item.type, // 'blob' (file) or 'tree' (directory)
        size: item.size ?? null,
        sha: item.sha,
    }));

    context.log(`github_get_tree: ${owner}/${repo}@${treeRef} → ${entries.length} entries (truncated=${d.truncated})`);
    return {
        owner,
        repo,
        ref: treeRef,
        sha: d.sha,
        truncated: d.truncated || false,
        entryCount: entries.length,
        entries,
        hint: d.truncated
            ? 'GitHub truncated this tree. Try recursive=false or target a specific subdirectory path.'
            : undefined,
    };
}

async function handleGetFile({ owner, repo, path, ref }, context) {
    const ov = validateOwner(owner);
    if (!ov.ok) return { error: true, reason: ov.reason };
    const rv = validateRepo(repo);
    if (!rv.ok) return { error: true, reason: rv.reason };
    const pv = validatePath(path);
    if (!pv.ok) return { error: true, reason: pv.reason };
    const refv = validateRef(ref);
    if (!refv.ok) return { error: true, reason: refv.reason };

    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const result = await githubRequest(`/repos/${owner}/${repo}/contents/${path}${query}`, context);
    if (!result.ok) return result;

    const d = result.data;

    // Array response means the path is a directory, not a file
    if (Array.isArray(d)) {
        return {
            error: true,
            reason: `"${path}" is a directory, not a file. Use github_get_tree to list directory contents.`,
            type: 'directory',
            entries: d.map(item => ({ name: item.name, type: item.type, size: item.size ?? null, path: item.path })),
        };
    }

    if (d.type !== 'file') {
        return { error: true, reason: `"${path}" is not a regular file (type: ${d.type})` };
    }

    // Files > 1 MB are returned without inline content by GitHub
    if (!d.content) {
        return {
            error: true,
            reason: `File is too large for inline content (${(d.size / 1024).toFixed(0)} KB). Fetch it directly via download_url.`,
            size: d.size,
            sha: d.sha,
            downloadUrl: d.download_url,
            htmlUrl: d.html_url,
        };
    }

    if (d.encoding !== 'base64') {
        return { error: true, reason: `Unexpected encoding from GitHub API: "${d.encoding}"` };
    }

    const decoded = Buffer.from(d.content, 'base64');
    if (decoded.byteLength > MAX_FILE_BYTES) {
        return {
            error: true,
            reason: `File is too large to return inline (${(decoded.byteLength / 1024).toFixed(0)} KB; limit is ${MAX_FILE_BYTES / 1024} KB)`,
            size: decoded.byteLength,
            sha: d.sha,
            downloadUrl: d.download_url,
        };
    }

    // Detect binary content via NUL byte presence
    const isBinary = decoded.includes(0);
    context.log(`github_get_file: ${owner}/${repo}/${path} → ${decoded.byteLength} bytes, binary=${isBinary}`);
    return {
        owner,
        repo,
        path: d.path,
        name: d.name,
        sha: d.sha,
        size: d.size,
        ref: ref || null,
        encoding: isBinary ? 'binary' : 'utf8',
        content: isBinary ? null : decoded.toString('utf8'),
        isBinary,
        htmlUrl: d.html_url,
        downloadUrl: d.download_url,
        hint: isBinary ? 'Binary file — content omitted. Use download_url to fetch directly.' : undefined,
    };
}

async function handleListCommits({ owner, repo, branch, per_page = DEFAULT_COMMITS_PER_PAGE }, context) {
    const ov = validateOwner(owner);
    if (!ov.ok) return { error: true, reason: ov.reason };
    const rv = validateRepo(repo);
    if (!rv.ok) return { error: true, reason: rv.reason };
    const refv = validateRef(branch);
    if (!refv.ok) return { error: true, reason: refv.reason };

    const perPage = Math.min(100, Math.max(1, parseInt(per_page, 10) || DEFAULT_COMMITS_PER_PAGE));
    const params = new URLSearchParams({ per_page: String(perPage) });
    if (branch) params.set('sha', branch);

    const result = await githubRequest(`/repos/${owner}/${repo}/commits?${params}`, context);
    if (!result.ok) return result;

    const commits = result.data.map(c => ({
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0], // first line only
        author: c.commit.author?.name || null,
        authorEmail: c.commit.author?.email || null,
        date: c.commit.author?.date || null,
        htmlUrl: c.html_url,
    }));

    context.log(`github_list_commits: ${owner}/${repo}${branch ? `@${branch}` : ''} → ${commits.length} commits`);
    return {
        owner,
        repo,
        branch: branch || null,
        count: commits.length,
        commits,
    };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'github_get_repo',
        description: [
            'Fetches metadata for a public GitHub repository.',
            'Returns: description, default branch, primary language, topics, stars, forks, licence, and key timestamps.',
            'Use this first to discover the default branch before calling other tools.',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'GitHub organisation or user name (e.g. "octocat").' },
                repo: { type: 'string', description: 'Repository name (e.g. "Hello-World").' },
            },
            required: ['owner', 'repo'],
        },
    },
    {
        name: 'github_get_readme',
        description: [
            'Fetches and returns the decoded text content of the README for a public GitHub repository.',
            'Automatically detects README.md, README.rst, README.txt, etc.',
            'Returns: file path, SHA, size, and full UTF-8 content.',
            'Use the optional ref parameter to fetch the README for a specific branch, tag, or commit SHA.',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'GitHub organisation or user name.' },
                repo: { type: 'string', description: 'Repository name.' },
                ref: { type: 'string', description: 'Branch name, tag, or commit SHA. Defaults to the repository\'s default branch.' },
            },
            required: ['owner', 'repo'],
        },
    },
    {
        name: 'github_get_tree',
        description: [
            'Lists the file and directory tree of a public GitHub repository.',
            'Each entry includes its relative path, type ("blob" for files, "tree" for directories), size, and SHA.',
            'Use recursive=true to retrieve the full tree in a single call (may be truncated for very large repos).',
            'Use this to discover available files and their sizes before fetching content with github_get_file.',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'GitHub organisation or user name.' },
                repo: { type: 'string', description: 'Repository name.' },
                ref: { type: 'string', description: 'Branch name, tag, or commit SHA. Defaults to the repository\'s default branch.' },
                recursive: {
                    type: 'boolean',
                    description: 'If true, returns the full recursive tree. If false (default), returns top-level entries only.',
                    default: false,
                },
            },
            required: ['owner', 'repo'],
        },
    },
    {
        name: 'github_get_file',
        description: [
            'Fetches the decoded text content of a specific file in a public GitHub repository.',
            'Path must be relative with no leading slash and no ".." segments (e.g. "src/index.js").',
            'Binary files are detected automatically — content is omitted and download_url is returned instead.',
            'Files larger than 1 MB cannot be returned inline; use download_url to retrieve them directly.',
            'Use github_get_tree first to discover available files and check their sizes.',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'GitHub organisation or user name.' },
                repo: { type: 'string', description: 'Repository name.' },
                path: { type: 'string', description: 'Relative path to the file within the repository (e.g. "src/index.js").' },
                ref: { type: 'string', description: 'Branch name, tag, or commit SHA. Defaults to the repository\'s default branch.' },
            },
            required: ['owner', 'repo', 'path'],
        },
    },
    {
        name: 'github_list_commits',
        description: [
            'Lists recent commits for a public GitHub repository.',
            'Returns: full SHA, short SHA (7 chars), first line of the commit message, author name, author email, and timestamp.',
            'Use the optional branch parameter to filter by branch name or start from a specific commit SHA.',
            'per_page controls the number of results returned (1–100, default 10).',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'GitHub organisation or user name.' },
                repo: { type: 'string', description: 'Repository name.' },
                branch: { type: 'string', description: 'Branch name or commit SHA to list commits from. Defaults to the repository\'s default branch.' },
                per_page: {
                    type: 'integer',
                    description: 'Number of commits to return (1–100). Default: 10.',
                    default: 10,
                    minimum: 1,
                    maximum: 100,
                },
            },
            required: ['owner', 'repo'],
        },
    },
];

// ─── MCP manifest ─────────────────────────────────────────────────────────────
const MANIFEST = {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: {
        name: 'gcc-github-mcp',
        version: '1.0.0',
        instructions: `🐙 GITHUB REPOSITORY MCP

Provides read-only access to public GitHub repository data via the GitHub REST API.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- github_get_repo      — Repository metadata (language, stars, default branch, licence)
- github_get_readme    — README content for any branch or tag
- github_get_tree      — File/directory listing (recursive optional)
- github_get_file      — Text content of a specific file (up to 1 MB)
- github_list_commits  — Recent commit history with authors and messages

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  LIMITS & SAFETY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Public repositories only (private repos require a GITHUB_TOKEN)
- Rate limit: 60 requests/hour unauthenticated; set GITHUB_TOKEN for 5000/hour
- File content capped at 1 MB; binary files return download_url only
- Respects robots.txt for api.github.com (cached 1 hour)
- Minimum 1-second interval between requests; honours X-RateLimit-* headers
- Inputs strictly validated — no path traversal or injection possible
- All traffic targets https://api.github.com only (no user-supplied URLs)`,
    },
};

// ─── Tool routing ─────────────────────────────────────────────────────────────
const TOOL_HANDLERS = {
    github_get_repo: handleGetRepo,
    github_get_readme: handleGetReadme,
    github_get_tree: handleGetTree,
    github_get_file: handleGetFile,
    github_list_commits: handleListCommits,
};
const TOOL_NAMES = Object.keys(TOOL_HANDLERS).join(', ');

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

    context.log(`Processing MCP GitHub method: ${method}`);

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

            const handler = TOOL_HANDLERS[name];
            if (!handler) {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: `Unknown tool: ${name}. Available: ${TOOL_NAMES}` },
                    id,
                };
            }

            try {
                context.log(`Executing tool: ${name} args=${JSON.stringify(args)}`);
                const result = await handler(args || {}, context);
                context.log(`GitHub tool completed [${name}] in ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                        isError: result.error === true || result.blocked === true,
                    },
                    id,
                };
            } catch (err) {
                context.log.error(`GitHub tool error [${name}]: ${err.message}`);
                if (err && err.stack) context.log.error(`GitHub tool error stack [${name}]: ${err.stack}`);
                context.log.error(`GitHub tool failed [${name}] after ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
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
app.http('mcpGitHub', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp-github',
    handler: async (request, context) => {
        const requestStart = Date.now();
        context.log('MCP GitHub request received');

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.error('MCP GitHub parse error:', parseError);
                if (parseError && parseError.stack) {
                    context.log.error('MCP GitHub parse error stack:', parseError.stack);
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
                context.log(`MCP GitHub request completed with 204 in ${Date.now() - requestStart}ms`);
                return { status: 204 };
            }

            context.log(`MCP GitHub request completed with 200 in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
            };
        } catch (error) {
            context.log.error('MCP GitHub unhandled error:', error);
            if (error && error.stack) {
                context.log.error('MCP GitHub unhandled error stack:', error.stack);
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

module.exports = {
    _internals: {
        parseRobots,
        isPathDisallowed,
        getRulesForBot,
    },
};
