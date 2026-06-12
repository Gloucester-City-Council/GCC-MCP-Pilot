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
// The rendered DOM tools are served by the unified Web Get MCP
const { handleMcpRequest, TOOLS } = require('../src/functions/mcpRawHtml');

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
    expect(result.result.serverInfo.name).toBe('gcc-web-get-mcp');
    expect(result.result.serverInfo.version).toBe('2.1.0');
    expect(result.result.capabilities).toEqual({ tools: {} });
  });
});

// ─── Tools list ───────────────────────────────────────────────────────────────

describe('handleMcpRequest — tools/list', () => {
  it('returns exactly four tools', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 1 }, mockContext);
    expect(result.result.tools).toHaveLength(4);
  });

  it('returns fetch_raw_html, evaluate_page, evaluate_dom_bundle, inspect_dom_selector', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 1 }, mockContext);
    const names = result.result.tools.map(t => t.name);
    expect(names).toContain('fetch_raw_html');
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

  afterEach(() => {
    delete process.env.EVALUATE_PAGE_ALLOWED_ORIGINS;
  });

  it('allows example.com', () => {
    expect(validateUrl('https://example.com/path').allowed).toBe(true);
  });

  it('allows gloucester.gov.uk', () => {
    expect(validateUrl('https://www.gloucester.gov.uk/').allowed).toBe(true);
    expect(validateUrl('https://careers.gloucester.gov.uk/jobs').allowed).toBe(true);
    expect(validateUrl('https://gloucester.gov.uk/').allowed).toBe(true);
    expect(validateUrl('https://staging.gloucester.gov.uk/').allowed).toBe(true);
  });

  it('allows any public origin when no allowlist is configured', () => {
    expect(validateUrl('https://any-public-site.org/page').allowed).toBe(true);
  });

  it('enforces EVALUATE_PAGE_ALLOWED_ORIGINS when set', () => {
    process.env.EVALUATE_PAGE_ALLOWED_ORIGINS =
      'https://www.gloucester.gov.uk, https://careers.gloucester.gov.uk/';

    expect(validateUrl('https://www.gloucester.gov.uk/jobs').allowed).toBe(true);
    expect(validateUrl('https://careers.gloucester.gov.uk/vacancies').allowed).toBe(true);

    const r = validateUrl('https://evil.com/steal');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('URL_NOT_ALLOWED');
  });

  it('SSRF guard still applies when an allowlist is configured', () => {
    process.env.EVALUATE_PAGE_ALLOWED_ORIGINS = 'https://www.gloucester.gov.uk';
    const r = validateUrl('http://169.254.169.254/latest/meta-data/');
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('SSRF_BLOCKED');
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
    expect(g.finding_classification).toBe('automated_static_dom_evaluation');
    expect(g.compliance_claim).toBe('no_compliance_claim');
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

  it('errorGovernance classifies failed runs as evaluation_incomplete', () => {
    const g = gov.errorGovernance('jsdom_dom_evaluation');
    expect(g.finding_classification).toBe('evaluation_incomplete');
    expect(g.compliance_claim).toBe('no_compliance_claim');
    expect(g.scope).toBe('jsdom_dom_evaluation');
  });

  it('errorGovernance accepts custom scope', () => {
    const g = gov.errorGovernance('custom_scope');
    expect(g.scope).toBe('custom_scope');
  });
});

// ─── evaluate_page — URL guard integration ────────────────────────────────────

describe('evaluate_page — URL guard', () => {
  afterEach(() => {
    delete process.env.EVALUATE_PAGE_ALLOWED_ORIGINS;
  });

  it('blocks disallowed domain when an allowlist is configured', async () => {
    process.env.EVALUATE_PAGE_ALLOWED_ORIGINS = 'https://www.gloucester.gov.uk';
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

// ─── evaluate_page — fetch governance (robots.txt) ────────────────────────────

describe('evaluate_page — fetch governance', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('blocks paths disallowed by robots.txt', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: jest.fn().mockResolvedValue('User-agent: *\nDisallow: /private'),
    });

    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'evaluate_page', arguments: { url: 'https://robots-blocked.example.org/private/page' } },
      id: 1,
    }, mockContext);

    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error.code).toBe('ROBOTS_DISALLOWED');
    expect(parsed.robots.checked).toBe(true);
    expect(parsed.robots.origin).toBe('https://robots-blocked.example.org');
    expect(parsed.governance.finding_classification).toBe('evaluation_incomplete');
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

