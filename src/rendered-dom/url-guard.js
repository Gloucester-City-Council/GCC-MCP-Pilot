'use strict';

// Origins permitted for headless browser capture.
// Add entries here as the pilot expands scope.
const ALLOWED_ORIGINS = [
  'https://careers.gloucester.gov.uk',
  'https://www.gloucester.gov.uk',
  'https://gloucester.gov.uk',
  'https://staging.gloucester.gov.uk',
  'https://example.com',  // safe smoke-test target
];

const PRIVATE_IP_RE =
  /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|127\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+|::1|0\.0\.0\.0)$/;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',
  'metadata.azure.com',
  'metadata.azure.internal',
]);

/**
 * Validates a URL against the allowlist and SSRF guard.
 * Returns { allowed: true } or { allowed: false, code, message }.
 */
function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { allowed: false, code: 'URL_INVALID', message: 'url must be a non-empty string.' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, code: 'URL_INVALID', message: 'Could not parse URL.' };
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    return { allowed: false, code: 'URL_NOT_ALLOWED', message: `Protocol '${parsed.protocol}' is not permitted. Use https or http.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { allowed: false, code: 'SSRF_BLOCKED', message: `Requests to '${hostname}' are not permitted.` };
  }

  if (PRIVATE_IP_RE.test(hostname)) {
    return { allowed: false, code: 'SSRF_BLOCKED', message: 'Requests to private IP ranges are not permitted.' };
  }

  // Cloud instance metadata endpoints
  if (hostname === '169.254.169.254' || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    return { allowed: false, code: 'SSRF_BLOCKED', message: 'Requests to internal/metadata endpoints are not permitted.' };
  }

  const origin = `${parsed.protocol}//${parsed.host}`;
  const permitted = ALLOWED_ORIGINS.some(allowed =>
    origin === allowed || origin.startsWith(allowed + '/')
  );

  if (!permitted) {
    return {
      allowed: false,
      code: 'URL_NOT_ALLOWED',
      message: `Origin '${origin}' is not in the allowed list. Permitted origins: ${ALLOWED_ORIGINS.join(', ')}`,
    };
  }

  return { allowed: true };
}

module.exports = { validateUrl, ALLOWED_ORIGINS };
