'use strict';

const { validateUrl, validateResourceUrl } = require('../url-guard');
const { checkFetchPolicy } = require('../../web-get/fetch-governance');
const snapshotStore = require('../snapshot-store');
const { createEnvironment, runAxe, extractPageModel, extractContrastElements, DEFAULT_TAGS } = require('../jsdom-evaluator');
const { extractColourDeclarations, extractFontDeclarations } = require('../css-analyser');
const { evaluationGovernance, errorGovernance } = require('../governance');
const { truncate } = require('../extraction');

const USER_AGENT = 'RenderedDOMMCP/1.0 (Azure Function MCP; respects robots.txt)';
const ROBOTS_BOT_NAME = 'RenderedDOMMCP';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_CSS_FILES = 15;
const MAX_CSS_BYTES = 500_000;
const MAX_JS_FILES = 8;
const MAX_JS_BYTES = 500_000;
const MAX_VIOLATIONS = 50;
const MAX_NODES_PER_VIOLATION = 10;

async function timedFetch(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchText(url, maxBytes) {
  const guard = validateResourceUrl(url);
  if (!guard.allowed) return null;
  try {
    const res = await timedFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const text = await res.text();
    return maxBytes ? text.substring(0, maxBytes) : text;
  } catch { return null; }
}

async function fetchLinkedCss(document, baseUrl) {
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))
    .slice(0, MAX_CSS_FILES);
  const results = await Promise.all(
    links.map(link => {
      try { return fetchText(new URL(link.getAttribute('href'), baseUrl).href, MAX_CSS_BYTES); }
      catch { return null; }
    })
  );
  return results.filter(Boolean);
}

async function fetchLinkedJs(document, baseUrl) {
  const scripts = Array.from(document.querySelectorAll('script[src]'))
    .slice(0, MAX_JS_FILES);
  const results = await Promise.all(
    scripts.map(s => {
      try { return fetchText(new URL(s.getAttribute('src'), baseUrl).href, MAX_JS_BYTES); }
      catch { return null; }
    })
  );
  return results.filter(Boolean);
}

function formatViolations(violations, maxViolations = MAX_VIOLATIONS) {
  return violations.slice(0, maxViolations).map(v => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    help: v.help,
    help_url: v.helpUrl,
    tags: v.tags,
    nodes: v.nodes.slice(0, MAX_NODES_PER_VIOLATION).map(n => ({
      target: n.target,
      html_excerpt: truncate(n.html, 400),
      failure_summary: truncate(n.failureSummary, 300),
      impact: n.impact,
    })),
    nodes_total: v.nodes.length,
  }));
}

async function runEvaluation({ html, cssStrings, jsStrings, baseUrl, sourceUrl, finalUrl, status, tags, maxTextChars, returnPasses }) {
  const { window, document } = createEnvironment({ html, cssStrings, jsStrings, baseUrl });
  try {
    return await runEvaluationInWindow({ window, document, html, cssStrings, jsStrings, baseUrl, sourceUrl, finalUrl, status, tags, maxTextChars, returnPasses });
  } finally {
    // Cancels any timers page JS scheduled and frees jsdom resources
    try { window.close(); } catch { /* already closed */ }
  }
}

