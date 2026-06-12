'use strict';

// ─── Mock @azure/functions before loading the module ─────────────────────────
let registeredHandler;
const httpMock = jest.fn((name, registration) => {
  registeredHandler = registration.handler;
});

jest.doMock('@azure/functions', () => ({
  app: { http: httpMock },
}));

// ─── Load the module under test ───────────────────────────────────────────────
const { handleMcpRequest, TOOLS } = require('../src/functions/mcpRenderedDom');

const mockContext = {
  log: Object.assign(jest.fn(), { error: jest.fn() }),
};

// ─── Protocol validation ──────────────────────────────────────────────────────

describe('handleMcpRequest — protocol validation', () => {
  it('rejects non-object body', async () => {
    const result = await handleMcpRequest('bad', mockContext);
    expect(result.error.code).toBe(-32600);
  });

  it('rejects array body', async () => {
    const result = await handleMcpRequest([], mockContext);
    expect(result.error.code).toBe(-32600);
  });

  it('rejects jsonrpc !== "2.0"', async () => {
    const result = await handleMcpRequest({ jsonrpc: '1.0', method: 'initialize', id: 1 }, mockContext);
    expect(result.error.code).toBe(-32600);
  });

  it('returns null for notifications/initialized', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, mockContext);
    expect(result).toBeNull();
  });

  it('returns error for unknown method', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'unknown/method', id: 1 }, mockContext);
    expect(result.error.code).toBe(-32601);
  });

  it('responds to ping', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'ping', id: 2 }, mockContext);
    expect(result.result).toEqual({});
  });
});

// ─── Manifest / initialize ────────────────────────────────────────────────────

describe('handleMcpRequest — initialize', () => {
  it('returns correct manifest', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'initialize', id: 1 }, mockContext);
    expect(result.result.protocolVersion).toBe('2024-11-05');
    expect(result.result.serverInfo.name).toBe('gcc-rendered-dom-mcp');
    expect(result.result.serverInfo.version).toBe('2.0.0');
    expect(result.result.capabilities).toEqual({ tools: {} });
  });
});

// ─── Tools list ───────────────────────────────────────────────────────────────

describe('handleMcpRequest — tools/list', () => {
  it('returns exactly three tools', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 1 }, mockContext);
    expect(result.result.tools).toHaveLength(3);
  });

  it('returns evaluate_page, evaluate_dom_bundle, inspect_dom_selector', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 1 }, mockContext);
    const names = result.result.tools.map(t => t.name);
    expect(names).toContain('evaluate_page');
    expect(names).toContain('evaluate_dom_bundle');
    expect(names).toContain('inspect_dom_selector');
  });

  it('all tools have inputSchema with required array', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 1 }, mockContext);
    for (const tool of result.result.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });

  it('TOOLS export matches tools/list response length', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 1 }, mockContext);
    expect(result.result.tools.length).toBe(TOOLS.length);
  });
});

// ─── Tools dispatch ───────────────────────────────────────────────────────────

describe('handleMcpRequest — tools/call dispatch', () => {
  it('returns error for missing tool name', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: {} },
      id: 1,
    }, mockContext);
    expect(result.error.code).toBe(-32602);
  });

  it('returns error for unknown tool name', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'nonexistent_tool', arguments: {} },
      id: 1,
    }, mockContext);
    expect(result.error.code).toBe(-32602);
    expect(result.error.message).toContain('nonexistent_tool');
  });

  it('returns error for array arguments', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'evaluate_page', arguments: [1, 2, 3] },
      id: 1,
    }, mockContext);
    expect(result.error.code).toBe(-32602);
  });

  it('parses string-encoded JSON arguments', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'evaluate_page', arguments: JSON.stringify({ url: 'http://localhost/bad' }) },
      id: 1,
    }, mockContext);
    // Argument parsing succeeds; URL guard then rejects
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error.code).toBe('SSRF_BLOCKED');
  });

  it('rejects invalid JSON string arguments', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'evaluate_page', arguments: '{not valid json' },
      id: 1,
    }, mockContext);
    expect(result.error.code).toBe(-32602);
  });
});

// ─── url-guard — validateUrl ──────────────────────────────────────────────────

