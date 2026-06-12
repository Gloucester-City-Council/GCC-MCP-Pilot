'use strict';

const fs = require('fs');
const vm = require('vm');
const { truncate, STYLE_WHITELIST, blockAwareText, elementDescriptor } = require('./extraction');

// Read axe-core source once at module load — cached by Node's module system.
let axeSource = null;
function getAxeSource() {
  if (axeSource) return axeSource;
  try {
    axeSource = fs.readFileSync(require.resolve('axe-core'), 'utf8');
    return axeSource;
  } catch {
    throw new Error('axe-core is not installed. Run: npm install axe-core');
  }
}

function getJsdom() {
  try {
    return require('jsdom').JSDOM;
  } catch {
    throw new Error('jsdom is not installed. Run: npm install jsdom');
  }
}

const DEFAULT_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

// Page JS execution budget — caps runaway scripts (infinite loops, heavy
// synchronous work) so a hostile or broken script cannot hang the function.
const JS_EXEC_TIMEOUT_MS = 1_500; // per script
const JS_TOTAL_BUDGET_MS = 5_000; // across all scripts in one evaluation
const MAX_TIMER_CALLBACKS = 200; // total timers page JS may schedule
const MIN_INTERVAL_MS = 50; // setInterval(fn, 0) gets clamped to this

/**
 * Stubs jsdom's outbound network APIs before any page JS runs. Evaluated
 * scripts can mutate the DOM but cannot phone out — which also means a
 * script cannot download and execute further scripts (XHR + eval chains).
 * Combined with runScripts:'outside-only' (dynamically injected <script>
 * tags never execute) this closes the recursive script-loading hole.
 * Returns a counter object whose .count records blocked call attempts.
 */
function disableNetworkApis(window) {
  const blocked = { count: 0 };
  function NetworkDisabled() {
    blocked.count++;
    throw new Error('Network access is disabled in this evaluation environment');
  }
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'fetch']) {
    try {
      Object.defineProperty(window, name, { value: NetworkDisabled, configurable: true, writable: true });
    } catch { /* property may be non-configurable in future jsdom versions */ }
  }
  return blocked;
}

const BTN_Q = 'button,[role="button"],input[type="submit"],input[type="button"],input[type="reset"]';

// Cheap structural counts used to report what page JS actually changed.
function domStats(document) {
  let ariaAttributes = 0;
  try {
    for (const el of document.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        if (attr.name.startsWith('aria-')) ariaAttributes++;
      }
    }
  } catch { /* leave at counted-so-far */ }

  const count = q => { try { return document.querySelectorAll(q).length; } catch { return 0; } };
  return {
    nodes: count('*'),
    buttons: count(BTN_Q),
    forms: count('form'),
    links: count('a[href]'),
    images: count('img'),
    aria_attributes: ariaAttributes,
  };
}

/**
 * Caps how much deferred work page JS can schedule: a hard limit on total
 * timer registrations and a minimum interval delay. Returns a restore
 * function so trusted code run afterwards (axe) gets the real timers.
 */
function capTimers(window) {
  const origSetTimeout = window.setTimeout.bind(window);
  const origSetInterval = window.setInterval.bind(window);
  let scheduled = 0;

  window.setTimeout = (fn, delay, ...rest) => {
    if (++scheduled > MAX_TIMER_CALLBACKS) return 0;
    return origSetTimeout(fn, delay, ...rest);
  };
  window.setInterval = (fn, delay, ...rest) => {
    if (++scheduled > MAX_TIMER_CALLBACKS) return 0;
    return origSetInterval(fn, Math.max(delay || 0, MIN_INTERVAL_MS), ...rest);
  };

  return function restoreTimers() {
    window.setTimeout = origSetTimeout;
    window.setInterval = origSetInterval;
  };
}

