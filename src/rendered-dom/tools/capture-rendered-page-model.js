'use strict';

const { withPage } = require('../browser-pool');
const { validateUrl } = require('../url-guard');
const snapshotStore = require('../snapshot-store');
const { collectDiagnostics, extractPageModel, truncate } = require('../extraction');
const { renderedSnapshotGovernance, errorGovernance } = require('../governance');

const ARIA_MAX_CHARS = 12_000;
const VALID_WAIT_UNTIL = new Set(['load', 'domcontentloaded', 'networkidle']);

async function captureRenderedPageModel(args) {
  const {
    url,
    viewport = 'desktop',
    wait_until = 'networkidle',
    wait_for_selector = null,
    max_text_chars = 8_000,
    include_aria_snapshot = true,
    resource_mode = 'balanced',
    timeout_ms = 30_000,
  } = args || {};

  if (!url) {
    return { error: { code: 'URL_INVALID', message: 'url is required.' } };
  }

  const guard = validateUrl(url);
  if (!guard.allowed) {
    return {
      error: { code: guard.code, message: guard.message, retryable: false },
      governance: errorGovernance('rendered_browser_snapshot'),
    };
  }

  const waitUntil = VALID_WAIT_UNTIL.has(wait_until) ? wait_until : 'networkidle';

  try {
    return await withPage(
      { viewport, resourceMode: resource_mode, timeoutMs: timeout_ms },
      async (page) => {
        const diagnostics = collectDiagnostics(page);

        let response;
        try {
          response = await page.goto(url, { waitUntil, timeout: timeout_ms });
          if (wait_for_selector) {
            await page.waitForSelector(wait_for_selector, { timeout: timeout_ms });
          }
        } catch (navErr) {
          const isTimeout = navErr.message.toLowerCase().includes('timeout');
          return {
            error: {
              code: isTimeout ? 'NAVIGATION_TIMEOUT' : 'NAVIGATION_FAILED',
              message: truncate(navErr.message, 300),
              retryable: true,
              suggested_next_action: isTimeout
                ? "Retry with wait_until='domcontentloaded' or set wait_for_selector to a stable element."
                : 'Check if the URL is reachable and the domain is in the allowed list.',
            },
            governance: errorGovernance('rendered_browser_snapshot'),
          };
        }

        const finalUrl = page.url();
        const status = response?.status() ?? null;
        const title = await page.title();

        // Store raw HTML — heavy artefact behind snapshot ID
        const snapshotId = snapshotStore.create({ url, finalUrl });
        const renderedHtml = await page.content();
        snapshotStore.setArtifact(snapshotId, 'html', renderedHtml);

        // Extract compact page model
        const pageModel = await extractPageModel(page, { maxTextChars: max_text_chars });
        snapshotStore.setArtifact(snapshotId, 'page_model', pageModel);

        // Optional ARIA snapshot
        const ariaData = { aria_snapshot_id: null, aria_snapshot_excerpt: null, aria_snapshot_truncated: false };
        if (include_aria_snapshot) {
          try {
            const ariaText = await page.locator('html').ariaSnapshot();
            const ariaId = snapshotStore.create({ url, finalUrl });
            snapshotStore.setArtifact(ariaId, 'aria_snapshot', ariaText);
            ariaData.aria_snapshot_id = ariaId;
            ariaData.aria_snapshot_excerpt = truncate(ariaText, ARIA_MAX_CHARS);
            ariaData.aria_snapshot_truncated = ariaText.length > ARIA_MAX_CHARS;
          } catch {
            // ariaSnapshot not available in this playwright version — silent fail
          }
        }

        return {
          url,
          final_url: finalUrl,
          status,
          title,
          rendering: {
            engine: 'chromium',
            mode: 'headless',
            viewport: typeof viewport === 'string' ? viewport : 'custom',
            wait_until: waitUntil,
            resource_mode,
            captured_at: new Date().toISOString(),
          },
          page_model: pageModel,
          accessibility: ariaData,
          diagnostics: diagnostics.flush(),
          snapshot: {
            snapshot_id: snapshotId,
            type: 'rendered_browser',
          },
          governance: renderedSnapshotGovernance(),
          next_actions: [
            "Use inspect_rendered_selector with selector='nav' to examine navigation.",
            "Use inspect_rendered_selector with selector='main' to examine main content.",
            'Use run_accessibility_scan to scan for WCAG violations.',
            'Use capture_aria_snapshot for a targeted ARIA tree of a specific component.',
          ],
        };
      }
    );
  } catch (err) {
    const code = err.message.includes('BROWSER_POOL_EXHAUSTED') ? 'BROWSER_POOL_EXHAUSTED'
      : err.message.includes('RENDER_FAILED') ? 'RENDER_FAILED'
      : 'RENDER_FAILED';
    return {
      error: { code, message: truncate(err.message, 300), retryable: code !== 'BROWSER_POOL_EXHAUSTED' },
      governance: errorGovernance('rendered_browser_snapshot'),
    };
  }
}

module.exports = { captureRenderedPageModel };
