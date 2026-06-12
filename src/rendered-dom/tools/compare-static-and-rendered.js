'use strict';

const { withPage } = require('../browser-pool');
const { validateUrl } = require('../url-guard');
const snapshotStore = require('../snapshot-store');
const { extractPageModel, truncate } = require('../extraction');
const { comparisonGovernance, errorGovernance } = require('../governance');

const FETCH_TIMEOUT_MS = 10_000;

async function fetchStaticHtml(url) {
  const guard = validateUrl(url);
  if (!guard.allowed) throw new Error(`URL blocked: ${guard.message}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'RenderedDOMMCP/1.0 comparison fetch' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    return await res.text();
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`Failed to fetch static HTML: ${err.message}`);
  }
}

function diffLists(staticItems, renderedItems, key) {
  const staticSet = new Set(staticItems.map(i => (i[key] || '').toLowerCase().trim()));
  const renderedSet = new Set(renderedItems.map(i => (i[key] || '').toLowerCase().trim()));

  return {
    only_in_rendered: renderedItems.filter(i => !staticSet.has((i[key] || '').toLowerCase().trim())).slice(0, 30),
    only_in_static: staticItems.filter(i => !renderedSet.has((i[key] || '').toLowerCase().trim())).slice(0, 30),
    count_static: staticItems.length,
    count_rendered: renderedItems.length,
  };
}

function buildRiskFlags(diff) {
  const flags = [];

  if (diff.headings?.only_in_rendered?.length > 0) {
    flags.push({
      type: 'js_required_for_headings',
      severity: 'medium',
      message: `${diff.headings.only_in_rendered.length} heading(s) appear only in the rendered snapshot. ` +
        'These headings depend on JavaScript to render.',
    });
  }

  if (diff.links?.only_in_rendered?.length > 10) {
    flags.push({
      type: 'js_required_for_links',
      severity: 'medium',
      message: `${diff.links.only_in_rendered.length} link(s) appear only in the rendered snapshot. ` +
        'Core navigation or content links may require JavaScript.',
    });
  }

  if (diff.buttons?.only_in_rendered?.length > 0) {
    flags.push({
      type: 'js_required_for_buttons',
      severity: 'low',
      message: `${diff.buttons.only_in_rendered.length} button(s) appear only in the rendered snapshot.`,
    });
  }

  if (diff.forms?.only_in_rendered?.length > 0) {
    flags.push({
      type: 'js_required_for_forms',
      severity: 'high',
      message: `${diff.forms.only_in_rendered.length} form(s) appear only in the rendered snapshot. ` +
        'Form functionality may be unavailable without JavaScript.',
    });
  }

  return flags;
}

async function compareStaticAndRendered(args) {
  const {
    rendered_snapshot_id,
    static_html = null,
    static_url = null,
    compare = ['headings', 'links', 'buttons', 'forms', 'landmarks'],
  } = args || {};

  if (!rendered_snapshot_id) {
    return { error: { code: 'SNAPSHOT_EXPIRED', message: 'rendered_snapshot_id is required.' } };
  }

  if (!static_html && !static_url) {
    return { error: { code: 'URL_INVALID', message: 'Either static_html or static_url is required.' } };
  }

  const renderedHtml = snapshotStore.getArtifact(rendered_snapshot_id, 'html');
  if (!renderedHtml) {
    return {
      error: {
        code: 'SNAPSHOT_EXPIRED',
        message: `Rendered snapshot '${rendered_snapshot_id}' not found or expired. Re-capture with capture_rendered_page_model.`,
        retryable: false,
      },
      governance: errorGovernance('static_rendered_comparison'),
    };
  }

  // Get or fetch static HTML
  let staticHtml = static_html;
  if (!staticHtml) {
    try {
      staticHtml = await fetchStaticHtml(static_url);
    } catch (err) {
      return {
        error: { code: 'NAVIGATION_FAILED', message: truncate(err.message, 300), retryable: true },
        governance: errorGovernance('static_rendered_comparison'),
      };
    }
  }

  try {
    return await withPage(
      { viewport: 'desktop', resourceMode: 'fast', timeoutMs: 20_000 },
      async (page) => {
        // Extract static model from source HTML
        await page.setContent(staticHtml, { waitUntil: 'domcontentloaded' });
        const staticModel = await extractPageModel(page, { maxTextChars: 2_000 });

        // Extract rendered model from stored HTML
        await page.setContent(renderedHtml, { waitUntil: 'domcontentloaded' });
        const renderedModel = await extractPageModel(page, { maxTextChars: 2_000 });

        const compareSet = new Set(compare);
        const differences = {};

        if (compareSet.has('headings')) {
          differences.headings = diffLists(staticModel.headings, renderedModel.headings, 'text');
        }
        if (compareSet.has('links')) {
          differences.links = diffLists(staticModel.links, renderedModel.links, 'href');
        }
        if (compareSet.has('buttons')) {
          differences.buttons = diffLists(staticModel.buttons, renderedModel.buttons, 'text');
        }
        if (compareSet.has('forms')) {
          differences.forms = {
            count_static: staticModel.forms.length,
            count_rendered: renderedModel.forms.length,
            only_in_rendered: renderedModel.forms.filter(
              rf => !staticModel.forms.some(sf => sf.action === rf.action && sf.id === rf.id)
            ).slice(0, 10),
          };
        }
        if (compareSet.has('landmarks')) {
          differences.landmarks = diffLists(staticModel.landmarks, renderedModel.landmarks, 'role');
        }

        const riskFlags = buildRiskFlags(differences);

        return {
          rendered_snapshot_id,
          static_source: static_url || 'inline_html',
          counts: {
            static: { headings: staticModel.counts.headings, links: staticModel.counts.links, buttons: staticModel.counts.buttons },
            rendered: { headings: renderedModel.counts.headings, links: renderedModel.counts.links, buttons: renderedModel.counts.buttons },
          },
          differences,
          risk_flags: riskFlags,
          governance: comparisonGovernance(),
        };
      }
    );
  } catch (err) {
    return {
      error: { code: 'RENDER_FAILED', message: truncate(err.message, 300), retryable: true },
      governance: errorGovernance('static_rendered_comparison'),
    };
  }
}

module.exports = { compareStaticAndRendered };