/**
 * Builds a jsdom environment from HTML + pre-fetched CSS strings + optional JS strings.
 *
 * CSS is injected as <style> tags so we control what loads (no unguarded external fetches).
 * JS is executed under runScripts:'outside-only' — safer than 'dangerously' because inline
 * scripts in the HTML don't auto-execute; only what we explicitly pass runs. Each script
 * gets a CPU timeout (vm.runInContext), network APIs are stubbed out, and timer scheduling
 * is capped, so page JS cannot recurse into loading more JS or hang the evaluation.
 *
 * Returns { window, document } ready for querying or axe injection.
 * Callers should window.close() when finished to cancel any pending timers.
 */
function createEnvironment({ html, cssStrings = [], jsStrings = [], baseUrl = 'https://example.com' }) {
  const JSDOM = getJsdom();

  const dom = new JSDOM(html, {
    url: baseUrl,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    // No resources:'usable' — we inject CSS ourselves via <style> tags
  });

  const { window } = dom;
  const { document } = window;

  // Inject CSS sheets in order — marked so inline-CSS extraction can tell
  // page-authored <style> blocks apart from the ones we add here.
  for (const css of cssStrings) {
    if (!css) continue;
    const style = document.createElement('style');
    style.setAttribute('data-mcp-injected', 'true');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Execute JS files in order — errors are non-fatal (missing browser APIs are common)
  let jsAudit = null;
  if (jsStrings.some(Boolean)) {
    const before = domStats(document);
    const blocked = disableNetworkApis(window);
    const restoreTimers = capTimers(window);

    let context = null;
    try { context = dom.getInternalVMContext(); } catch { /* fall back to window.eval below */ }

    let executed = 0;
    let timeouts = 0;
    let errors = 0;
    let skippedBudgetExhausted = 0;
    let budget = JS_TOTAL_BUDGET_MS;
    for (const js of jsStrings) {
      if (!js) continue;
      if (budget <= 0) { skippedBudgetExhausted++; continue; }
      const started = Date.now();
      try {
        if (context) {
          vm.runInContext(js, context, { timeout: Math.min(JS_EXEC_TIMEOUT_MS, budget) });
        } else {
          window.eval(js);
        }
        executed++;
      } catch (err) {
        // Timed-out scripts still ran until interruption; other errors are
        // usually missing browser APIs — both non-fatal.
        if (err && err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') timeouts++;
        else errors++;
      }
      budget -= Date.now() - started;
    }

    restoreTimers();

    const after = domStats(document);
    jsAudit = {
      scripts_supplied: jsStrings.filter(Boolean).length,
      executed,
      timeouts,
      errors,
      skipped_budget_exhausted: skippedBudgetExhausted,
      network_calls_blocked: blocked.count,
      dom_delta: {
        nodes_added: after.nodes - before.nodes,
        buttons_added: after.buttons - before.buttons,
        forms_added: after.forms - before.forms,
        links_added: after.links - before.links,
        images_added: after.images - before.images,
        aria_attributes_added: after.aria_attributes - before.aria_attributes,
      },
    };
  }

  return { window, document, jsAudit };
}

/**
 * Runs axe-core inside the jsdom window and returns the raw results object.
 */
async function runAxe(window, tags = DEFAULT_TAGS) {
  window.eval(getAxeSource());

  return new Promise((resolve, reject) => {
    window.axe.run(
      window.document,
      { runOnly: { type: 'tag', values: tags }, reporter: 'v2' },
      (err, results) => {
        if (err) reject(err);
        else resolve(results);
      }
    );
  });
}

/**
 * Extracts a compact, token-safe page model directly from a jsdom document.
 * Unlike the browser path this runs in Node context — no page.evaluate() needed.
 */
function extractPageModel(document, window, options = {}) {
  const maxTextChars = options.maxTextChars || 8_000;
  const maxLinks = options.maxLinks || 100;
  const maxButtons = options.maxButtons || 100;
  const maxImages = options.maxImages || 100;

  function isVisible(el) {
    try {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    } catch { return true; }
  }

  function textOf(el, max = 300) {
    return (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, max);
  }

  // Returns { name, source } so audits can explain WHY the accessible name
  // is what it is (aria-label beats aria-labelledby beats title beats text).
  // The text fallback is block-aware: container landmarks summarise as
  // newline-separated lines, not concatenated text.
  function accessibleName(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return { name: ariaLabel.trim(), source: 'aria-label' };
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean);
      if (parts.length) return { name: parts.join(' '), source: 'aria-labelledby' };
    }
    const title = el.getAttribute('title');
    if (title) return { name: title.trim(), source: 'title' };
    const text = truncate(blockAwareText(el), 200);
    return text ? { name: text, source: 'text_content' } : { name: null, source: null };
  }

  // Headings
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .filter(isVisible)
    .map(h => ({ level: parseInt(h.tagName[1]), text: textOf(h), visible: true }));

  // Landmarks
  const landmarks = [];
  const LANDMARK_Q = 'header,nav,main,[role="main"],aside,[role="complementary"],' +
    'footer,[role="search"],[role="banner"],[role="contentinfo"],' +
    '[role="region"][aria-label],[role="region"][aria-labelledby]';
  try {
    document.querySelectorAll(LANDMARK_Q).forEach(el => {
      if (isVisible(el)) {
        const an = accessibleName(el);
        landmarks.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          name: an.name,
          name_source: an.source,
        });
      }
    });
  } catch { /* ignore selector issues */ }

  // Links
  const links = [];
  document.querySelectorAll('a[href]').forEach(a => {
    if (links.length >= maxLinks) return;
    if (isVisible(a)) {
      const an = accessibleName(a);
      links.push({
        text: textOf(a, 200),
        href: a.getAttribute('href'),
        name: an.name,
        name_source: an.source,
        visible: true,
      });
    }
  });

  // Buttons
  const buttons = [];
  document.querySelectorAll(BTN_Q).forEach(b => {
    if (buttons.length >= maxButtons) return;
    if (isVisible(b)) {
      const an = accessibleName(b);
      buttons.push({
        text: (b.textContent || b.value || '').trim().replace(/\s+/g, ' ').substring(0, 200),
        name: an.name,
        name_source: an.source,
        type: b.type || 'button',
        aria_expanded: b.getAttribute('aria-expanded'),
        aria_controls: b.getAttribute('aria-controls'),
        visible: true,
        disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
      });
    }
  });

  // Forms — includes label association check
  const forms = [];
  document.querySelectorAll('form').forEach(form => {
    const fields = [];
    form.querySelectorAll('input:not([type="hidden"]),select,textarea').forEach(f => {
      const labelEl = f.id ? document.querySelector(`label[for="${f.id}"]`) : null;
      const ariaLabel = f.getAttribute('aria-label');
      const ariaLabelledBy = f.getAttribute('aria-labelledby');
      const labelSource = labelEl ? 'label_for'
        : ariaLabel ? 'aria-label'
        : ariaLabelledBy ? 'aria-labelledby'
        : null;
      fields.push({
        tag: f.tagName.toLowerCase(),
        type: f.type || null,
        name: f.name || f.id || null,
        required: f.required,
        placeholder: f.placeholder || null,
        has_label: !!(labelEl || ariaLabel || ariaLabelledBy),
        label_text: labelEl?.textContent?.trim() || ariaLabel || null,
        label_source: labelSource,
      });
    });
    forms.push({
      id: form.id || null,
      name: form.name || null,
      action: form.action || null,
      method: form.method || 'get',
      fields,
    });
  });

  // Images
  const images = [];
  document.querySelectorAll('img,[role="img"]').forEach(img => {
    if (images.length >= maxImages) return;
    if (isVisible(img)) {
      images.push({
        src: img.getAttribute('src') || null,
        alt: img.hasAttribute('alt') ? img.getAttribute('alt') : null,
        role: img.getAttribute('role') || 'img',
        decorative: img.getAttribute('role') === 'presentation' || img.getAttribute('alt') === '',
        missing_alt: img.tagName === 'IMG' && !img.hasAttribute('alt'),
        visible: true,
      });
    }
  });

  // Block-aware extraction: headings/paragraphs/list items keep newline
  // boundaries so downstream models don't receive concatenated text.
  const bodyText = document.body ? blockAwareText(document.body) : '';

  return {
    language: document.documentElement.getAttribute('lang') || null,
    title: document.title || null,
    headings,
    landmarks,
    links,
    buttons,
    forms,
    images,
    visible_text_excerpt: bodyText.substring(0, maxTextChars),
    counts: {
      headings: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      links: document.querySelectorAll('a[href]').length,
      buttons: document.querySelectorAll(BTN_Q).length,
      forms: document.querySelectorAll('form').length,
      images: document.querySelectorAll('img').length,
    },
  };
}

