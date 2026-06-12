'use strict';

// ─── Mock @azure/functions before loading the module ─────────────────────────
let registeredHandler;
const httpMock = jest.fn((name, registration) => {
  registeredHandler = registration.handler;
});

jest.doMock('@azure/functions', () => ({
  app: { http: httpMock },
}));

// ─── Mock playwright (not needed for unit tests of MCP protocol) ─────────────
jest.doMock('playwright', () => ({
  chromium: {
    launch: jest.fn().mockResolvedValue({
      isConnected: () => true,
      newContext: jest.fn().mockResolvedValue({
        setDefaultTimeout: jest.fn(),
        setDefaultNavigationTimeout: jest.fn(),
        newPage: jest.fn().mockResolvedValue({
          on: jest.fn(),
          goto: jest.fn().mockResolvedValue({ status: () => 200 }),
          url: jest.fn().mockReturnValue('https://example.com/'),
          title: jest.fn().mockResolvedValue('Example Domain'),
          content: jest.fn().mockResolvedValue('<html><head><title>Example</title></head><body><h1>Example</h1></body></html>'),
          ariaSnapshot: jest.fn().mockResolvedValue('- heading "Example" [level=1]'),
          locator: jest.fn().mockReturnValue({
            ariaSnapshot: jest.fn().mockResolvedValue('- heading "Example" [level=1]'),
            click: jest.fn().mockResolvedValue(undefined),
            focus: jest.fn().mockResolvedValue(undefined),
            press: jest.fn().mockResolvedValue(undefined),
            fill: jest.fn().mockResolvedValue(undefined),
            selectOption: jest.fn().mockResolvedValue(undefined),
          }),
          route: jest.fn().mockResolvedValue(undefined),
          setContent: jest.fn().mockResolvedValue(undefined),
          waitForSelector: jest.fn().mockResolvedValue(undefined),
          waitForTimeout: jest.fn().mockResolvedValue(undefined),
          evaluate: jest.fn().mockResolvedValue({
            language: 'en',
            headings: [{ level: 1, text: 'Example', visible: true }],
            landmarks: [],
            links: [{ text: 'More info', href: 'https://example.com/more', name: null, visible: true }],
            buttons: [],
            forms: [],
            images: [],
            visible_text_excerpt: 'Example Domain\nThis domain is for use in illustrative examples.',
            counts: { headings: 1, links: 1, buttons: 0, forms: 0, images: 0 },
          }),
          $$: jest.fn().mockResolvedValue([]),
        }),
        close: jest.fn().mockResolvedValue(undefined),
        route: jest.fn().mockResolvedValue(undefined),
      }),
      close: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

// ─── Mock @axe-core/playwright ────────────────────────────────────────────────
jest.doMock('@axe-core/playwright', () => ({
  AxeBuilder: jest.fn().mockImplementation(() => ({
    include: jest.fn().mockReturnThis(),
    withTags: jest.fn().mockReturnThis(),
    analyze: jest.fn().mockResolvedValue({
      violations: [],
      passes: [{ id: 'color-contrast', description: 'Passes colour contrast', nodes: [] }],
      incomplete: [],
      inapplicable: [],
    }),
  })),
}));

// ─── Load the module under test ───────────────────────────────────────────────
const { handleMcpRequest, TOOLS } = require('../src/functions/mcpRenderedDom');

const mockContext = {
  log: Object.assign(jest.fn(), { error: jest.fn() }),
};

// ─── Protocol validation tests ────────────────────────────────────────────────

describe('handleMcpRequest — protocol validation', () => {
  it('rejects non-object body', async () => {
    const result = await handleMcpRequest('bad', mockContext);
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
    expect(result.result.capabilities).toEqual({ tools: {} });
  });
});

// ─── Tools list ───────────────────────────────────────────────────────────────

describe('handleMcpRequest — tools/list', () => {
  it('returns all six tools', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 1 }, mockContext);
    const names = result.result.tools.map(t => t.name);
    expect(names).toContain('capture_rendered_page_model');
    expect(names).toContain('inspect_rendered_selector');
    expect(names).toContain('capture_aria_snapshot');
    expect(names).toContain('run_accessibility_scan');
    expect(names).toContain('interact_and_snapshot');
    expect(names).toContain('compare_static_and_rendered');
  });

  it('all tools have inputSchema with required array', async () => {
    const result = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 1 }, mockContext);
    for (const tool of result.result.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });

  it('TOOLS export matches tools/list response', async () => {
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
      params: { name: 'capture_rendered_page_model', arguments: [1, 2, 3] },
      id: 1,
    }, mockContext);
    expect(result.error.code).toBe(-32602);
  });
});

