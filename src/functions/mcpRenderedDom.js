'use strict';

const { app } = require('@azure/functions');

// Tool handlers — loaded lazily so a missing playwright doesn't crash unrelated MCPs
let handlers = null;

function loadHandlers() {
  if (handlers) return handlers;
  try {
    handlers = {
      capture_rendered_page_model: require('../rendered-dom/tools/capture-rendered-page-model').captureRenderedPageModel,
      inspect_rendered_selector: require('../rendered-dom/tools/inspect-rendered-selector').inspectRenderedSelector,
      capture_aria_snapshot: require('../rendered-dom/tools/capture-aria-snapshot').captureAriaSnapshot,
      run_accessibility_scan: require('../rendered-dom/tools/run-accessibility-scan').runAccessibilityScan,
      interact_and_snapshot: require('../rendered-dom/tools/interact-and-snapshot').interactAndSnapshot,
      compare_static_and_rendered: require('../rendered-dom/tools/compare-static-and-rendered').compareStaticAndRendered,
    };
  } catch (err) {
    console.error('mcpRenderedDom: failed to load handlers —', err.message);
    handlers = {};
  }
  return handlers;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'capture_rendered_page_model',
    description: [
      'Loads a URL in headless Chromium and returns a compact rendered page model.',
      'The page model includes headings, landmarks, links, buttons, forms, images, visible text, and diagnostics.',
      'Full rendered HTML and ARIA snapshot are stored server-side behind a snapshot_id.',
      'Default output does NOT include raw HTML — use inspect_rendered_selector for targeted HTML.',
      'Use the returned snapshot_id with other tools for deep inspection.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to render. Must be in the allowed origins list.' },
        viewport: {
          type: 'string',
          enum: ['desktop', 'mobile', 'tablet'],
          default: 'desktop',
          description: 'Viewport preset.',
        },
        wait_until: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          default: 'networkidle',
          description: 'Navigation wait strategy.',
        },
        wait_for_selector: {
          type: 'string',
          description: 'Optional CSS selector to wait for after navigation (useful for JS-heavy pages).',
        },
        max_text_chars: {
          type: 'integer',
          default: 8000,
          description: 'Maximum characters for visible_text_excerpt. Hard cap: 8000.',
        },
        include_aria_snapshot: {
          type: 'boolean',
          default: true,
          description: 'If true, captures and stores a full-page ARIA snapshot.',
        },
        resource_mode: {
          type: 'string',
          enum: ['accurate', 'balanced', 'fast'],
          default: 'balanced',
          description: 'accurate=all resources; balanced=block media/analytics; fast=block images/fonts/media.',
        },
        timeout_ms: {
          type: 'integer',
          default: 30000,
          description: 'Navigation timeout in milliseconds.',
        },
      },
      required: ['url'],
    },
  },

  {
    name: 'inspect_rendered_selector',
    description: [
      'Inspects a specific part of a previously captured rendered page using a CSS selector.',
      'This is the primary token-control tool — use it instead of requesting raw HTML for the whole page.',
      'Returns node details including role, accessible name, states, computed styles, and bounding boxes.',
      'Requires a snapshot_id from capture_rendered_page_model.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        snapshot_id: { type: 'string', description: 'snapshot_id returned by capture_rendered_page_model.' },
        selector: { type: 'string', description: 'CSS selector to inspect (e.g. "nav", "main", "form", ".modal").' },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['html', 'computed_styles', 'accessible_names', 'bounding_boxes', 'states'] },
          default: ['html', 'computed_styles', 'accessible_names', 'bounding_boxes', 'states'],
          description: 'Which node properties to include in the response.',
        },
        max_nodes: {
          type: 'integer',
          default: 80,
          description: 'Maximum nodes to return. Hard cap: 80.',
        },
        max_html_chars: {
          type: 'integer',
          default: 12000,
          description: 'Maximum HTML excerpt characters per node.',
        },
      },
      required: ['snapshot_id', 'selector'],
    },
  },

  {
    name: 'capture_aria_snapshot',
    description: [
      'Returns a Playwright ARIA/accessibility snapshot for the full page or a CSS selector.',
      'The ARIA snapshot shows the accessibility tree as seen by assistive technologies.',
      'This is NOT a screen reader test — it shows structure, not interaction behaviour.',
      'Requires a snapshot_id from capture_rendered_page_model.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        snapshot_id: { type: 'string', description: 'snapshot_id returned by capture_rendered_page_model.' },
        selector: {
          type: 'string',
          description: 'CSS selector to scope the ARIA snapshot. Omit for full page.',
        },
        max_chars: {
          type: 'integer',
          default: 12000,
          description: 'Maximum characters in the ARIA snapshot output. Hard cap: 12000.',
        },
      },
      required: ['snapshot_id'],
    },
  },

  {
    name: 'run_accessibility_scan',
    description: [
      'Runs an automated axe-core accessibility scan on a previously captured rendered page.',
      'Returns WCAG violations, incomplete checks, and pass counts.',
      'Automated scans detect only a subset of WCAG issues.',
      'DO NOT claim a page is accessible or WCAG compliant based on this scan alone.',
      'Requires a snapshot_id from capture_rendered_page_model.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        snapshot_id: { type: 'string', description: 'snapshot_id returned by capture_rendered_page_model.' },
        selector: {
          type: 'string',
          description: 'Scope scan to a CSS selector. Omit for full page.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          default: ['wcag2a', 'wcag2aa', 'wcag21aa'],
          description: 'WCAG rule tags to include (e.g. ["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).',
        },
        return_passes: {
          type: 'boolean',
          default: false,
          description: 'Include passing rules in the response.',
        },
        return_incomplete: {
          type: 'boolean',
          default: true,
          description: 'Include incomplete (needs-review) checks in the response.',
        },
      },
      required: ['snapshot_id'],
    },
  },

  {
    name: 'interact_and_snapshot',
    description: [
      'Runs a scripted interaction sequence in a headless browser and captures post-interaction state.',
      'Use this to inspect menus, modals, accordions, and dynamic UI that only appears after user actions.',
      'Allowed actions: click, focus, press_key, type_text, select_option, wait_for_selector, wait_for_timeout.',
      'Arbitrary JavaScript execution is NOT permitted.',
      'Requires a snapshot_id from capture_rendered_page_model.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        snapshot_id: { type: 'string', description: 'snapshot_id returned by capture_rendered_page_model.' },
        steps: {
          type: 'array',
          maxItems: 10,
          description: 'Ordered interaction steps to execute.',
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['click', 'focus', 'press_key', 'type_text', 'select_option', 'wait_for_selector', 'wait_for_timeout'],
              },
              selector: { type: 'string', description: 'CSS selector (required for most actions).' },
              key: { type: 'string', description: 'Key name for press_key (e.g. "Escape", "Tab", "Enter").' },
              value: { type: 'string', description: 'Text for type_text or option value for select_option.' },
              timeout_ms: { type: 'integer', description: 'Timeout for wait actions (max 5000ms).' },
            },
            required: ['action'],
          },
        },
        capture: {
          type: 'object',
          description: 'What to capture after the interaction completes.',
          properties: {
            page_model: { type: 'boolean', default: true },
          },
        },
      },
      required: ['snapshot_id', 'steps'],
    },
  },

  {
    name: 'compare_static_and_rendered',
    description: [
      'Compares raw HTML source with a browser-rendered snapshot to detect JavaScript-dependent content.',
      'Reveals what disappears if JavaScript fails: headings, links, buttons, forms, landmarks.',
      'Useful for progressive enhancement assurance and JS-dependency risk assessment.',
      'Requires a rendered_snapshot_id from capture_rendered_page_model plus raw HTML or a URL.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        rendered_snapshot_id: { type: 'string', description: 'snapshot_id from capture_rendered_page_model.' },
        static_html: {
          type: 'string',
          description: 'Raw HTML source to compare against. Use this or static_url.',
        },
        static_url: {
          type: 'string',
          description: 'URL to fetch raw HTML from (must be in allowed origins). Use this or static_html.',
        },
        compare: {
          type: 'array',
          items: { type: 'string', enum: ['headings', 'links', 'buttons', 'forms', 'landmarks'] },
          default: ['headings', 'links', 'buttons', 'forms', 'landmarks'],
          description: 'Which element types to compare.',
        },
      },
      required: ['rendered_snapshot_id'],
    },
  },
];