// ─── JS execution containment ─────────────────────────────────────────────────

describe('evaluate_dom_bundle — JS execution containment', () => {
  jest.setTimeout(30_000);

  const { evaluateDomBundle } = require('../src/rendered-dom/tools/evaluate-dom-bundle');
  const { inspectDomSelector } = require('../src/rendered-dom/tools/inspect-dom-selector');

  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('executes supplied JS and reflects DOM mutations in the page model', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body></body></html>',
      js: ['document.body.innerHTML = "<h1>Injected heading</h1>";'],
    });
    expect(result.page_model.headings).toHaveLength(1);
    expect(result.page_model.headings[0].text).toBe('Injected heading');
    expect(result.evaluation.js_executed).toBe(true);
  });

  it('does not execute dynamically injected script tags or fetch their src', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body><main><h2 id="probe">untouched</h2></main></body></html>',
      js: [`
        const s = document.createElement('script');
        s.src = 'https://evil.example.com/more.js';
        s.textContent = 'document.getElementById("probe").textContent = "script tag executed";';
        document.body.appendChild(s);
        const inline = document.createElement('script');
        inline.textContent = 'document.getElementById("probe").textContent = "inline executed";';
        document.body.appendChild(inline);
      `],
    });

    expect(result.error).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.page_model.headings[0].text).toBe('untouched');
  });

  it('blocks XHR, fetch, and WebSocket for page JS', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body><h2 id="probe">pending</h2></body></html>',
      js: [`
        const outcomes = [];
        for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource']) {
          try { new window[name]('https://evil.example.com'); outcomes.push(name + ':open'); }
          catch { outcomes.push(name + ':blocked'); }
        }
        try { window.fetch('https://evil.example.com'); outcomes.push('fetch:open'); }
        catch { outcomes.push('fetch:blocked'); }
        document.getElementById('probe').textContent = outcomes.join(' ');
      `],
    });

    const probe = result.page_model.headings[0].text;
    expect(probe).toContain('XMLHttpRequest:blocked');
    expect(probe).toContain('WebSocket:blocked');
    expect(probe).toContain('EventSource:blocked');
    expect(probe).toContain('fetch:blocked');
  });

  it('interrupts a script that loops forever and still completes the evaluation', async () => {
    const started = Date.now();
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body><h1>Survives</h1></body></html>',
      js: ['while (true) {}'],
    });
    expect(result.error).toBeUndefined();
    expect(result.page_model.headings[0].text).toBe('Survives');
    // Per-script CPU timeout is 1.5s — well under the 30s test timeout
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('a runaway first script does not starve later scripts of the DOM result', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body></body></html>',
      js: [
        'while (true) {}',
        'document.body.innerHTML = "<h1>Second script ran</h1>";',
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.page_model.headings[0].text).toBe('Second script ran');
  });

  it('caps timer scheduling so timer chains cannot run unbounded', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body><h2 id="probe">x</h2></body></html>',
      js: [`
        let accepted = 0;
        for (let i = 0; i < 1000; i++) {
          if (window.setTimeout(() => {}, 60000)) accepted++;
        }
        document.getElementById('probe').textContent = 'accepted:' + accepted;
      `],
    });
    const probe = result.page_model.headings[0].text;
    const accepted = parseInt(probe.split(':')[1], 10);
    expect(accepted).toBeLessThanOrEqual(200);
  });

  it('inspect_dom_selector sees JS-applied DOM and supplied CSS from the snapshot', async () => {
    const evaluated = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body></body></html>',
      css: ['h1 { color: rgb(18, 52, 86); }'],
      js: ['document.body.innerHTML = "<h1>Injected heading</h1>";'],
    });

    const inspected = await inspectDomSelector({
      snapshot_id: evaluated.snapshot.snapshot_id,
      selector: 'h1',
    });

    expect(inspected.matches).toBe(1);
    expect(inspected.nodes[0].text_excerpt).toBe('Injected heading');
    expect(inspected.nodes[0].computed_styles.color).toBe('rgb(18, 52, 86)');
  });
});

