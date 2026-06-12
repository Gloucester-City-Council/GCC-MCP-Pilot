'use strict';

const { validateUrl, validateResourceUrl } = require('../url-guard');
const { checkFetchPolicy } = require('../../web-get/fetch-governance');
const snapshotStore = require('../snapshot-store');
const {
  createEnvironment, runAxe, extractPageModel, extractContrastElements,
  suggestComponentSelectors, DEFAULT_TAGS,
} = require('../jsdom-evaluator');
const {
  extractColourDeclarations, extractFontDeclarations, extractStyleAttributeDeclarations,
} = require('../css-analyser');
const { isKnownStandard, tagsForStandard, buildCoverage, STANDARDS } = require('../wcag-standards');
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
const MAX_DECLARATIONS = 300;
const MAX_FONT_DECLARATIONS = 200;

// Output contract versioning — bump when the result shape or extraction
// rules change, so historic results can be interpreted downstream.
const EVALUATION_SCHEMA_VERSION = 'web-get-evaluation-v1';
const TOOL_VERSION = '2.1.0';

let jsdomVersion = null;
try { jsdomVersion = require('jsdom/package.json').version; } catch { /* exports map may hide it */ }

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
  const allScripts = document.querySelectorAll('script[src]');
  const scripts = Array.from(allScripts).slice(0, MAX_JS_FILES);
  const results = await Promise.all(
    scripts.map(s => {
      try { return fetchText(new URL(s.getAttribute('src'), baseUrl).href, MAX_JS_BYTES); }
      catch { return null; }
    })
  );
  const fetched = results.filter(Boolean);
  return {
    scripts: fetched,
    audit: {
      linked_scripts_found: allScripts.length,
      attempted: scripts.length,
      fetched: fetched.length,
      fetch_failed_or_blocked: scripts.length - fetched.length,
    },
  };
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

/**
 * Quality-gate evaluation: which violations trip the caller's fail_on policy.
 */
function buildGate(axeResults, failOn) {
  const failingImpacts = ['critical', 'serious', 'moderate', 'minor'].filter(i => failOn[i]);
  const failing = axeResults.violations.filter(v => failingImpacts.includes(v.impact));
  const incompleteCount = failOn.incomplete ? axeResults.incomplete.length : 0;
  return {
    failed: failing.length > 0 || incompleteCount > 0,
    fail_on: failOn,
    failing_violations: failing.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
    incomplete_counted: failOn.incomplete ? axeResults.incomplete.length : null,
  };
}

/**
 * Compares this run's violations to a previous snapshot's axe results.
 * Rule-id granularity — enough to gate "did this change make things worse".
 */
function buildRegression(baselineId, axeResults) {
  const baseline = snapshotStore.getArtifact(baselineId, 'axe_results');
  if (!baseline || !Array.isArray(baseline.violations)) {
    return {
      error: {
        code: 'BASELINE_NOT_FOUND',
        message: `Baseline snapshot '${baselineId}' not found or expired (15-minute TTL). Run the baseline evaluation first in the same session.`,
      },
    };
  }
  const currentIds = new Set(axeResults.violations.map(v => v.id));
  const baseIds = new Set(baseline.violations.map(v => v.id));
  const newIds = [...currentIds].filter(id => !baseIds.has(id));
  const resolvedIds = [...baseIds].filter(id => !currentIds.has(id));
  const unchangedIds = [...currentIds].filter(id => baseIds.has(id));
  return {
    baseline_id: baselineId,
    new_violations: newIds.length,
    resolved_violations: resolvedIds.length,
    unchanged_violations: unchangedIds.length,
    new_violation_ids: newIds,
    resolved_violation_ids: resolvedIds,
  };
}

/**
 * Validates the standard / fail_on inputs shared by both evaluation tools.
 * Returns an error result object, or null when inputs are fine.
 */
function validateEvaluationOptions({ standard, failOn }) {
  if (standard !== undefined && standard !== null && !isKnownStandard(standard)) {
    return {
      error: {
        code: 'STANDARD_UNKNOWN',
        message: `Unknown standard '${standard}'. Supported: ${Object.keys(STANDARDS).join(', ')}`,
        retryable: false,
      },
    };
  }
  if (failOn !== undefined && failOn !== null && (typeof failOn !== 'object' || Array.isArray(failOn))) {
    return {
      error: {
        code: 'FAIL_ON_INVALID',
        message: 'fail_on must be an object of booleans, e.g. { "critical": true, "serious": true }.',
        retryable: false,
      },
    };
  }
  return null;
}

async function runEvaluation(params) {
  const optionError = validateEvaluationOptions(params);
  if (optionError) {
    return { ...optionError, governance: errorGovernance('jsdom_dom_evaluation') };
  }

  const { html, cssStrings, jsStrings, baseUrl } = params;
  const { window, document, jsAudit } = createEnvironment({ html, cssStrings, jsStrings, baseUrl });
  try {
    return await runEvaluationInWindow({ ...params, window, document, jsAudit });
  } finally {
    // Cancels any timers page JS scheduled and frees jsdom resources
    try { window.close(); } catch { /* already closed */ }
  }
}

