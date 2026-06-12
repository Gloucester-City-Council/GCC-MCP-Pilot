'use strict';

const { app } = require('@azure/functions');

let handlers = null;
function loadHandlers() {
  if (handlers) return handlers;
  try {
    handlers = {
      evaluate_page: require('../rendered-dom/tools/evaluate-page').evaluatePage,
      evaluate_dom_bundle: require('../rendered-dom/tools/evaluate-dom-bundle').evaluateDomBundle,
      inspect_dom_selector: require('../rendered-dom/tools/inspect-dom-selector').inspectDomSelector,
    };
  } catch (err) {
    console.error('mcpRenderedDom: handler load failed —', err.message);
    handlers = {};
  }
  return handlers;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'evaluate_page',
    description: [
      'Fetches a URL, discovers and loads its linked CSS, optionally executes its JavaScript,',
      'then runs axe-core for WCAG violation detection and extracts a compact page model.',
      'No browser required — uses jsdom for DOM emulation, runs entirely in-process.',
      'Returns structured output ready for the accessibility MCP:',
      'axe violations, page model (headings/landmarks/links/forms/images),',
      'and elements_for_contrast_review with declared CSS colour values.',
      'Use inspect_dom_selector for targeted element inspection from the returned snapshot_id.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch and evaluate. Must be in the allowed origins list.' },
        include_js: {
          type: 'boolean',
          default: false,
          description: 'If true, fetches and executes linked JS files. Reveals JS-injected content. Off by default for speed and safety.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          default: ['wcag2a', 'wcag2aa', 'wcag21aa'],
          description: 'WCAG rule tags for axe-core (e.g. ["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).',
        },
        max_text_chars: {
          type: 'integer',
          default: 8000,
          description: 'Maximum characters for visible_text_excerpt.',
        },
        return_passes: {
          type: 'boolean',
          default: false,
          description: 'Include passing axe rules in the response.',
        },
      },
      required: ['url'],
    },
  },

  {
    name: 'evaluate_dom_bundle',
    description: [
      'Evaluates HTML, CSS, and optional JavaScript provided directly as strings.',
      'Use this for local files, CI pipelines, component testing, or when you have',
      'already fetched the assets. Same evaluation pipeline as evaluate_page.',
      'No network calls made — all content comes from the provided strings.',
      'Returns the same structured output as evaluate_page for the accessibility MCP.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'HTML document string to evaluate.' },
        css: {
          type: 'array',
          items: { type: 'string' },
          default: [],
          description: 'Array of CSS stylesheet strings to apply, in cascade order.',
        },
        js: {
          type: 'array',
          items: { type: 'string' },
          default: [],
          description: 'Array of JavaScript strings to execute after CSS is applied.',
        },
        base_url: {
          type: 'string',
          default: 'https://example.com',
          description: 'Base URL for resolving relative links and setting the jsdom window.location.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          default: ['wcag2a', 'wcag2aa', 'wcag21aa'],
          description: 'WCAG rule tags for axe-core.',
        },
        max_text_chars: { type: 'integer', default: 8000 },
        return_passes: { type: 'boolean', default: false },
      },
      required: ['html'],
    },
  },

  {
    name: 'inspect_dom_selector',
    description: [
      'Inspects a CSS selector against a previously evaluated snapshot.',
      'Returns accessible names, computed styles, ARIA attributes, and HTML excerpts',
      'for matched nodes — structured for direct handoff to the accessibility MCP.',
      'Use this after evaluate_page or evaluate_dom_bundle to examine a specific',
      'component: nav, main, form, .modal, [role="dialog"], .job-list, etc.',
      'Snapshots expire after 15 minutes.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        snapshot_id: { type: 'string', description: 'snapshot_id from evaluate_page or evaluate_dom_bundle.' },
        selector: { type: 'string', description: 'CSS selector to inspect (e.g. "nav", "form", ".card", "[role=\'dialog\']").' },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['html', 'computed_styles', 'accessible_names', 'states'] },
          default: ['html', 'computed_styles', 'accessible_names', 'states'],
          description: 'Node properties to include.',
        },
        max_nodes: { type: 'integer', default: 80, description: 'Maximum nodes to return.' },
        max_html_chars: { type: 'integer', default: 12000, description: 'Maximum HTML excerpt characters per node.' },
      },
      required: ['snapshot_id', 'selector'],
    },
  },
];

// ─── MCP manifest ─────────────────────────────────────────────────────────────