// ─── HTTP trigger handler ─────────────────────────────────────────────────────

describe('HTTP trigger handler', () => {
  it('is registered as mcpRawHtml on route mcp-raw-html', () => {
    expect(httpMock).toHaveBeenCalledWith(
      'mcpRawHtml',
      expect.objectContaining({ route: 'mcp-raw-html' })
    );
  });

  it('returns manifest on GET', async () => {
    const response = await registeredHandler({ method: 'GET' }, mockContext);
    const manifest = JSON.parse(response.body);
    expect(response.status).toBe(200);
    expect(manifest.serverInfo.name).toBe('gcc-web-get-mcp');
    expect(manifest.serverInfo.version).toBe('2.1.0');
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

  it('returns 200 with four tools in list', async () => {
    const response = await registeredHandler(
      { method: 'POST', json: jest.fn().mockResolvedValue({ jsonrpc: '2.0', method: 'tools/list', id: 1 }) },
      mockContext
    );
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.result.tools).toHaveLength(4);
  });
});

// ─── Evaluation output enrichments ───────────────────────────────────────────

describe('evaluation output enrichments', () => {
  jest.setTimeout(30_000);

  const { evaluateDomBundle } = require('../src/rendered-dom/tools/evaluate-dom-bundle');
  const { inspectDomSelector } = require('../src/rendered-dom/tools/inspect-dom-selector');

  it('visible_text_excerpt keeps block boundaries between headings and paragraphs', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body><main><h1>Example Domain</h1><p>This domain is for use in examples.</p><ul><li>First item</li><li>Second item</li></ul></main></body></html>',
    });
    const text = result.page_model.visible_text_excerpt;
    expect(text).toContain('Example Domain\nThis domain');
    expect(text).toContain('First item\nSecond item');
    expect(text).not.toContain('DomainThis');
  });

  it('extracts colour declarations from inline <style> blocks with source labels', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title><style>body { background: #eee; } h1 { color: #333; }</style></head><body><h1>Hi</h1></body></html>',
    });
    const decls = result.accessibility_mcp_handoff.css_colour_declarations;
    expect(decls).toContainEqual({ source: 'inline_style_block', selector: 'body', property: 'background', value: '#eee' });
    expect(decls).toContainEqual({ source: 'inline_style_block', selector: 'h1', property: 'color', value: '#333' });
  });

  it('extracts declarations from style attributes separately', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body><p id="intro" style="color: #777; font-size: 12px">Text</p></body></html>',
    });
    const colour = result.accessibility_mcp_handoff.css_colour_declarations;
    const font = result.accessibility_mcp_handoff.css_font_declarations;
    expect(colour).toContainEqual({ source: 'style_attribute', selector: 'p#intro', property: 'color', value: '#777' });
    expect(font).toContainEqual({ source: 'style_attribute', selector: 'p#intro', property: 'font-size', value: '12px' });
  });

  it('labels supplied CSS declarations with source supplied_css', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body><p>Text</p></body></html>',
      css: ['p { color: #444; }'],
    });
    const decls = result.accessibility_mcp_handoff.css_colour_declarations;
    expect(decls.some(d => d.source === 'supplied_css' && d.property === 'color')).toBe(true);
  });

  it('explains accessible name sources for buttons', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body><button aria-label="Save draft">Save</button><button>Cancel</button></body></html>',
    });
    const [save, cancel] = result.page_model.buttons;
    expect(save.name).toBe('Save draft');
    expect(save.name_source).toBe('aria-label');
    expect(cancel.name).toBe('Cancel');
    expect(cancel.name_source).toBe('text_content');
  });

  it('explains label sources for form fields', async () => {
    const result = await evaluateDomBundle({
      html: `<html lang="en"><head><title>t</title></head><body><form>
        <label for="email">Email</label><input id="email" type="email">
        <input type="text" aria-label="Search term">
      </form></body></html>`,
    });
    const [email, search] = result.page_model.forms[0].fields;
    expect(email.label_source).toBe('label_for');
    expect(search.label_source).toBe('aria-label');
  });

  it('returns schema and engine versions', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body></body></html>',
    });
    expect(result.schema_version).toBe('web-get-evaluation-v1');
    expect(result.evaluation.tool_version).toBe('2.1.0');
    expect(result.evaluation.axe_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Array.isArray(result.evaluation.tags_run)).toBe(true);
  });

  it('suggests component selectors that exist on the page', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body><main><form><input aria-label="q"><button>Go</button></form></main></body></html>',
    });
    const suggested = result.suggested_component_selectors;
    expect(suggested).toContain('main');
    expect(suggested).toContain('form');
    expect(suggested).toContain('button');
    expect(suggested).not.toContain('video');
  });

  it('inspect_dom_selector returns schema_version and accessible_name_source', async () => {
    const evaluated = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body><nav aria-label="Main"><a href="/">Home</a></nav></body></html>',
    });
    const inspected = await inspectDomSelector({
      snapshot_id: evaluated.snapshot.snapshot_id,
      selector: 'nav',
    });
    expect(inspected.schema_version).toBe('web-get-inspection-v1');
    expect(inspected.nodes[0].accessible_name).toBe('Main');
    expect(inspected.nodes[0].accessible_name_source).toBe('aria-label');
  });

  it('reports a js_audit with dom_delta and blocked network calls', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body></body></html>',
      js: [
        'try { new XMLHttpRequest(); } catch {} document.body.innerHTML = "<form><input aria-label=\'q\'></form>";',
      ],
    });
    expect(result.js_audit.executed).toBe(1);
    expect(result.js_audit.network_calls_blocked).toBeGreaterThanOrEqual(1);
    expect(result.js_audit.dom_delta.nodes_added).toBeGreaterThanOrEqual(2);
    expect(result.js_audit.dom_delta.forms_added).toBe(1);
    expect(result.js_audit.dom_delta.aria_attributes_added).toBe(1);
  });
});