describe('url-guard — validateUrl', () => {
  const { validateUrl } = require('../src/rendered-dom/url-guard');

  it('allows example.com', () => {
    expect(validateUrl('https://example.com/path').allowed).toBe(true);
  });

  it('allows gloucester.gov.uk', () => {
    expect(validateUrl('https://www.gloucester.gov.uk/').allowed).toBe(true);
    expect(validateUrl('https://careers.gloucester.gov.uk/jobs').allowed).toBe(true);
    expect(validateUrl('https://gloucester.gov.uk/').allowed).toBe(true);
    expect(validateUrl('https://staging.gloucester.gov.uk/').allowed).toBe(true);
  });

  it('blocks localhost', () => {
    const r = validateUrl('https://localhost:3000');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('SSRF_BLOCKED');
  });

  it('blocks private IP 192.168.x.x', () => {
    const r = validateUrl('https://192.168.1.1/admin');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('SSRF_BLOCKED');
  });

  it('blocks private IP 10.x.x.x', () => {
    const r = validateUrl('http://10.0.0.1/');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('SSRF_BLOCKED');
  });

  it('blocks link-local / metadata endpoint', () => {
    const r = validateUrl('http://169.254.169.254/latest/meta-data/');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('SSRF_BLOCKED');
  });

  it('blocks file:// protocol', () => {
    const r = validateUrl('file:///etc/passwd');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('URL_NOT_ALLOWED');
  });

  it('blocks disallowed domain', () => {
    const r = validateUrl('https://evil.com/steal');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('URL_NOT_ALLOWED');
  });

  it('returns URL_INVALID for empty string', () => {
    const r = validateUrl('');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('URL_INVALID');
  });

  it('returns URL_INVALID for malformed URL', () => {
    const r = validateUrl('not a url at all');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('URL_INVALID');
  });
});

// ─── url-guard — validateResourceUrl ─────────────────────────────────────────

describe('url-guard — validateResourceUrl', () => {
  const { validateResourceUrl } = require('../src/rendered-dom/url-guard');

  it('allows CDN resources (no allowlist restriction)', () => {
    expect(validateResourceUrl('https://cdnjs.cloudflare.com/libs/style.css').allowed).toBe(true);
    expect(validateResourceUrl('https://fonts.googleapis.com/css2?family=Open+Sans').allowed).toBe(true);
  });

  it('allows any https domain not on SSRF blocklist', () => {
    expect(validateResourceUrl('https://arbitrary-cdn.net/app.css').allowed).toBe(true);
  });

  it('blocks SSRF even for resource URLs', () => {
    expect(validateResourceUrl('http://169.254.169.254/bootstrap.css').allowed).toBe(false);
    expect(validateResourceUrl('http://10.0.0.1/internal.js').allowed).toBe(false);
    expect(validateResourceUrl('http://localhost/style.css').allowed).toBe(false);
  });

  it('blocks file:// protocol', () => {
    expect(validateResourceUrl('file:///etc/passwd').allowed).toBe(false);
  });
});

// ─── Snapshot store ───────────────────────────────────────────────────────────