// ─── MCP manifest ─────────────────────────────────────────────────────────────

const MANIFEST = {
  protocolVersion: '2024-11-05',
  capabilities: { tools: {} },
  serverInfo: {
    name: 'gcc-rendered-dom-mcp',
    version: '1.0.0',
    instructions: `RENDERED DOM MCP

Captures and inspects browser-rendered page state for accessibility evidence.

TOOLS (call in this order):
1. capture_rendered_page_model  — load a URL in headless Chromium, get compact page model + snapshot_id
2. inspect_rendered_selector    — inspect nav, main, form, or any selector from the snapshot
3. capture_aria_snapshot        — get ARIA tree for a specific component
4. run_accessibility_scan       — run axe-core for automated WCAG violation detection
5. interact_and_snapshot        — click/type to reveal menus, modals, dynamic content
6. compare_static_and_rendered  — detect JS-dependent content vs raw HTML source

TOKEN DISCIPLINE:
- capture_rendered_page_model returns a COMPACT model (no raw HTML by default).
- Use inspect_rendered_selector to retrieve HTML for a specific selector only.
- Every heavy artefact is stored server-side behind a snapshot_id.

GOVERNANCE:
- Results are browser evidence, not an accessibility audit.
- Automated axe scans detect only a subset of WCAG issues.
- Do not claim pages are accessible based solely on these tools.
- Snapshots expire after 15 minutes.`,
  },
};

