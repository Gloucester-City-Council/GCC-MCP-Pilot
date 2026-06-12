'use strict';

/**
 * Installs the Playwright Chromium browser binary after `npm install`.
 *
 * Skipped automatically in GitHub Actions (CI=true) because all tests mock
 * Playwright — no real browser is needed for the test suite.
 *
 * Runs in Azure Kudu during deployment (CI is not set there), so Chromium
 * is available when the function app starts.
 *
 * Set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 to skip in any environment.
 */

const { execSync } = require('child_process');

const isCI = process.env.CI === 'true';
const isSkipped = process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1';

if (isCI || isSkipped) {
  console.log('[playwright-install] Skipping Chromium download (CI or PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).');
  process.exit(0);
}

console.log('[playwright-install] Installing Chromium for Rendered DOM MCP...');

try {
  execSync('npx playwright install chromium', { stdio: 'inherit' });
  console.log('[playwright-install] Chromium installed successfully.');
} catch (err) {
  // Non-fatal: deployment must not fail because of this.
  // The Rendered DOM MCP tools return RENDER_FAILED errors if the browser
  // is unavailable, rather than crashing the entire function app.
  console.error('[playwright-install] Chromium install failed:', err.message);
  console.error('[playwright-install] Rendered DOM MCP tools will return RENDER_FAILED until Chromium is available.');
  process.exit(0);
}
