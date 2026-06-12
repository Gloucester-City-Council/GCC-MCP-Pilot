'use strict';

// Only the computed styles that matter for accessibility analysis.
const STYLE_WHITELIST = [
  'display', 'visibility', 'opacity', 'position', 'zIndex', 'overflow',
  'color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight',
  'letterSpacing', 'wordSpacing', 'textAlign', 'textDecoration',
  'outline', 'outlineColor', 'outlineWidth', 'outlineStyle',
  'boxShadow', 'width', 'height', 'minWidth', 'minHeight',
  'pointerEvents', 'cursor',
];

function truncate(str, maxChars) {
  if (!str || str.length <= maxChars) return str;
  return str.substring(0, maxChars);
}

/**
 * Attaches page-level listeners for console errors, failed requests, and redirects.
 * Returns { flush() } which returns the collected diagnostics.
 */
function collectDiagnostics(page) {
  const consoleErrors = [];
  const failedRequests = [];
  const redirects = [];

  page.on('console', msg => {
    if (msg.type() === 'error' && consoleErrors.length < 50) {
      consoleErrors.push({ type: 'error', text: truncate(msg.text(), 500) });
    }
  });

  page.on('requestfailed', req => {
    if (failedRequests.length < 50) {
      failedRequests.push({
        url: req.url(),
        method: req.method(),
        failure: req.failure()?.errorText || 'unknown',
      });
    }
  });

  page.on('response', response => {
    if ([301, 302, 303, 307, 308].includes(response.status()) && redirects.length < 10) {
      redirects.push({
        from: response.url(),
        status: response.status(),
        to: response.headers()['location'] || null,
      });
    }
  });

  return {
    flush: () => ({ console_errors: consoleErrors, failed_requests: failedRequests, redirects }),
  };
}

/**
 * Extracts a compact, token-safe page model from the live browser page.
 * Runs inside page.evaluate() — no Node.js APIs available.
 */
