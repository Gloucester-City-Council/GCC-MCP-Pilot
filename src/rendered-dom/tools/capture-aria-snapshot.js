'use strict';

const { withPage } = require('../browser-pool');
const snapshotStore = require('../snapshot-store');
const { truncate } = require('../extraction');
const { ariaSnapshotGovernance, errorGovernance } = require('../governance');

const MAX_ARIA_CHARS = 12_000;

async function captureAriaSnapshot(args) {
  const {
    snapshot_id,
    selector = null,
    depth = 8,
    max_chars = MAX_ARIA_CHARS,
  } = args || {};

  if (!snapshot_id) {
    return { error: { code: 'SNAPSHOT_EXPIRED', message: 'snapshot_id is required.' } };
  }

  const html = snapshotStore.getArtifact(snapshot_id, 'html');
  if (!html) {
    return {
      error: {
        code: 'SNAPSHOT_EXPIRED',
        message: `Snapshot '${snapshot_id}' not found or has expired. Re-capture with capture_rendered_page_model.`,
        retryable: false,
      },
      governance: errorGovernance('aria_snapshot'),
    };
  }

  try {
    return await withPage({ viewport: 'desktop', resourceMode: 'fast', timeoutMs: 15_000 }, async (page) => {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      let ariaText;
      try {
        const locator = selector ? page.locator(selector) : page.locator('html');
        ariaText = await locator.ariaSnapshot();
      } catch (ariaErr) {
        return {
          error: {
            code: 'AXE_SCAN_FAILED',
            message: `ARIA snapshot failed: ${truncate(ariaErr.message, 200)}. ` +
              'This may indicate ariaSnapshot() is not available in the installed Playwright version (requires 1.41+).',
            retryable: false,
          },
          governance: errorGovernance('aria_snapshot'),
        };
      }

      // Store the full ARIA snapshot for later retrieval
      const ariaId = snapshotStore.create({ url: null, finalUrl: null });
      snapshotStore.setArtifact(ariaId, 'aria_snapshot', ariaText);

      const cap = Math.min(max_chars, MAX_ARIA_CHARS);
      const truncated = ariaText.length > cap;

      return {
        snapshot_id,
        aria_snapshot_id: ariaId,
        selector: selector || 'html',
        aria_snapshot: truncate(ariaText, cap),
        truncated,
        truncation_reason: truncated
          ? `Output capped at ${cap} chars. Use a narrower selector or reduce depth.`
          : null,
        governance: ariaSnapshotGovernance(),
      };
    });
  } catch (err) {
    return {
      error: { code: 'RENDER_FAILED', message: truncate(err.message, 300), retryable: true },
      governance: errorGovernance('aria_snapshot'),
    };
  }
}

module.exports = { captureAriaSnapshot };
