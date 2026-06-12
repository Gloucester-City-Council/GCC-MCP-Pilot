'use strict';

const snapshotStore = require('../snapshot-store');
const { createEnvironment, extractNodes } = require('../jsdom-evaluator');
const { selectorGovernance, errorGovernance } = require('../governance');
const { truncate } = require('../extraction');

/**
 * Inspects a CSS selector against a previously stored evaluation snapshot.
 * Returns accessible names, computed styles, attributes, and HTML excerpts
 * for the matched nodes — structured for handoff to the accessibility MCP.
 */
async function inspectDomSelector(args) {
  const {
    snapshot_id,
    selector,
    include = ['html', 'computed_styles', 'accessible_names', 'states'],
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
        message: `Snapshot '${snapshot_id}' not found or has expired (15-minute TTL). Re-run evaluate_page or evaluate_dom_bundle.`,
        retryable: false,
      },
      governance: errorGovernance('jsdom_selector_inspection'),
    };
  }

  const metadata = snapshotStore.getMetadata(snapshot_id);

  try {
    const { window, document } = createEnvironment({
      html, // serialized post-evaluation DOM — CSS <style> tags are baked in, JS effects applied
      cssStrings: [],
      jsStrings: [],
      baseUrl: metadata?.url || 'https://example.com',
    });

    let result;
    try {
      result = extractNodes(document, window, selector, {
        maxNodes: max_nodes,
        maxHtmlChars: max_html_chars,
        include,
      });
    } finally {
      try { window.close(); } catch { /* already closed */ }
    }

    if (result.error) {
      return {
        snapshot_id,
        selector,
        ...result,
        governance: errorGovernance('jsdom_selector_inspection'),
      };
    }

    return {
      snapshot_id,
      selector,
      matches: result.matches,
      nodes: result.nodes,
      truncated: result.truncated,
      truncation_reason: result.truncation_reason,
      governance: selectorGovernance(result.matches),
    };
  } catch (err) {
    return {
      error: { code: 'AXE_SCAN_FAILED', message: truncate(err.message, 300), retryable: true },
      governance: errorGovernance('jsdom_selector_inspection'),
    };
  }
}

module.exports = { inspectDomSelector };
