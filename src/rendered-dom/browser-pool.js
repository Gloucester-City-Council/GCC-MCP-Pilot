'use strict';

const MAX_CONCURRENT = 3;
const QUEUE_TIMEOUT_MS = 15_000;

let browser = null;
let launching = null;
let activeContexts = 0;
const queue = [];

const VIEWPORTS = {
  desktop: { width: 1366, height: 768 },
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
};

function resolveViewport(name) {
  return VIEWPORTS[name] || VIEWPORTS.desktop;
}

// Lazy-loads playwright so the module can be required even if playwright is absent.
function getChromium() {
  try {
    return require('playwright').chromium;
  } catch {
    throw new Error('RENDER_FAILED: playwright is not installed. Run: npm install playwright && npx playwright install chromium');
  }
}

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (launching) return launching;

  const chromium = getChromium();
  launching = chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  }).then(b => {
    browser = b;
    launching = null;
    return b;
  }).catch(err => {
    launching = null;
    throw err;
  });

  return launching;
}

async function waitForSlot() {
  if (activeContexts < MAX_CONCURRENT) return;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = queue.indexOf(resolve);
      if (idx !== -1) queue.splice(idx, 1);
      reject(new Error('BROWSER_POOL_EXHAUSTED: Too many concurrent captures. Try again shortly.'));
    }, QUEUE_TIMEOUT_MS);

    queue.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function releaseSlot() {
  activeContexts--;
  if (queue.length > 0) queue.shift()();
}

/**
 * Runs fn(page, context) inside a fresh browser context.
 * Always closes the context after fn resolves or rejects.
 *
 * options:
 *   viewport      - 'desktop' | 'mobile' | 'tablet' | { width, height }
 *   resourceMode  - 'accurate' | 'balanced' | 'fast'
 *   timeoutMs     - navigation timeout (default 30000)
 */
async function withPage(options, fn) {
  await waitForSlot();
  activeContexts++;

  const b = await getBrowser();
  const viewport = typeof options.viewport === 'string'
    ? resolveViewport(options.viewport)
    : (options.viewport || VIEWPORTS.desktop);
  const timeoutMs = options.timeoutMs || 30_000;

  const context = await b.newContext({
    viewport,
    userAgent: 'RenderedDOMMCP/1.0 (+https://gloucester.gov.uk; headless accessibility capture)',
    ignoreHTTPSErrors: false,
    javaScriptEnabled: true,
    permissions: [],
    geolocation: null,
  });
  context.setDefaultTimeout(timeoutMs);
  context.setDefaultNavigationTimeout(timeoutMs);

  const page = await context.newPage();
  await applyResourceBlocking(page, options.resourceMode || 'balanced');

  try {
    return await fn(page, context);
  } finally {
    try { await context.close(); } catch { /* ignore close errors */ }
    releaseSlot();
  }
}

const BLOCK_BY_MODE = {
  accurate: [],
  balanced: ['media'],
  fast: ['media', 'image', 'font'],
};

const TRACKER_PATTERNS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  '/analytics.js', '/gtag/', 'hotjar.com', 'clarity.ms',
];

async function applyResourceBlocking(page, mode) {
  const blockedTypes = new Set(BLOCK_BY_MODE[mode] || BLOCK_BY_MODE.balanced);

  await page.route('**/*', route => {
    const type = route.request().resourceType();
    if (blockedTypes.has(type)) return route.abort();

    const url = route.request().url();
    if (TRACKER_PATTERNS.some(p => url.includes(p))) return route.abort();

    return route.continue();
  });
}

async function closeBrowser() {
  if (browser) { await browser.close(); browser = null; }
}

module.exports = { withPage, closeBrowser, resolveViewport };