// ─── URL guard tests ──────────────────────────────────────────────────────────

describe('url-guard', () => {
  const { validateUrl } = require('../src/rendered-dom/url-guard');

  it('allows example.com', () => {
    const result = validateUrl('https://example.com/path');
    expect(result.allowed).toBe(true);
  });

  it('allows gloucester.gov.uk origins', () => {
    expect(validateUrl('https://www.gloucester.gov.uk/').allowed).toBe(true);
    expect(validateUrl('https://careers.gloucester.gov.uk/jobs').allowed).toBe(true);
  });

  it('blocks localhost', () => {
    const result = validateUrl('https://localhost:3000');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('SSRF_BLOCKED');
  });

  it('blocks private IP 192.168.x.x', () => {
    const result = validateUrl('https://192.168.1.1/admin');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('SSRF_BLOCKED');
  });

  it('blocks private IP 10.x.x.x', () => {
    const result = validateUrl('http://10.0.0.1/');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('SSRF_BLOCKED');
  });

  it('blocks metadata endpoint', () => {
    const result = validateUrl('http://169.254.169.254/latest/meta-data/');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('SSRF_BLOCKED');
  });

  it('blocks file:// protocol', () => {
    const result = validateUrl('file:///etc/passwd');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('URL_NOT_ALLOWED');
  });

  it('blocks disallowed domain', () => {
    const result = validateUrl('https://evil.com/steal');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('URL_NOT_ALLOWED');
  });

  it('returns URL_INVALID for empty string', () => {
    const result = validateUrl('');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('URL_INVALID');
  });

  it('returns URL_INVALID for malformed URL', () => {
    const result = validateUrl('not a url at all');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('URL_INVALID');
  });
});

// ─── Snapshot store tests ─────────────────────────────────────────────────────

describe('snapshot-store', () => {
  const store = require('../src/rendered-dom/snapshot-store');

  it('creates a snapshot and returns an id', () => {
    const id = store.create({ url: 'https://example.com', finalUrl: 'https://example.com/' });
    expect(typeof id).toBe('string');
    expect(id.startsWith('snap_')).toBe(true);
  });

  it('stores and retrieves an artifact', () => {
    const id = store.create({ url: 'https://example.com' });
    store.setArtifact(id, 'html', '<html></html>');
    expect(store.getArtifact(id, 'html')).toBe('<html></html>');
  });

  it('returns null for missing artifact', () => {
    const id = store.create({ url: 'https://example.com' });
    expect(store.getArtifact(id, 'nonexistent')).toBeNull();
  });

  it('returns null for unknown snapshot_id', () => {
    expect(store.getArtifact('snap_doesnotexist', 'html')).toBeNull();
  });

  it('reports exists() correctly', () => {
    const id = store.create({ url: 'https://example.com' });
    expect(store.exists(id)).toBe(true);
    expect(store.exists('snap_fake')).toBe(false);
  });

  it('computes a hash for html artifacts', () => {
    const id = store.create({ url: 'https://example.com' });
    store.setArtifact(id, 'html', '<html>test</html>');
    const meta = store.getMetadata(id);
    expect(meta.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('stores JSON objects as artifacts', () => {
    const id = store.create({ url: 'https://example.com' });
    const model = { headings: [{ level: 1, text: 'Hello' }] };
    store.setArtifact(id, 'page_model', model);
    expect(store.getArtifact(id, 'page_model')).toEqual(model);
  });
});

// ─── Governance tests ─────────────────────────────────────────────────────────

describe('governance', () => {
  const gov = require('../src/rendered-dom/governance');

  it('renderedSnapshotGovernance has correct structure', () => {
    const g = gov.renderedSnapshotGovernance();
    expect(g.finding_classification).toBe('not_tested');
    expect(g.scope).toBe('headless_browser_rendered_snapshot');
    expect(Array.isArray(g.claim_boundary.can_claim)).toBe(true);
    expect(Array.isArray(g.claim_boundary.cannot_claim)).toBe(true);
    expect(Array.isArray(g.limitations)).toBe(true);
  });

  it('accessibilityScanGovernance includes automation limitations', () => {
    const g = gov.accessibilityScanGovernance();
    expect(g.limitations.some(l => l.toLowerCase().includes('subset'))).toBe(true);
    expect(g.claim_boundary.cannot_claim.some(c => c.toLowerCase().includes('wcag compliant'))).toBe(true);
  });

  it('errorGovernance sets finding_classification to not_tested', () => {
    const g = gov.errorGovernance('rendered_browser_snapshot');
    expect(g.finding_classification).toBe('not_tested');
    expect(g.scope).toBe('rendered_browser_snapshot');
  });
});

// ─── capture_rendered_page_model — URL guard integration ─────────────────────

describe('capture_rendered_page_model — URL guard', () => {
  it('blocks disallowed URL without launching browser', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'capture_rendered_page_model',
        arguments: { url: 'https://evil.com/steal' },
      },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe('URL_NOT_ALLOWED');
  });

  it('blocks SSRF attempt to localhost', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'capture_rendered_page_model',
        arguments: { url: 'http://localhost/admin' },
      },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe('SSRF_BLOCKED');
  });

  it('returns URL_INVALID when url is missing', async () => {
    const result = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'capture_rendered_page_model', arguments: {} },
      id: 1,
    }, mockContext);
    const parsed = JSON.parse(result.result.content[0].text);
    expect(parsed.error.code).toBe('URL_INVALID');
  });
});

