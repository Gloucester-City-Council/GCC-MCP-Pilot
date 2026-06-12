'use strict';

/**
 * Shared fetch governance for the web-get MCP tools.
 *
 * Both fetch_raw_html and evaluate_page apply the same policy before
 * fetching a page: respect robots.txt (wildcard + tool-specific user-agent
 * rules) and enforce a minimum per-domain crawl delay. The rate-limit map
 * is shared, so back-to-back calls from different tools to the same domain
 * still observe the delay.
 */

const MIN_CRAWL_DELAY_MS = 2_000;
const ROBOTS_CACHE_TTL_MS = 3_600_000; // 1 hour
const ROBOTS_FETCH_TIMEOUT_MS = 5_000;

// Module-scope caches — reset on cold start, good enough for personal/internal use
/** @type {Map<string, { fetchedAt: number, rules: object }>} */
const robotsCache = new Map();
/** @type {Map<string, number>} domain → last fetch timestamp (ms) */
const rateLimitMap = new Map();

// ─── robots.txt parsing ───────────────────────────────────────────────────────
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

function getRulesForBot(rules, botName) {
    // Prefer specific agent match, fall back to wildcard
    return rules.agents[botName.toLowerCase()] || rules.agents['*'] || { disallow: [], crawlDelay: 0 };
}

async function fetchRobotsRules(origin, userAgent) {
    const cached = robotsCache.get(origin);
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL_MS) {
        return cached.rules;
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ROBOTS_FETCH_TIMEOUT_MS);
        const res = await fetch(`${origin}/robots.txt`, {
            headers: { 'User-Agent': userAgent },
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
    return {
        waitMs: Math.max(wait, 0),
        minDelayMs: minDelay,
    };
}

/**
 * Combined pre-fetch check for a page URL: robots.txt + per-domain rate limit.
 *
 * @param {URL} parsed - parsed target URL
 * @param {string} userAgent - full User-Agent header value for the robots.txt fetch
 * @param {string} botName - short bot token to match in robots.txt user-agent rules
 * @returns {{ allowed: boolean, reason?: string, robots: object, rateLimit?: object }}
 */
async function checkFetchPolicy(parsed, userAgent, botName) {
    const origin = `${parsed.protocol}//${parsed.host}`;
    const rules = await fetchRobotsRules(origin, userAgent);
    const agentRules = getRulesForBot(rules, botName);
    const robots = {
        checked: true,
        origin,
        userAgent: botName,
        disallowRuleCount: Array.isArray(agentRules.disallow) ? agentRules.disallow.length : 0,
    };

    const path = parsed.pathname || '/';
    if (isPathDisallowed(path, agentRules.disallow)) {
        return {
            allowed: false,
            reason: `Path "${path}" is disallowed by robots.txt`,
            robots,
        };
    }

    const rateLimit = await applyRateLimit(parsed.hostname, agentRules.crawlDelay);
    return { allowed: true, robots, rateLimit };
}

module.exports = {
    MIN_CRAWL_DELAY_MS,
    parseRobots,
    isPathDisallowed,
    getRulesForBot,
    fetchRobotsRules,
    applyRateLimit,
    checkFetchPolicy,
};
