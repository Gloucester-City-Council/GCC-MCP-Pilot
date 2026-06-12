'use strict';

const { runEvaluation } = require('./evaluate-page');
const { DEFAULT_TAGS } = require('../jsdom-evaluator');
const { errorGovernance } = require('../governance');
const { truncate } = require('../extraction');

/**
 * Evaluates pre-assembled HTML, CSS, and optional JS without any network fetching.
 * Use this when you have the assets in hand: local files, CI test bundles,
 * component libraries, or content already fetched by another tool.
 */
async function evaluateDomBundle(args) {
  const {
    html,
    css = [],
    js = [],
    base_url = 'https://example.com',
    tags = DEFAULT_TAGS,
    max_text_chars = 8_000,
    return_passes = false,
  } = args || {};

  if (!html || typeof html !== 'string') {
    return { error: { code: 'URL_INVALID', message: 'html is required and must be a string.' } };
  }

  if (!Array.isArray(css)) {
    return { error: { code: 'URL_INVALID', message: 'css must be an array of strings.' } };
  }

  const cssStrings = css.filter(c => typeof c === 'string' && c.length > 0);
  const jsStrings = Array.isArray(js) ? js.filter(j => typeof j === 'string' && j.length > 0) : [];

  try {
    return await runEvaluation({
      html,
      cssStrings,
      jsStrings,
      baseUrl: base_url,
      sourceUrl: base_url,
      finalUrl: base_url,
      status: null,
      tags,
      maxTextChars: max_text_chars,
      returnPasses: return_passes,
    });
  } catch (err) {
    return {
      error: { code: 'AXE_SCAN_FAILED', message: truncate(err.message, 300), retryable: true },
      governance: errorGovernance('jsdom_dom_evaluation'),
    };
  }
}

module.exports = { evaluateDomBundle };
