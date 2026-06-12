'use strict';

const { withPage } = require('../browser-pool');
const snapshotStore = require('../snapshot-store');
const { extractNodes, truncate } = require('../extraction');
const { selectorFragmentGovernance, errorGovernance } = require('../governance');

async function inspectRenderedSelector(args) {
  const {
    snapshot_id,
    selector,
    include = ['html', 'computed_styles', 'accessible_names', 'bounding_boxes', 'states'],
    max_nodes = 80,
    max_html_chars = 12_000,
  } = args || {};

  if (!snapshot_id) {
    return { error: { code: 'SNAPSHOT_EXPIRED', message: 'snapshot_id is required.' } };
  }
  if (!selector) {
    return { error: { code: 'SELECTOR_INVALID', message: 'selector is required.' } };
  }

  const html = snapshotStore.getArtifact(snapshot_id, 'html');
  if (!html) {
    return {
      error: {
        code: 'SNAPSHOT_EXPIRED',
        message: `Snapshot '${snapshot_id}' not found or has expired. Re-capture with capture_rendered_page_model.`,
        retryable: false,
      },
      governance: errorGovernance('rendered_selector_fragment'),
    };
  }

  try {
    return await withPage({ viewport: 'desktop', resourceMode: 'fast', timeoutMs: 15_000 }, async (page) => {
      // Re-hydrate from stored HTML — no network needed
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      const result = await extractNodes(page, selector, {
        maxNodes: max_nodes,
        maxHtmlChars: max_html_chars,
        include,
      });

      if (result.error) {
        return {
          snapshot_id,
          selector,
          ...result,
          governance: errorGovernance('rendered_selector_fragment'),
        };
      }

      return {
        snapshot_id,
        selector,
        matches: result.matches,
        nodes: result.nodes,
        truncated: result.truncated,
        truncation_reason: result.truncation_reason,
        governance: selectorFragmentGovernance(result.matches),
      };
    });
  } catch (err) {
    return {
      error: { code: 'RENDER_FAILED', message: truncate(err.message, 300), retryable: true },
      governance: errorGovernance('rendered_selector_fragment'),
    };
  }
}

module.exports = { inspectRenderedSelector };