// ─── WCAG standards mode ──────────────────────────────────────────────────────

describe('evaluate_dom_bundle — standard mode', () => {
  jest.setTimeout(30_000);

  const { evaluateDomBundle } = require('../src/rendered-dom/tools/evaluate-dom-bundle');

  it('WCAG_2_2_AAA returns a coverage object with honest claim boundaries', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body><h1>Hi</h1></body></html>',
      standard: 'WCAG_2_2_AAA',
    });
    expect(result.standard).toBe('WCAG_2_2_AAA');
    expect(result.evaluation.tags_run).toContain('wcag2aaa');
    expect(result.coverage.statement).toContain('gathered evidence');
    expect(result.coverage.automated.length).toBeGreaterThan(0);
    expect(result.coverage.partially_automated.length).toBeGreaterThan(0);
    expect(result.coverage.manual_required.length).toBeGreaterThan(0);
    // No audio/video on this page, so media criteria are not applicable
    expect(result.coverage.not_applicable.some(c => c.includes('1.2.6'))).toBe(true);
  });

  it('media criteria move to manual_required when media is present', async () => {
    const result = await evaluateDomBundle({
      html: '<html lang="en"><head><title>t</title></head><body><video src="x.mp4"></video></body></html>',
      standard: 'WCAG_2_2_AAA',
    });
    expect(result.coverage.manual_required.some(c => c.includes('1.2.6'))).toBe(true);
    expect(result.coverage.not_applicable.some(c => c.includes('1.2.6'))).toBe(false);
  });

  it('rejects unknown standards', async () => {
    const result = await evaluateDomBundle({
      html: '<html><body></body></html>',
      standard: 'WCAG_9_9_ZZZ',
    });
    expect(result.error.code).toBe('STANDARD_UNKNOWN');
    expect(result.error.message).toContain('WCAG_2_2_AAA');
  });
});