/**
 * Extracts nodes for a CSS selector with computed styles.
 * Used by inspect_dom_selector.
 */
function extractNodes(document, window, selector, options = {}) {
  const maxNodes = options.maxNodes || 80;
  const maxHtmlChars = options.maxHtmlChars || 12_000;
  const include = new Set(options.include || ['html', 'computed_styles', 'accessible_names', 'states']);

  let elements;
  try {
    elements = Array.from(document.querySelectorAll(selector));
  } catch {
    return { matches: 0, nodes: [], error: { code: 'SELECTOR_INVALID', message: `Invalid CSS selector: '${selector}'` } };
  }

  if (elements.length === 0) return { matches: 0, nodes: [], truncated: false };

  const truncated = elements.length > maxNodes;
  const toProcess = elements.slice(0, maxNodes);

  function accessibleName(el) {
    const label = el.getAttribute('aria-label');
    if (label) return { name: label.trim(), source: 'aria-label' };
    const title = el.getAttribute('title');
    if (title) return { name: title.trim(), source: 'title' };
    const text = truncate(blockAwareText(el), 200);
    return text ? { name: text, source: 'text_content' } : { name: null, source: null };
  }

  const nodes = toProcess.map((el, i) => {
    const node = {
      node_id: `node_${String(i + 1).padStart(3, '0')}`,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: Array.from(el.classList),
      role: el.getAttribute('role') || null,
    };

    if (include.has('accessible_names')) {
      const an = accessibleName(el);
      node.accessible_name = an.name;
      node.accessible_name_source = an.source;
    }

    node.text_excerpt = truncate(blockAwareText(el), 500);

    if (include.has('html')) {
      node.html_excerpt = truncate(el.outerHTML, maxHtmlChars);
    }

    // Collect all ARIA and key structural attributes
    const attrs = {};
    for (const attr of el.attributes) {
      if (attr.name.startsWith('aria-') ||
        ['role', 'tabindex', 'href', 'type', 'name', 'for', 'action', 'method', 'required'].includes(attr.name)) {
        attrs[attr.name] = attr.value;
      }
    }
    node.attributes = attrs;

    if (include.has('states')) {
      try {
        const cs = window.getComputedStyle(el);
        node.states = {
          visible: cs.display !== 'none' && cs.visibility !== 'hidden',
          disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
          focusable: el.tabIndex >= 0,
        };
      } catch { node.states = {}; }
    }

    if (include.has('computed_styles')) {
      try {
        const cs = window.getComputedStyle(el);
        const styles = {};
        STYLE_WHITELIST.forEach(prop => {
          const val = cs[prop];
          if (val) styles[prop] = val;
        });
        node.computed_styles = styles;
      } catch { node.computed_styles = {}; }
    }

    return node;
  });

  return {
    matches: elements.length,
    nodes,
    truncated,
    truncation_reason: truncated ? `Showing first ${maxNodes} of ${elements.length} matches.` : null,
  };
}

