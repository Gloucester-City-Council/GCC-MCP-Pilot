'use strict';

/**
 * Browser pool for the Rendered DOM MCP.
 *
 * Supports two modes, selected by environment variable:
 *
 *   RENDERED_DOM_BROWSER_WS_URL is SET (required for Windows / Consumption plan)
 *     Connects to a remote Chromium instance via Chrome DevTools Protocol (CDP).
 *     The remote browser must expose a WebSocket CDP endpoint, e.g.:
 *       - Browserless SaaS:   wss://chrome.browserless.io?token=YOUR_TOKEN
 *       - Self-hosted Browserless on Azure Container Apps:
 *                             wss://your-app.region.azurecontainerapps.io?token=TOKEN
 *     Context isolation still works: each request gets its own browser context.
 *     Do NOT set this on local Linux dev — local launch is faster there.
 *
 *   RENDERED_DOM_BROWSER_WS_URL is NOT SET (Linux App Service plan or local dev)
 *     Launches a local headless Chromium process. Requires `playwright` and
 *     `npx playwright install chromium` to have run in the environment.
 */

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

function getChromium() {
  try {
    return require('playwright').chromium;
  } catch {
    throw new Error('RENDER_FAILED: playwright is not installed. Run: npm install playwright');
  }
}

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (launching) return launching;

  const chromium = getChromium();
  const wsEndpoint = process.env.RENDERED_DOM_BROWSER_WS_URL || null;

  if (wsEndpoint) {
    // Remote browser — Windows / Consumption plan path
    launching = chromium.connectOverCDP(wsEndpoint).then(b => {
      browser = b;
      launching = null;
      return b;
    }).catch(err => {
      launching = null;
      const hint = 'Check RENDERED_DOM_BROWSER_WS_URL in Azure App Settings points to a running Browserless instance.';
      throw new Error(`RENDER_FAILED: Remote browser connection failed. ${hint} (${err.message})`);
    });
  } else {
    // Local browser — Linux App Service or local dev
    launching = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    }).then(b => {
      browser = b;
      launching = null;
      return b;
    }).catch(err => {
      launching = null;
      throw new Error(`RENDER_FAILED: Local browser launch failed. ${err.message}`);
    });
  }

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
 * Runs fn(page, context) inside a fresh isolated browser context.
 * Always closes the context after fn resolves or rejects.
 * Never closes the browser itself (remote browsers are shared).
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
  });
  context.setDefaultTimeout(timeoutMs);
  context.setDefaultNavigationTimeout(timeoutMs);

  const page = await context.newPage();

  // Resource blocking — may be silently skipped if the remote browser
  // does not support request interception at the CDP level.
  try {
    await applyResourceBlocking(page, options.resourceMode || 'balanced');
  } catch { /* non-fatal: proceed without blocking */ }

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
  // Only close local browser processes — never close a remote connection.
  if (browser && !process.env.RENDERED_DOM_BROWSER_WS_URL) {
    await browser.close();
    browser = null;
  }
}

module.exports = { withPage, closeBrowser, resolveViewport };