// ─── CI gate and regression mode ──────────────────────────────────────────────

describe('evaluate_dom_bundle — gate and regression', () => {
  jest.setTimeout(30_000);

  const { evaluateDomBundle } = require('../src/rendered-dom/tools/evaluate-dom-bundle');

  const BROKEN = '<html lang="en"><head><title>t</title></head><body><img src="x.png"></body></html>';
  const FIXED = '<html lang="en"><head><title>t</title></head><body><img src="x.png" alt="Logo"></body></html>';

  it('gate fails on critical violations when fail_on.critical is set', async () => {
    const result = await evaluateDomBundle({ html: BROKEN, fail_on: { critical: true } });
    expect(result.gate.failed).toBe(true);
    expect(result.gate.failing_violations.some(v => v.id === 'image-alt')).toBe(true);
  });

  it('gate passes when fail_on only covers impacts that are absent', async () => {
    const result = await evaluateDomBundle({ html: FIXED, fail_on: { critical: true, serious: true } });
    expect(result.gate.failed).toBe(false);
    expect(result.gate.failing_violations).toHaveLength(0);
  });

  it('rejects a non-object fail_on', async () => {
    const result = await evaluateDomBundle({ html: FIXED, fail_on: 'critical' });
    expect(result.error.code).toBe('FAIL_ON_INVALID');
  });

  it('regression reports resolved violations against a baseline', async () => {
    const baseline = await evaluateDomBundle({ html: BROKEN });
    const followUp = await evaluateDomBundle({ html: FIXED, baseline_id: baseline.snapshot.snapshot_id });
    expect(followUp.regression.resolved_violations).toBeGreaterThanOrEqual(1);
    expect(followUp.regression.resolved_violation_ids).toContain('image-alt');
    expect(followUp.regression.new_violations).toBe(0);
  });

  it('regression reports new violations when the page regresses', async () => {
    const baseline = await evaluateDomBundle({ html: FIXED });
    const followUp = await evaluateDomBundle({ html: BROKEN, baseline_id: baseline.snapshot.snapshot_id });
    expect(followUp.regression.new_violations).toBeGreaterThanOrEqual(1);
    expect(followUp.regression.new_violation_ids).toContain('image-alt');
  });

  it('reports BASELINE_NOT_FOUND for unknown baseline ids', async () => {
    const result = await evaluateDomBundle({ html: FIXED, baseline_id: 'snap_does_not_exist' });
    expect(result.regression.error.code).toBe('BASELINE_NOT_FOUND');
  });
});

// ─── Contrast ancestor background walk ────────────────────────────────────────

describe('ancestorBackground', () => {
  const { createEnvironment, ancestorBackground } = require('../src/rendered-dom/jsdom-evaluator');

  it('finds the nearest declared ancestor background', () => {
    const { window, document } = createEnvironment({
      html: '<html><body><div><h1>Hi</h1></div></body></html>',
      cssStrings: ['body { background-color: #eee; }'],
    });
    const result = ancestorBackground(document.querySelector('h1'), window);
    expect(result.value).toBe('rgb(238, 238, 238)');
    expect(result.source).toBe('body');
    window.close();
  });

  it('returns none_declared when no ancestor declares a background', () => {
    const { window, document } = createEnvironment({
      html: '<html><body><h1>Hi</h1></body></html>',
    });
    const result = ancestorBackground(document.querySelector('h1'), window);
    expect(result.value).toBeNull();
    expect(result.source).toBe('none_declared');
    window.close();
  });
});
