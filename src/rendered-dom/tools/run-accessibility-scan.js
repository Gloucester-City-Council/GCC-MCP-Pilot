'use strict';

const { withPage } = require('../browser-pool');
const snapshotStore = require('../snapshot-store');
const { truncate } = require('../extraction');
const { accessibilityScanGovernance, errorGovernance } = require('../governance');

const MAX_NODES_PER_VIOLATION = 10;
const MAX_VIOLATIONS = 50;
const MAX_INCOMPLETE = 30;

const DEFAULT_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

function getAxeBuilder() {
  try {
    const { AxeBuilder } = require('@axe-core/playwright');
    return AxeBuilder;
  } catch {
    throw new Error('RENDER_FAILED: @axe-core/playwright is not installed. Run: npm install @axe-core/playwright');
  }
}

function summariseNodes(nodes) {
  return nodes.slice(0, MAX_NODES_PER_VIOLATION).map(n => ({
    target: n.target,
    html_excerpt: truncate(n.html, 500),
    failure_summary: truncate(n.failureSummary, 500),
    impact: n.impact,
  }));
}

async function runAccessibilityScan(args) {
  const {
    snapshot_id,
    selector = null,
    tags = DEFAULT_TAGS,
    return_passes = false,
    return_incomplete = true,
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
      governance: errorGovernance('automated_accessibility_scan'),
    };
  }

  let AxeBuilder;
  try {
    AxeBuilder = getAxeBuilder();
  } catch (err) {
    return {
      error: { code: 'AXE_SCAN_FAILED', message: err.message, retryable: false },
      governance: errorGovernance('automated_accessibility_scan'),
    };
  }

  try {
    return await withPage({ viewport: 'desktop', resourceMode: 'accurate', timeoutMs: 60_000 }, async (page) => {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      let builder = new AxeBuilder({ page });

      if (selector) builder = builder.include(selector);
      if (tags && tags.length) builder = builder.withTags(tags);

      let results;
      try {
        results = await builder.analyze();
      } catch (axeErr) {
        return {
          error: {
            code: 'AXE_SCAN_FAILED',
            message: truncate(axeErr.message, 300),
            retryable: true,
          },
          governance: errorGovernance('automated_accessibility_scan'),
        };
      }

      // Store raw axe results
      snapshotStore.setArtifact(snapshot_id, 'axe_results', results);

      const violations = results.violations.slice(0, MAX_VIOLATIONS).map(v => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        help_url: v.helpUrl,
        tags: v.tags,
        nodes: summariseNodes(v.nodes),
        nodes_total: v.nodes.length,
      }));

      const incomplete = return_incomplete
        ? results.incomplete.slice(0, MAX_INCOMPLETE).map(v => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          help: v.help,
          tags: v.tags,
          nodes: summariseNodes(v.nodes),
        }))
        : [];

      return {
        scan: {
          engine: 'axe-core',
          scope: selector ? `selector: ${selector}` : 'full page',
          tags_used: tags,
          violations,
          violations_total: results.violations.length,
          violations_truncated: results.violations.length > MAX_VIOLATIONS,
          incomplete,
          passes_count: results.passes.length,
          passes: return_passes
            ? results.passes.map(p => ({ id: p.id, description: p.description, nodes_count: p.nodes.length }))
            : [],
        },
        governance: accessibilityScanGovernance(),
      };
    });
  } catch (err) {
    return {
      error: { code: 'AXE_SCAN_FAILED', message: truncate(err.message, 300), retryable: true },
      governance: errorGovernance('automated_accessibility_scan'),
    };
  }
}

module.exports = { runAccessibilityScan };