async function runEvaluationInWindow({ window, document, html, cssStrings, jsStrings, baseUrl, sourceUrl, finalUrl, status, tags, maxTextChars, returnPasses }) {
  let axeResults;
  try {
    axeResults = await runAxe(window, tags);
  } catch (err) {
    return {
      error: { code: 'AXE_SCAN_FAILED', message: truncate(err.message, 300), retryable: true },
      governance: errorGovernance('jsdom_dom_evaluation'),
    };
  }

  const pageModel = extractPageModel(document, window, { maxTextChars });
  const contrastElements = extractContrastElements(axeResults.violations, axeResults.incomplete, document, window);
  const colourDeclarations = cssStrings.flatMap(css => extractColourDeclarations(css)).slice(0, 300);
  const fontDeclarations = cssStrings.flatMap(css => extractFontDeclarations(css)).slice(0, 200);

  const snapshotId = snapshotStore.create({ url: sourceUrl, finalUrl });
  // Store the evaluated DOM (CSS injected, JS applied) rather than the raw
  // input HTML so inspect_dom_selector sees the same document axe scanned.
  snapshotStore.setArtifact(snapshotId, 'html', '<!DOCTYPE html>\n' + document.documentElement.outerHTML);
  snapshotStore.setArtifact(snapshotId, 'page_model', pageModel);
  snapshotStore.setArtifact(snapshotId, 'axe_results', axeResults);

  const jsExecuted = jsStrings.length > 0;

  return {
    url: sourceUrl || baseUrl,
    final_url: finalUrl || baseUrl,
    status: status || null,
    title: document.title || null,
    evaluation: {
      engine: 'jsdom + axe-core',
      js_executed: jsExecuted,
      css_files_applied: cssStrings.length,
      js_files_executed: jsStrings.length,
      evaluated_at: new Date().toISOString(),
    },
    page_model: pageModel,
    axe: {
      violations: formatViolations(axeResults.violations),
      violations_total: axeResults.violations.length,
      violations_truncated: axeResults.violations.length > MAX_VIOLATIONS,
      incomplete: axeResults.incomplete.slice(0, 30).map(v => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.slice(0, 3).map(n => ({ target: n.target, html_excerpt: truncate(n.html, 300) })),
      })),
      passes_count: axeResults.passes.length,
      passes: returnPasses
        ? axeResults.passes.map(p => ({ id: p.id, description: p.description, nodes_count: p.nodes.length }))
        : [],
    },
    // Structured payload for the accessibility MCP
    accessibility_mcp_handoff: {
      elements_for_contrast_review: contrastElements,
      css_colour_declarations: colourDeclarations,
      css_font_declarations: fontDeclarations,
    },
    snapshot: { snapshot_id: snapshotId },
    governance: evaluationGovernance({ jsExecuted, cssApplied: cssStrings.length > 0 }),
    next_actions: [
      'Pass violations to accessibility MCP for WCAG interpretation.',
      'Pass elements_for_contrast_review to accessibility MCP for colour contrast assessment.',
      `Use inspect_dom_selector with snapshot_id='${snapshotId}' to examine specific components.`,
    ],
  };
}

/**
 * Fetches a URL, discovers linked CSS and JS, and runs the full evaluation pipeline.
 */
async function evaluatePage(args) {
  const {
    url,
    include_js = false,
    tags = DEFAULT_TAGS,
    max_text_chars = 8_000,
    return_passes = false,
  } = args || {};

  if (!url) return { error: { code: 'URL_INVALID', message: 'url is required.' } };

  const guard = validateUrl(url);
  if (!guard.allowed) {
    return {
      error: { code: guard.code, message: guard.message, retryable: false },
      governance: errorGovernance('jsdom_dom_evaluation'),
    };
  }

  // Same fetch governance as fetch_raw_html: robots.txt + per-domain rate limit
  const policy = await checkFetchPolicy(new URL(url), USER_AGENT, ROBOTS_BOT_NAME);
  if (!policy.allowed) {
    return {
      error: { code: 'ROBOTS_DISALLOWED', message: policy.reason, retryable: false },
      robots: policy.robots,
      governance: errorGovernance('jsdom_dom_evaluation'),
    };
  }

  // Fetch HTML
  let html, status, finalUrl;
  try {
    const res = await timedFetch(url, { headers: { 'User-Agent': USER_AGENT } });
    finalUrl = res.url;
    status = res.status;

    const redirectGuard = validateUrl(finalUrl);
    if (!redirectGuard.allowed) {
      return {
        error: { code: 'SSRF_BLOCKED', message: `Redirect target '${finalUrl}' is not in the allowed list.`, retryable: false },
        governance: errorGovernance('jsdom_dom_evaluation'),
      };
    }
    html = await res.text();
  } catch (err) {
    return {
      error: { code: 'NAVIGATION_FAILED', message: truncate(err.message, 300), retryable: true },
      governance: errorGovernance('jsdom_dom_evaluation'),
    };
  }

  // Discover linked resources using a lightweight parse
  const { JSDOM } = require('jsdom');
  const discoveryDom = new JSDOM(html, { url: finalUrl });
  const discoveryDoc = discoveryDom.window.document;

  const cssStrings = await fetchLinkedCss(discoveryDoc, finalUrl);
  const jsStrings = include_js ? await fetchLinkedJs(discoveryDoc, finalUrl) : [];
  discoveryDom.window.close();

  return runEvaluation({
    html, cssStrings, jsStrings,
    baseUrl: finalUrl,
    sourceUrl: url,
    finalUrl,
    status,
    tags,
    maxTextChars: max_text_chars,
    returnPasses: return_passes,
  });
}

module.exports = { evaluatePage, runEvaluation };
