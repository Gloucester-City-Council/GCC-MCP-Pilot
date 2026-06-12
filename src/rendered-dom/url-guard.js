'use strict';

/**
 * Optional origin allowlist for evaluate_page, read from the
 * EVALUATE_PAGE_ALLOWED_ORIGINS app setting (comma-separated origins,
 * e.g. "https://www.gloucester.gov.uk,https://careers.gloucester.gov.uk").
 *
 * Unset or empty (the default) means no allowlist: any public http(s) URL
 * is permitted, governed by the same SSRF guard, robots.txt respect, and
 * per-domain rate limiting as fetch_raw_html. Read at call time so the
 * setting can be changed in Azure without a redeploy.
 */
function getAllowedOrigins() {
  const raw = process.env.EVALUATE_PAGE_ALLOWED_ORIGINS || '';
  return raw
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

const PRIVATE_IP_RE =
  /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|127\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+|::1|0\.0\.0\.0)$/;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',
  'metadata.azure.com',
  'metadata.azure.internal',
]);

function ssrfCheck(hostname) {
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { blocked: true, code: 'SSRF_BLOCKED', message: `Requests to '${hostname}' are not permitted.` };
  }
  if (PRIVATE_IP_RE.test(hostname)) {
    return { blocked: true, code: 'SSRF_BLOCKED', message: 'Requests to private IP ranges are not permitted.' };
  }
  if (hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    return { blocked: true, code: 'SSRF_BLOCKED', message: 'Requests to internal endpoints are not permitted.' };
  }
  return { blocked: false };
}

/**
 * Full validation: SSRF check + allowlist.
 * Use for the primary page URL.
 */
function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { allowed: false, code: 'URL_INVALID', message: 'url must be a non-empty string.' };
  }
  let parsed;
  try { parsed = new URL(url); } catch {
    return { allowed: false, code: 'URL_INVALID', message: 'Could not parse URL.' };
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    return { allowed: false, code: 'URL_NOT_ALLOWED', message: `Protocol '${parsed.protocol}' is not permitted.` };
  }

  const ssrf = ssrfCheck(parsed.hostname.toLowerCase());
  if (ssrf.blocked) return { allowed: false, code: ssrf.code, message: ssrf.message };

  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.length > 0) {
    const origin = `${parsed.protocol}//${parsed.host}`;
    if (!allowedOrigins.some(o => origin === o || origin.startsWith(o + '/'))) {
      return {
        allowed: false,
        code: 'URL_NOT_ALLOWED',
        message: `Origin '${origin}' is not in the allowed list. Permitted: ${allowedOrigins.join(', ')}`,
      };
    }
  }
  return { allowed: true };
}

/**
 * SSRF-only validation — no allowlist.
 * Use for linked CSS / JS resources (CDNs are legitimate).
 */
function validateResourceUrl(url) {
  if (!url || typeof url !== 'string') return { allowed: false, code: 'URL_INVALID', message: 'Invalid URL.' };
  let parsed;
  try { parsed = new URL(url); } catch {
    return { allowed: false, code: 'URL_INVALID', message: 'Could not parse resource URL.' };
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    return { allowed: false, code: 'URL_NOT_ALLOWED', message: 'Resource URL must use http or https.' };
  }
  const ssrf = ssrfCheck(parsed.hostname.toLowerCase());
  if (ssrf.blocked) return { allowed: false, code: ssrf.code, message: ssrf.message };
  return { allowed: true };
}

module.exports = { validateUrl, validateResourceUrl, getAllowedOrigins };