describe('snapshot-store', () => {
  const store = require('../src/rendered-dom/snapshot-store');

  it('creates a snapshot and returns a snap_ id', () => {
    const id = store.create({ url: 'https://example.com', finalUrl: 'https://example.com/' });
    expect(typeof id).toBe('string');
    expect(id.startsWith('snap_')).toBe(true);
  });

  it('stores and retrieves a string artifact', () => {
    const id = store.create({ url: 'https://example.com' });
    store.setArtifact(id, 'html', '<html></html>');
    expect(store.getArtifact(id, 'html')).toBe('<html></html>');
  });

  it('returns null for a missing artifact slot', () => {
    const id = store.create({ url: 'https://example.com' });
    expect(store.getArtifact(id, 'nonexistent')).toBeNull();
  });

  it('returns null for unknown snapshot_id', () => {
    expect(store.getArtifact('snap_doesnotexist', 'html')).toBeNull();
  });

  it('exists() returns true for live snapshot, false for unknown', () => {
    const id = store.create({ url: 'https://example.com' });
    expect(store.exists(id)).toBe(true);
    expect(store.exists('snap_fake')).toBe(false);
  });

  it('computes a sha256 hash for html artifacts', () => {
    const id = store.create({ url: 'https://example.com' });
    store.setArtifact(id, 'html', '<html>test</html>');
    const meta = store.getMetadata(id);
    expect(meta.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('stores and retrieves JSON object artifacts', () => {
    const id = store.create({ url: 'https://example.com' });
    const model = { headings: [{ level: 1, text: 'Hello' }] };
    store.setArtifact(id, 'page_model', model);
    expect(store.getArtifact(id, 'page_model')).toEqual(model);
  });
});

// ─── Governance ───────────────────────────────────────────────────────────────

describe('governance', () => {
  const gov = require('../src/rendered-dom/governance');

  it('evaluationGovernance has correct structure', () => {
    const g = gov.evaluationGovernance({});
    expect(g.finding_classification).toBe('not_tested');
    expect(g.scope).toBe('jsdom_dom_evaluation');
    expect(g.engine).toBe('jsdom + axe-core');
    expect(Array.isArray(g.claim_boundary.can_claim)).toBe(true);
    expect(Array.isArray(g.claim_boundary.cannot_claim)).toBe(true);
    expect(Array.isArray(g.limitations)).toBe(true);
  });

  it('evaluationGovernance cannot_claim includes colour contrast caveat', () => {
    const g = gov.evaluationGovernance({});
    expect(g.claim_boundary.cannot_claim.some(c => c.toLowerCase().includes('colour contrast'))).toBe(true);
  });

  it('evaluationGovernance cannot_claim includes WCAG compliance caveat', () => {
    const g = gov.evaluationGovernance({});
    expect(g.claim_boundary.cannot_claim.some(c => c.toLowerCase().includes('wcag compliant'))).toBe(true);
  });

  it('evaluationGovernance reflects jsExecuted: true', () => {
    const g = gov.evaluationGovernance({ jsExecuted: true });
    expect(g.limitations.some(l => l.includes('JavaScript was executed'))).toBe(true);
  });

  it('evaluationGovernance reflects jsExecuted: false', () => {
    const g = gov.evaluationGovernance({ jsExecuted: false });
    expect(g.limitations.some(l => l.includes('JavaScript was not executed'))).toBe(true);
  });

  it('selectorGovernance includes match count', () => {
    const g = gov.selectorGovernance(5);
    expect(g.scope).toBe('jsdom_selector_inspection');
    expect(g.claim_boundary.can_claim[0]).toContain('5');
  });

  it('errorGovernance sets finding_classification to not_tested', () => {
    const g = gov.errorGovernance('jsdom_dom_evaluation');
    expect(g.finding_classification).toBe('not_tested');
    expect(g.scope).toBe('jsdom_dom_evaluation');
  });

  it('errorGovernance accepts custom scope', () => {
    const g = gov.errorGovernance('custom_scope');
    expect(g.scope).toBe('custom_scope');
  });
});

// ─── evaluate_page — URL guard integration ────────────────────────────────────

describe('evaluate_page — URL guard', () => {
  it('blocks disallowed domain', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'evaluate_page', arguments: { url: 'https://evil.com/steal' } },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error.code).toBe('URL_NOT_ALLOWED');
  });

  it('blocks SSRF to localhost', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'evaluate_page', arguments: { url: 'http://localhost/admin' } },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error.code).toBe('SSRF_BLOCKED');
  });

  it('blocks SSRF to 10.x.x.x', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'evaluate_page', arguments: { url: 'http://10.0.0.1/config' } },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error.code).toBe('SSRF_BLOCKED');
  });

  it('returns URL_INVALID when url is omitted', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'evaluate_page', arguments: {} },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error.code).toBe('URL_INVALID');
  });
});

// ─── evaluate_dom_bundle — input validation ───────────────────────────────────

describe('evaluate_dom_bundle — input validation', () => {
  it('returns error when html is missing', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'evaluate_dom_bundle', arguments: {} },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe('URL_INVALID');
  });

  it('returns error when html is not a string', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'evaluate_dom_bundle', arguments: { html: 42 } },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error.code).toBe('URL_INVALID');
  });

  it('returns error when css is not an array', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'evaluate_dom_bundle', arguments: { html: '<html></html>', css: 'body{}' } },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error.code).toBe('URL_INVALID');
  });
});

// ─── inspect_dom_selector — input validation ──────────────────────────────────