async function runEvaluationInWindow({
  window, document, jsAudit,
  cssStrings, jsStrings, baseUrl, sourceUrl, finalUrl, status,
  tags, standard, failOn, baselineId, cssSource = 'linked_stylesheet',
  fetchAudit = null, maxTextChars, returnPasses,
}) {
  // A named standard decides the axe tags; explicit tags otherwise.
  const effectiveTags = standard ? tagsForStandard(standard) : (tags || DEFAULT_TAGS);

  let axeResults;
  try {
    axeResults = await runAxe(window, effectiveTags);
  } catch (err) {
    return {
      error: { code: 'AXE_SCAN_FAILED', message: truncate(err.message, 300), retryable: true },
      governance: errorGovernance('jsdom_dom_evaluation'),
    };
  }

  const pageModel = extractPageModel(document, window, { maxTextChars });
  const contrastElements = extractContrastElements(axeResults.violations, axeResults.incomplete, document, window);

  // CSS declarations from every source the page actually used:
  // fetched/supplied stylesheets, page-authored <style> blocks, and
  // style="" attributes (which never appear in any stylesheet).
  const inlineStyleBlocks = Array.from(document.querySelectorAll('style:not([data-mcp-injected])'))
    .map(s => s.textContent)
    .filter(Boolean);
  const styleAttr = extractStyleAttributeDeclarations(document);
  const colourDeclarations = [
    ...cssStrings.flatMap(css => extractColourDeclarations(css, cssSource)),
    ...inlineStyleBlocks.flatMap(css => extractColourDeclarations(css, 'inline_style_block')),
    ...styleAttr.colour,
  ].slice(0, MAX_DECLARATIONS);
  const fontDeclarations = [
    ...cssStrings.flatMap(css => extractFontDeclarations(css, cssSource)),
    ...inlineStyleBlocks.flatMap(css => extractFontDeclarations(css, 'inline_style_block')),
    ...styleAttr.font,
  ].slice(0, MAX_FONT_DECLARATIONS);

  const snapshotId = snapshotStore.create({ url: sourceUrl, finalUrl });
  // Store the evaluated DOM (CSS injected, JS applied) rather than the raw
  // input HTML so inspect_dom_selector sees the same document axe scanned.
  snapshotStore.setArtifact(snapshotId, 'html', '<!DOCTYPE html>\n' + document.documentElement.outerHTML);
  snapshotStore.setArtifact(snapshotId, 'page_model', pageModel);
  snapshotStore.setArtifact(snapshotId, 'axe_results', axeResults);

  const jsExecuted = jsStrings.length > 0;

  const result = {
    schema_version: EVALUATION_SCHEMA_VERSION,
    url: sourceUrl || baseUrl,
    final_url: finalUrl || baseUrl,
    status: status || null,
    title: document.title || null,
    evaluation: {
      engine: 'jsdom + axe-core',
      tool_version: TOOL_VERSION,
      axe_version: axeResults.testEngine?.version || null,
      jsdom_version: jsdomVersion,
      js_executed: jsExecuted,
      css_files_applied: cssStrings.length,
      js_files_executed: jsStrings.length,
      tags_run: effectiveTags,
      evaluated_at: new Date().toISOString(),
    },
    page_model: pageModel,
    suggested_component_selectors: suggestComponentSelectors(document),
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

  if (standard) {
    result.standard = standard;
    result.coverage = buildCoverage(standard, document);
  }

  if (jsExecuted || fetchAudit) {
    result.js_audit = { ...(fetchAudit || {}), ...(jsAudit || {}) };
  }

  if (failOn) {
    result.gate = buildGate(axeResults, failOn);
  }

  if (baselineId) {
    result.regression = buildRegression(baselineId, axeResults);
  }

  return result;
}

/**
 * Fetches a URL, discovers linked CSS and JS, and runs the full evaluation pipeline.
 */
async function evaluatePage(args) {
  const {
    url,
    include_js = false,
    tags = DEFAULT_TAGS,
    standard = null,
    fail_on = null,
    baseline_id = null,
    max_text_chars = 8_000,
    return_passes = false,
  } = args || {};

  if (!url) return { error: { code: 'URL_INVALID', message: 'url is required.' } };

  const optionError = validateEvaluationOptions({ standard, failOn: fail_on });
  if (optionError) {
    return { ...optionError, governance: errorGovernance('jsdom_dom_evaluation') };
  }

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
  let jsStrings = [];
  let fetchAudit = null;
  if (include_js) {
    const jsResult = await fetchLinkedJs(discoveryDoc, finalUrl);
    jsStrings = jsResult.scripts;
    fetchAudit = jsResult.audit;
  }
  discoveryDom.window.close();

  return runEvaluation({
    html, cssStrings, jsStrings,
    baseUrl: finalUrl,
    sourceUrl: url,
    finalUrl,
    status,
    tags,
    standard,
    failOn: fail_on,
    baselineId: baseline_id,
    cssSource: 'linked_stylesheet',
    fetchAudit,
    maxTextChars: max_text_chars,
    returnPasses: return_passes,
  });
}

module.exports = { evaluatePage, runEvaluation };