// ─── interact_and_snapshot — action validation ────────────────────────────────

describe('interact_and_snapshot — action validation', () => {
  const { interactAndSnapshot } = require('../src/rendered-dom/tools/interact-and-snapshot');

  it('rejects disallowed action', async () => {
    const result = await interactAndSnapshot({
      snapshot_id: 'snap_fake',
      steps: [{ action: 'evaluate', value: 'document.cookie' }],
    });
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain('evaluate');
  });

  it('rejects more than 10 steps', async () => {
    const steps = Array.from({ length: 11 }, (_, i) => ({ action: 'click', selector: '#btn' }));
    const result = await interactAndSnapshot({ snapshot_id: 'snap_fake', steps });
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain('10');
  });

  it('rejects empty steps array', async () => {
    const result = await interactAndSnapshot({ snapshot_id: 'snap_fake', steps: [] });
    expect(result.error).toBeDefined();
  });

  it('returns SNAPSHOT_EXPIRED for unknown snapshot_id', async () => {
    const result = await interactAndSnapshot({
      snapshot_id: 'snap_doesnotexist',
      steps: [{ action: 'click', selector: 'button' }],
    });
    expect(result.error.code).toBe('SNAPSHOT_EXPIRED');
  });
});

// ─── compare_static_and_rendered — validation ─────────────────────────────────

describe('compare_static_and_rendered', () => {
  const { compareStaticAndRendered } = require('../src/rendered-dom/tools/compare-static-and-rendered');

  it('requires rendered_snapshot_id', async () => {
    const result = await compareStaticAndRendered({ static_html: '<html></html>' });
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe('SNAPSHOT_EXPIRED');
  });

  it('requires static_html or static_url', async () => {
    const result = await compareStaticAndRendered({ rendered_snapshot_id: 'snap_fake' });
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe('URL_INVALID');
  });

  it('returns SNAPSHOT_EXPIRED for unknown snapshot', async () => {
    const result = await compareStaticAndRendered({
      rendered_snapshot_id: 'snap_doesnotexist',
      static_html: '<html></html>',
    });
    expect(result.error.code).toBe('SNAPSHOT_EXPIRED');
  });
});

// ─── HTTP trigger tests ───────────────────────────────────────────────────────

describe('HTTP trigger handler', () => {
  it('is registered as mcpRenderedDom on route mcp-rendered-dom', () => {
    expect(httpMock).toHaveBeenCalledWith(
      'mcpRenderedDom',
      expect.objectContaining({ route: 'mcp-rendered-dom' })
    );
  });

  it('returns manifest on GET request', async () => {
    const response = await registeredHandler(
      { method: 'GET' },
      mockContext
    );
    const manifest = JSON.parse(response.body);
    expect(response.status).toBe(200);
    expect(manifest.serverInfo.name).toBe('gcc-rendered-dom-mcp');
  });

  it('returns 400 on unparseable JSON body', async () => {
    const response = await registeredHandler(
      {
        method: 'POST',
        json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      },
      mockContext
    );
    expect(response.status).toBe(400);
  });

  it('returns 204 for notifications/initialized', async () => {
    const response = await registeredHandler(
      {
        method: 'POST',
        json: jest.fn().mockResolvedValue({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      },
      mockContext
    );
    expect(response.status).toBe(204);
  });

  it('returns 200 with tools list', async () => {
    const response = await registeredHandler(
      {
        method: 'POST',
        json: jest.fn().mockResolvedValue({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
      },
      mockContext
    );
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.result.tools.length).toBeGreaterThan(0);
  });
});