describe('inspect_dom_selector — input validation', () => {
  it('requires snapshot_id', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'inspect_dom_selector', arguments: { selector: 'nav' } },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error.code).toBe('SNAPSHOT_EXPIRED');
  });

  it('requires selector', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'inspect_dom_selector', arguments: { snapshot_id: 'snap_fake' } },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error.code).toBe('SELECTOR_INVALID');
  });

  it('returns SNAPSHOT_EXPIRED for unknown snapshot_id', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'inspect_dom_selector',
        arguments: { snapshot_id: 'snap_doesnotexist_xyz', selector: 'nav' },
      },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error.code).toBe('SNAPSHOT_EXPIRED');
  });
});

// ─── inspect_dom_selector — jsdom evaluation ─────────────────────────────────

describe('inspect_dom_selector — jsdom evaluation', () => {
  const store = require('../src/rendered-dom/snapshot-store');
  const { inspectDomSelector } = require('../src/rendered-dom/tools/inspect-dom-selector');

  it('finds a nav element and returns its accessible name', async () => {
    const id = store.create({ url: 'https://example.com' });
    store.setArtifact(id, 'html',
      '<html><body><nav aria-label="Main"><a href="/">Home</a></nav></body></html>'
    );
    const result = await inspectDomSelector({ snapshot_id: id, selector: 'nav' });
    expect(result.matches).toBe(1);
    expect(result.nodes[0].tag).toBe('nav');
    expect(result.nodes[0].accessible_name).toBe('Main');
  });

  it('returns zero matches when selector finds nothing', async () => {
    const id = store.create({ url: 'https://example.com' });
    store.setArtifact(id, 'html', '<html><body><p>No nav here</p></body></html>');
    const result = await inspectDomSelector({ snapshot_id: id, selector: 'nav' });
    expect(result.matches).toBe(0);
    expect(result.nodes).toHaveLength(0);
  });

  it('returns SELECTOR_INVALID for an invalid CSS selector', async () => {
    const id = store.create({ url: 'https://example.com' });
    store.setArtifact(id, 'html', '<html><body></body></html>');
    const result = await inspectDomSelector({ snapshot_id: id, selector: '::not-a-selector' });
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe('SELECTOR_INVALID');
  });

  it('includes governance in the response', async () => {
    const id = store.create({ url: 'https://example.com' });
    store.setArtifact(id, 'html', '<html><body><h1>Title</h1></body></html>');
    const result = await inspectDomSelector({ snapshot_id: id, selector: 'h1' });
    expect(result.governance).toBeDefined();
    expect(result.governance.scope).toBe('jsdom_selector_inspection');
  });

  it('respects max_nodes limit', async () => {
    const items = Array.from({ length: 10 }, (_, i) => `<li>Item ${i}</li>`).join('');
    const id = store.create({ url: 'https://example.com' });
    store.setArtifact(id, 'html', `<html><body><ul>${items}</ul></body></html>`);
    const result = await inspectDomSelector({ snapshot_id: id, selector: 'li', max_nodes: 3 });
    expect(result.nodes).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.matches).toBe(10);
  });

  it('returns html_excerpt when include contains html', async () => {
    const id = store.create({ url: 'https://example.com' });
    store.setArtifact(id, 'html', '<html><body><button type="button">Click me</button></body></html>');
    const result = await inspectDomSelector({
      snapshot_id: id,
      selector: 'button',
      include: ['html'],
    });
    expect(result.nodes[0].html_excerpt).toContain('Click me');
  });
});

// ─── evaluate_dom_bundle — jsdom + axe-core evaluation ───────────────────────