// ─── MCP JSON-RPC handler ─────────────────────────────────────────────────────

async function handleMcpRequest(requestBody, context) {
  if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
    return {
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid Request: body must be a JSON object' },
      id: null,
    };
  }

  const { jsonrpc, method, params, id } = requestBody;
  const requestId = Object.prototype.hasOwnProperty.call(requestBody, 'id') && id !== undefined ? id : null;

  if (jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
      id: requestId,
    };
  }

  context.log(`Rendered DOM MCP method: ${method}`);

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
      const toolStart = Date.now();

      if (!name) {
        return {
          jsonrpc: '2.0',
          error: { code: -32602, message: 'Invalid params: tool name is required' },
          id,
        };
      }

      const toolHandlers = loadHandlers();
      const handler = toolHandlers[name];

      if (!handler) {
        return {
          jsonrpc: '2.0',
          error: {
            code: -32602,
            message: `Unknown tool: ${name}. Available: ${TOOLS.map(t => t.name).join(', ')}`,
          },
          id,
        };
      }

      let args = rawArgs;
      if (typeof rawArgs === 'string') {
        try {
          args = JSON.parse(rawArgs);
        } catch {
          return {
            jsonrpc: '2.0',
            error: { code: -32602, message: 'Invalid params: arguments must be valid JSON' },
            id,
          };
        }
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return {
          jsonrpc: '2.0',
          error: { code: -32602, message: 'Invalid params: arguments must be an object' },
          id,
        };
      }

      try {
        context.log(`Rendered DOM executing tool: ${name}`);
        const result = await handler(args);
        context.log(`Rendered DOM tool completed [${name}] in ${Date.now() - toolStart}ms`);
        return {
          jsonrpc: '2.0',
          result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          id,
        };
      } catch (err) {
        context.log.error(`Rendered DOM tool error [${name}]: ${err.message}`);
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
      return {
        jsonrpc: '2.0',
        error: { code: -32601, message: `Method not found: ${method}` },
        id,
      };
  }
}

// ─── HTTP trigger registration ────────────────────────────────────────────────

app.http('mcpRenderedDom', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'mcp-rendered-dom',
  handler: async (request, context) => {
    const requestStart = Date.now();
    context.log('Rendered DOM MCP request received');

    try {
      if (request.method === 'GET') {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(MANIFEST),
        };
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error: Invalid JSON' },
            id: null,
          }),
        };
      }

      const response = await handleMcpRequest(body, context);

      if (response === null) {
        context.log(`Rendered DOM MCP 204 in ${Date.now() - requestStart}ms`);
        return { status: 204 };
      }

      context.log(`Rendered DOM MCP 200 in ${Date.now() - requestStart}ms`);
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      };
    } catch (err) {
      context.log.error('Rendered DOM MCP unhandled error:', err.message);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: err.message },
          id: null,
        }),
      };
    }
  },
});

module.exports = { handleMcpRequest, TOOLS };