const MANIFEST = {
  protocolVersion: '2024-11-05',
  capabilities: { tools: {} },
  serverInfo: {
    name: 'gcc-rendered-dom-mcp',
    version: '2.0.0',
    instructions: `RENDERED DOM MCP — jsdom evaluation engine

Evaluates HTML + CSS + JavaScript together without a real browser.
Uses jsdom for DOM emulation and axe-core for WCAG violation detection.
Runs in-process on any Azure Functions plan including Windows Consumption.

TOOLS:
  evaluate_page        — fetch a URL, load its CSS, run axe, get page model
  evaluate_dom_bundle  — same but you supply the HTML/CSS/JS strings directly
  inspect_dom_selector — examine a specific component from a stored evaluation

TYPICAL WORKFLOW:
  1. evaluate_page(url)
       → axe violations, page model, elements_for_contrast_review, snapshot_id
  2. inspect_dom_selector(snapshot_id, 'nav')
       → accessible name, computed styles, ARIA attrs for nav nodes
  3. Pass everything to the accessibility MCP for WCAG interpretation

COLOUR CONTRAST:
  axe-core marks colour contrast as 'incomplete' in jsdom (background colour
  stacking is not computed without a layout engine). The elements_for_contrast_review
  payload surfaces those elements with their declared CSS colour values so the
  accessibility MCP can assess them.

TOKEN DISCIPLINE:
  evaluate_page returns a compact page model — not raw HTML.
  Use inspect_dom_selector to retrieve HTML for a specific selector only.
  Snapshots expire after 15 minutes.`,
  },
};

// ─── MCP JSON-RPC handler ─────────────────────────────────────────────────────

async function handleMcpRequest(requestBody, context) {
  if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
    return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: body must be a JSON object' }, id: null };
  }

  const { jsonrpc, method, params, id } = requestBody;
  const requestId = Object.prototype.hasOwnProperty.call(requestBody, 'id') && id !== undefined ? id : null;

  if (jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }, id: requestId };
  }

  context.log(`Rendered DOM MCP: ${method}`);

  switch (method) {
    case 'initialize':
      return { jsonrpc: '2.0', result: MANIFEST, id };

    case 'notifications/initialized':
      return null;

    case 'ping':
      return { jsonrpc: '2.0', result: {}, id };

    case 'tools/list':
      return { jsonrpc: '2.0', result: { tools: TOOLS }, id };

    case 'tools/call': {
      const { name, arguments: rawArgs } = params || {};
      const start = Date.now();

      if (!name) {
        return { jsonrpc: '2.0', error: { code: -32602, message: 'Missing tool name' }, id };
      }

      const toolHandlers = loadHandlers();
      const handler = toolHandlers[name];

      if (!handler) {
        return {
          jsonrpc: '2.0',
          error: { code: -32602, message: `Unknown tool: ${name}. Available: ${TOOLS.map(t => t.name).join(', ')}` },
          id,
        };
      }

      let args = rawArgs;
      if (typeof rawArgs === 'string') {
        try { args = JSON.parse(rawArgs); } catch {
          return { jsonrpc: '2.0', error: { code: -32602, message: 'arguments must be valid JSON' }, id };
        }
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return { jsonrpc: '2.0', error: { code: -32602, message: 'arguments must be an object' }, id };
      }

      try {
        context.log(`Rendered DOM executing: ${name}`);
        const result = await handler(args);
        context.log(`Rendered DOM done [${name}] in ${Date.now() - start}ms`);
        return {
          jsonrpc: '2.0',
          result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          id,
        };
      } catch (err) {
        context.log.error(`Rendered DOM error [${name}]: ${err.message}`);
        return {
          jsonrpc: '2.0',
          result: {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message.substring(0, 300) }) }],
            isError: true,
          },
          id,
        };
      }
    }

    default:
      return { jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id };
  }
}

// ─── HTTP trigger ─────────────────────────────────────────────────────────────

app.http('mcpRenderedDom', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'mcp-rendered-dom',
  handler: async (request, context) => {
    const start = Date.now();
    try {
      if (request.method === 'GET') {
        return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(MANIFEST) };
      }

      let body;
      try { body = await request.json(); } catch {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null }),
        };
      }

      const response = await handleMcpRequest(body, context);

      if (response === null) {
        context.log(`Rendered DOM 204 in ${Date.now() - start}ms`);
        return { status: 204 };
      }

      context.log(`Rendered DOM 200 in ${Date.now() - start}ms`);
      return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response) };
    } catch (err) {
      context.log.error('Rendered DOM unhandled:', err.message);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null }),
      };
    }
  },
});

module.exports = { handleMcpRequest, TOOLS };