describe('evaluate_dom_bundle — jsdom + axe-core evaluation', () => {
  beforeAll(() => jest.setTimeout(30_000));
  afterAll(() => jest.setTimeout(5_000));

  const { evaluateDomBundle } = require('../src/rendered-dom/tools/evaluate-dom-bundle');

  it('evaluates minimal HTML and returns page model', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>Test</title></head><body><h1>Hello World</h1></body></html>',
    });
    expect(result.error).toBeUndefined();
    expect(result.page_model.headings).toHaveLength(1);
    expect(result.page_model.headings[0].text).toBe('Hello World');
    expect(result.page_model.language).toBe('en');
  });

  it('returns an axe violations array', async () => {
    const result = await evaluateDomBundle({
      html: '<html><body><h1>Hi</h1></body></html>',
    });
    expect(result.axe).toBeDefined();
    expect(Array.isArray(result.axe.violations)).toBe(true);
    expect(typeof result.axe.violations_total).toBe('number');
  });

  it('returns a snapshot_id for follow-up inspection', async () => {
    const result = await evaluateDomBundle({
      html: '<html><body><p>Content</p></body></html>',
    });
    expect(result.snapshot.snapshot_id).toMatch(/^snap_/);
  });

  it('returns governance with jsdom scope', async () => {
    const result = await evaluateDomBundle({
      html: '<html><body></body></html>',
    });
    expect(result.governance.scope).toBe('jsdom_dom_evaluation');
  });

  it('includes accessibility_mcp_handoff with required arrays', async () => {
    const result = await evaluateDomBundle({
      html: '<html><body><p>Text</p></body></html>',
    });
    const h = result.accessibility_mcp_handoff;
    expect(Array.isArray(h.elements_for_contrast_review)).toBe(true);
    expect(Array.isArray(h.css_colour_declarations)).toBe(true);
    expect(Array.isArray(h.css_font_declarations)).toBe(true);
  });

  it('extracts css_colour_declarations from supplied CSS', async () => {
    const result = await evaluateDomBundle({
      html: '<html><body><p>Text</p></body></html>',
      css: ['p { color: #333333; background-color: #ffffff; }'],
    });
    const decls = result.accessibility_mcp_handoff.css_colour_declarations;
    expect(decls.length).toBeGreaterThan(0);
    expect(decls.some(d => d.property === 'color')).toBe(true);
  });

  it('detects a form field with a label association', async () => {
    const result = await evaluateDomBundle({
      html: `<html><body>
        <form>
          <label for="email">Email</label>
          <input id="email" type="email" name="email">
        </form>
      </body></html>`,
    });
    expect(result.page_model.forms).toHaveLength(1);
    const field = result.page_model.forms[0].fields[0];
    expect(field.has_label).toBe(true);
    expect(field.label_text).toBe('Email');
  });

  it('flags an image that is missing alt text', async () => {
    const result = await evaluateDomBundle({
      html: '<html><body><img src="logo.png"></body></html>',
    });
    expect(result.page_model.images.some(i => i.missing_alt)).toBe(true);
  });

  it('returns next_actions array with at least one entry', async () => {
    const result = await evaluateDomBundle({
      html: '<html><body></body></html>',
    });
    expect(Array.isArray(result.next_actions)).toBe(true);
    expect(result.next_actions.length).toBeGreaterThan(0);
  });

  it('snapshot_id in next_actions matches snapshot.snapshot_id', async () => {
    const result = await evaluateDomBundle({
      html: '<html><body></body></html>',
    });
    const snapId = result.snapshot.snapshot_id;
    expect(result.next_actions.some(a => a.includes(snapId))).toBe(true);
  });
});

// ─── HTTP trigger handler ─────────────────────────────────────────────────────

describe('HTTP trigger handler', () => {
  it('is registered as mcpRenderedDom on route mcp-rendered-dom', () => {
    expect(httpMock).toHaveBeenCalledWith(
      'mcpRenderedDom',
      expect.objectContaining({ route: 'mcp-rendered-dom' })
    );
  });

  it('returns manifest on GET', async () => {
    const response = await registeredHandler({ method: 'GET' }, mockContext);
    const manifest = JSON.parse(response.body);
    expect(response.status).toBe(200);
    expect(manifest.serverInfo.name).toBe('gcc-rendered-dom-mcp');
    expect(manifest.serverInfo.version).toBe('2.0.0');
  });

  it('returns 400 on unparseable JSON body', async () => {
    const response = await registeredHandler(
      { method: 'POST', json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')) },
      mockContext
    );
    expect(response.status).toBe(400);
  });

  it('returns 204 for notifications/initialized', async () => {
    const response = await registeredHandler(
      { method: 'POST', json: jest.fn().mockResolvedValue({ jsonrpc: '2.0', method: 'notifications/initialized' }) },
      mockContext
    );
    expect(response.status).toBe(204);
  });

  it('returns 200 with three tools in list', async () => {
    const response = await registeredHandler(
      { method: 'POST', json: jest.fn().mockResolvedValue({ jsonrpc: '2.0', method: 'tools/list', id: 1 }) },
      mockContext
    );
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.result.tools).toHaveLength(3);
  });
});