const TRANSPARENT_RE = /^(transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))$/i;

/**
 * Walks up from an element until an ancestor declares a non-transparent
 * background colour. This is a heuristic — without a layout engine the
 * visually painted background can differ (overlaps, images, gradients) —
 * so the result is labelled declared_ancestor_background, never a final
 * visual background.
 */
function ancestorBackground(el, window) {
  let current = el.parentElement;
  while (current) {
    try {
      const bg = window.getComputedStyle(current).backgroundColor;
      if (bg && !TRANSPARENT_RE.test(bg.trim())) {
        return { value: bg, source: elementDescriptor(current) };
      }
    } catch { /* keep walking */ }
    current = current.parentElement;
  }
  return { value: null, source: 'none_declared' };
}

/**
 * Pulls elements flagged by axe for colour contrast review and enriches them
 * with their declared CSS colour values for the accessibility MCP.
 * Returns [] if there are no contrast findings.
 */
function extractContrastElements(violations, incomplete, document, window) {
  const findings = [
    ...violations.filter(v => v.id === 'color-contrast'),
    ...incomplete.filter(v => v.id === 'color-contrast'),
  ];
  if (!findings.length) return [];

  const seen = new Set();
  const elements = [];

  findings.forEach(finding => {
    finding.nodes.forEach(node => {
      const selector = Array.isArray(node.target) ? node.target.join(' ') : String(node.target);
      if (seen.has(selector)) return;
      seen.add(selector);

      let el;
      try { el = document.querySelector(selector); } catch { return; }
      if (!el) return;

      let declared = {};
      let contrast = null;
      try {
        const cs = window.getComputedStyle(el);
        const parentCs = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
        declared = {
          color: cs.color || null,
          background_color: cs.backgroundColor || null,
          parent_background_color: parentCs?.backgroundColor || null,
          font_size: cs.fontSize || null,
          font_weight: cs.fontWeight || null,
          line_height: cs.lineHeight || null,
        };

        // Ancestor walk: if the element's own background is transparent,
        // find the nearest declared ancestor background as a candidate.
        const ownBg = cs.backgroundColor && !TRANSPARENT_RE.test(cs.backgroundColor.trim())
          ? { value: cs.backgroundColor, source: elementDescriptor(el) }
          : ancestorBackground(el, window);
        contrast = {
          foreground: cs.color || null,
          background_candidate: ownBg.value,
          background_source: ownBg.source,
          confidence: 'heuristic_not_visual',
        };
      } catch { /* non-fatal */ }

      elements.push({
        selector,
        html_excerpt: truncate(el.outerHTML, 500),
        text: truncate((el.textContent || '').trim(), 200),
        declared_styles: declared,
        contrast,
        axe_status: finding.id === 'color-contrast' && violations.some(v => v.id === 'color-contrast')
          ? 'violation'
          : 'incomplete',
        note: 'Background candidate is the nearest declared ancestor background, not the visually painted one. Pass contrast + declared_styles to the accessibility MCP for assessment.',
      });
    });
  });

  return elements;
}