async function extractPageModel(page, options = {}) {
  const opts = {
    maxTextChars: options.maxTextChars || 8_000,
    maxLinks: options.maxLinks || 100,
    maxButtons: options.maxButtons || 100,
    maxImages: options.maxImages || 100,
    styleWhitelist: STYLE_WHITELIST,
  };

  return page.evaluate((opts) => {
    function isVisible(el) {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;
    }

    function textOf(el, max) {
      return (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, max || 300);
    }

    function accessibleName(el) {
      const label = el.getAttribute('aria-label');
      if (label) return label.trim();
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const parts = labelledBy.split(/\s+/).map(id => {
          const ref = document.getElementById(id);
          return ref ? ref.textContent.trim() : '';
        }).filter(Boolean);
        if (parts.length) return parts.join(' ');
      }
      const title = el.getAttribute('title');
      if (title) return title.trim();
      return textOf(el, 200) || null;
    }

    // ── Headings ──────────────────────────────────────────────────────────────
    const headings = [];
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
      if (isVisible(h)) {
        headings.push({ level: parseInt(h.tagName[1]), text: textOf(h, 300), visible: true });
      }
    });

    // ── Landmarks ─────────────────────────────────────────────────────────────
    const landmarks = [];
    const landmarkQuery = 'header,nav,main,[role="main"],aside,[role="complementary"],' +
      'footer,[role="search"],[role="region"][aria-label],[role="banner"],[role="contentinfo"]';
    try {
      document.querySelectorAll(landmarkQuery).forEach(el => {
        if (isVisible(el)) {
          landmarks.push({
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || el.tagName.toLowerCase(),
            name: accessibleName(el),
          });
        }
      });
    } catch { /* ignore malformed selectors */ }

    // ── Links ─────────────────────────────────────────────────────────────────
    const links = [];
    document.querySelectorAll('a[href]').forEach(a => {
      if (links.length >= opts.maxLinks) return;
      if (isVisible(a)) {
        links.push({
          text: textOf(a, 200),
          href: a.getAttribute('href'),
          name: a.getAttribute('aria-label') || null,
          visible: true,
        });
      }
    });

    // ── Buttons ───────────────────────────────────────────────────────────────
    const buttons = [];
    const btnQuery = 'button,[role="button"],input[type="submit"],input[type="button"],input[type="reset"]';
    document.querySelectorAll(btnQuery).forEach(b => {
      if (buttons.length >= opts.maxButtons) return;
      if (isVisible(b)) {
        buttons.push({
          text: (b.textContent || b.value || '').trim().replace(/\s+/g, ' ').substring(0, 200),
          name: accessibleName(b),
          type: b.type || 'button',
          aria_expanded: b.getAttribute('aria-expanded'),
          aria_controls: b.getAttribute('aria-controls'),
          visible: true,
          disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
        });
      }
    });

    // ── Forms ─────────────────────────────────────────────────────────────────
    const forms = [];
    document.querySelectorAll('form').forEach(form => {
      const fields = [];
      form.querySelectorAll('input:not([type="hidden"]),select,textarea').forEach(f => {
        fields.push({
          tag: f.tagName.toLowerCase(),
          type: f.type || null,
          name: f.name || f.id || null,
          required: f.required,
          placeholder: f.placeholder || null,
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

    // ── Images ────────────────────────────────────────────────────────────────
    const images = [];
    document.querySelectorAll('img,[role="img"]').forEach(img => {
      if (images.length >= opts.maxImages) return;
      if (isVisible(img)) {
        images.push({
          src: img.src || img.getAttribute('src') || null,
          alt: img.alt || img.getAttribute('aria-label') || null,
          role: img.getAttribute('role') || 'img',
          decorative: img.getAttribute('role') === 'presentation' || img.alt === '',
          visible: true,
        });
      }
    });

    // ── Visible text excerpt ──────────────────────────────────────────────────
    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();

    // ── Counts ────────────────────────────────────────────────────────────────
    const counts = {
      headings: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      links: document.querySelectorAll('a[href]').length,
      buttons: document.querySelectorAll(btnQuery).length,
      forms: document.querySelectorAll('form').length,
      images: document.querySelectorAll('img').length,
    };

    return {
      language: document.documentElement.lang || null,
      headings,
      landmarks,
      links,
      buttons,
      forms,
      images,
      visible_text_excerpt: bodyText.substring(0, opts.maxTextChars),
      counts,
    };
  }, opts);
}

/**
 * Extracts rendered node info for a CSS selector.
 * Returns { matches, nodes, truncated }.
 */
async function extractNodes(page, selector, options = {}) {
  const maxNodes = options.maxNodes || 80;
  const maxHtmlChars = options.maxHtmlChars || 12_000;
  const include = new Set(options.include || []);

  // Validate selector
  let matchCount;
  try {
    matchCount = await page.evaluate(sel => document.querySelectorAll(sel).length, selector);
  } catch {
    return { matches: 0, nodes: [], error: { code: 'SELECTOR_INVALID', message: `Invalid CSS selector: '${selector}'` } };
  }

  if (matchCount === 0) {
    return { matches: 0, nodes: [], truncated: false };
  }

  const handles = await page.$$(selector);
  const toProcess = handles.slice(0, maxNodes);
  const nodes = [];

  for (let i = 0; i < toProcess.length; i++) {
    const handle = toProcess[i];
    const nodeId = `node_${String(i + 1).padStart(3, '0')}`;

    const info = await handle.evaluate((el, params) => {
      function accName(el) {
        const label = el.getAttribute('aria-label');
        if (label) return label.trim();
        const title = el.getAttribute('title');
        if (title) return title.trim();
        return (el.textContent || '').trim().substring(0, 200) || null;
      }

      const attrs = {};
      for (const attr of el.attributes) {
        if (attr.name.startsWith('aria-') ||
          ['role', 'id', 'class', 'tabindex', 'href', 'type', 'name', 'for', 'action', 'method'].includes(attr.name)) {
          attrs[attr.name] = attr.value;
        }
      }

      const cs = window.getComputedStyle(el);

      const result = {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: Array.from(el.classList),
        role: el.getAttribute('role') || null,
        accessible_name: accName(el),
        text_excerpt: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 500),
        attributes: attrs,
        states: {
          visible: cs.display !== 'none' && cs.visibility !== 'hidden',
          disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
          focusable: el.tabIndex >= 0,
        },
      };

      if (params.includeHtml) {
        result.html_excerpt = el.outerHTML.substring(0, params.maxHtmlChars);
      }

      if (params.includeStyles) {
        const styles = {};
        params.styleProps.forEach(prop => { styles[prop] = cs[prop]; });
        result.computed_styles = styles;
      }

      return result;
    }, {
      includeHtml: include.has('html'),
      includeStyles: include.has('computed_styles'),
      styleProps: STYLE_WHITELIST,
      maxHtmlChars,
    });

    if (include.has('bounding_boxes')) {
      info.box = await handle.boundingBox();
    }

    nodes.push({ node_id: nodeId, ...info });
  }

  const truncated = matchCount > maxNodes;
  return {
    matches: matchCount,
    nodes,
    truncated,
    truncation_reason: truncated
      ? `Showing first ${maxNodes} of ${matchCount} matches. Use a narrower selector.`
      : null,
  };
}

module.exports = { collectDiagnostics, extractPageModel, extractNodes, truncate, STYLE_WHITELIST };