// Selectors worth inspecting on most pages — returned so downstream agents
// can call inspect_dom_selector on real components instead of guessing.
const COMPONENT_SELECTOR_CANDIDATES = [
  'header', 'nav', 'main', 'form', 'footer', 'aside', 'table',
  '[role="dialog"]', '[role="alert"]', '[aria-expanded]', '[aria-live]',
  'a', 'button', 'input', 'select', 'img', 'iframe', 'video', 'audio',
];

// Container elements with ids are usually mount points for dynamic content
// (#app, #root, #dynamic) — worth suggesting by id, post-JS execution.
const ID_CONTAINER_Q = 'div[id], section[id], article[id], ul[id], ol[id], table[id]';
const SAFE_ID_RE = /^[A-Za-z][\w-]*$/;
const MAX_ID_SUGGESTIONS = 5;

function suggestComponentSelectors(document) {
  const suggestions = COMPONENT_SELECTOR_CANDIDATES.filter(sel => {
    try { return document.querySelector(sel) !== null; } catch { return false; }
  });

  try {
    let idCount = 0;
    for (const el of document.querySelectorAll(ID_CONTAINER_Q)) {
      if (idCount >= MAX_ID_SUGGESTIONS) break;
      if (SAFE_ID_RE.test(el.id)) {
        suggestions.push(`#${el.id}`);
        idCount++;
      }
    }
  } catch { /* id scan is best-effort */ }

  return suggestions;
}

module.exports = {
  createEnvironment,
  runAxe,
  extractPageModel,
  extractNodes,
  extractContrastElements,
  ancestorBackground,
  suggestComponentSelectors,
  DEFAULT_TAGS,
};
