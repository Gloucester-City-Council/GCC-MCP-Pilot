'use strict';

jest.mock('@azure/functions', () => ({ app: { http: jest.fn() } }));

const { Readable } = require('stream');
const {
    escapeSegment, normaliseColour, staticBadgeUrl, endpointBadgeUrl, render,
} = require('../src/gcc-shields/badge');
const { pickColour } = require('../src/gcc-shields/threshold');
const { parseIsoDate, formatDate, reviewedStamp, dueStamp } = require('../src/gcc-shields/stamp');
const { createStore, endpointJson, normaliseKey } = require('../src/gcc-shields/store');
const { createTools } = require('../src/gcc-shields/tools');
const { handleMcpRequest, handleBadgeRequest } = require('../src/functions/mcpShields');

/** In-memory stand-in for an Azure Blob container client. */
function fakeContainer() {
    const blobs = new Map();
    const notFound = () => Object.assign(new Error('The specified blob does not exist.'), { statusCode: 404 });
    return {
        blobs,
        async createIfNotExists() { return {}; },
        getBlockBlobClient(name) {
            return { async upload(content) { blobs.set(name, content); } };
        },
        getBlobClient(name) {
            return {
                async download() {
                    if (!blobs.has(name)) throw notFound();
                    return { readableStreamBody: Readable.from([Buffer.from(blobs.get(name))]) };
                },
                async deleteIfExists() {
                    return { succeeded: blobs.delete(name) };
                },
            };
        },
        async *listBlobsFlat({ prefix }) {
            for (const name of [...blobs.keys()].sort()) {
                if (name.startsWith(prefix)) yield { name };
            }
        },
    };
}

const context = { log: Object.assign(() => {}, { error: () => {} }) };

function makeModule(baseUrl = 'https://func.example') {
    const container = fakeContainer();
    const store = createStore({ containerClient: container });
    const { TOOLS, TOOL_HANDLERS } = createTools({ store, baseUrl: () => baseUrl });
    return { container, store, TOOLS, TOOL_HANDLERS, SERVER_INFO: { name: 'gcc-shields-mcp', version: '1.0.0' }, endpointJson, normaliseKey };
}

describe('badge URLs', () => {
    it('doubles dashes and underscores, turns spaces into underscores', () => {
        expect(escapeSegment('a-b_c d')).toBe('a--b__c_d');
        expect(escapeSegment('50% / done')).toBe('50%25_%2F_done');
    });

    it('builds the path and query', () => {
        expect(staticBadgeUrl({ label: 'build', message: 'passing', color: 'brightgreen' }))
            .toBe('https://img.shields.io/badge/build-passing-brightgreen');
        expect(staticBadgeUrl({ label: 'tools', message: '12', color: '#2DA44E', style: 'flat-square', logo: 'github' }))
            .toBe('https://img.shields.io/badge/tools-12-2da44e?style=flat-square&logo=github');
    });

    it('defaults to blue', () => {
        expect(staticBadgeUrl({ label: 'a', message: 'b' })).toBe('https://img.shields.io/badge/a-b-blue');
    });

    it('rejects unsafe colours and unknown styles', () => {
        expect(() => normaliseColour('red; drop')).toThrow(/Unrecognised colour/);
        expect(() => staticBadgeUrl({ label: 'a', message: 'b', style: 'wobbly' })).toThrow(/Unknown style/);
    });

    it('encodes the endpoint JSON url', () => {
        expect(endpointBadgeUrl('https://x.example/api/mcp-shields/badge/a'))
            .toBe('https://img.shields.io/endpoint?url=https%3A%2F%2Fx.example%2Fapi%2Fmcp-shields%2Fbadge%2Fa');
    });

    it('gives readable alt text and escapes HTML', () => {
        const r = render('https://i/x', 'a"b', '<1>');
        expect(r.html).toBe('<img src="https://i/x" alt="a&quot;b: &lt;1&gt;">');
        expect(r.markdown).toBe('![a"b: <1>](https://i/x)');
    });
});

describe('threshold colours', () => {
    it('uses the highest band that fits', () => {
        expect(pickColour(94)).toBe('brightgreen');
        expect(pickColour(90)).toBe('brightgreen');
        expect(pickColour(75)).toBe('yellow');
        expect(pickColour(3)).toBe('red');
        expect(pickColour(-1)).toBe('lightgrey');
        expect(pickColour(Number.NaN)).toBe('lightgrey');
    });

    it('honours custom bands', () => {
        const bands = [{ from: 0, color: 'green' }, { from: 5, color: 'red' }];
        expect(pickColour(2, bands)).toBe('green');
        expect(pickColour(9, bands)).toBe('red');
    });
});

describe('review stamps', () => {
    const now = new Date('2026-10-16T22:00:00Z');

    it('writes dates out in full and rejects impossible ones', () => {
        expect(formatDate(parseIsoDate('2026-10-16'))).toBe('16 Oct 2026');
        expect(reviewedStamp('2026-10-16').message).toBe('16 Oct 2026');
        expect(() => parseIsoDate('2026-02-30')).toThrow(/real calendar date/);
        expect(() => parseIsoDate('16/10/2026')).toThrow(/YYYY-MM-DD/);
    });

    it('is green well before the due date', () => {
        expect(dueStamp('2027-04-16', 30, now).color).toBe('brightgreen');
    });

    it('is orange inside the warning window', () => {
        const s = dueStamp('2026-11-10', 30, now);
        expect(s.color).toBe('orange');
        expect(s.daysRemaining).toBe(25);
        expect(dueStamp('2026-10-16', 30, now).daysRemaining).toBe(0);
    });

    it('is red once overdue, with the date in the message', () => {
        const s = dueStamp('2026-10-01', 30, now);
        expect(s.color).toBe('red');
        expect(s.message).toBe('overdue since 1 Oct 2026');
    });
});

describe('badge store', () => {
    it('stores, reads, lists and deletes', async () => {
        const store = createStore({ containerClient: fakeContainer() });
        const saved = await store.set('runs', { label: 'walker runs', message: '142', color: 'blue' }, new Date('2026-10-16T22:00:00Z'));
        expect(saved.updated).toBe('2026-10-16T22:00:00.000Z');
        expect((await store.get('runs')).message).toBe('142');
        await store.set('alpha', { label: 'a', message: '1', color: 'red' });
        expect((await store.list()).map(([k]) => k)).toEqual(['alpha', 'runs']);
        expect(await store.delete('runs')).toBe(true);
        expect(await store.delete('runs')).toBe(false);
        expect(await store.get('runs')).toBeUndefined();
    });

    it('treats keys as case-insensitive', async () => {
        const store = createStore({ containerClient: fakeContainer() });
        await store.set('Walker-Runs', { label: 'l', message: 'm', color: 'blue' });
        expect((await store.get('walker-runs')).label).toBe('l');
        expect((await store.list())[0][0]).toBe('walker-runs');
    });

    it('rejects keys that could escape the badges/ prefix', () => {
        expect(() => normaliseKey('../etc')).toThrow(/Key/);
        expect(() => normaliseKey('a/b')).toThrow(/Key/);
        expect(() => normaliseKey('')).toThrow(/Key/);
        expect(() => normaliseKey('x'.repeat(65))).toThrow(/Key/);
    });

    it('produces the document Shields expects', () => {
        expect(endpointJson({ label: 'l', message: 'm', color: 'c', updated: 't' }))
            .toEqual({ schemaVersion: 1, label: 'l', message: 'm', color: 'c' });
    });

    it('adds the look fields only when they are stored, and renames logo to namedLogo', () => {
        const doc = endpointJson({
            label: 'l', message: 'm', color: 'c', labelColor: '1b1033', logo: 'bat', logoColor: 'white', style: 'for-the-badge', updated: 't',
        });
        expect(doc).toEqual({
            schemaVersion: 1, label: 'l', message: 'm', color: 'c',
            labelColor: '1b1033', namedLogo: 'bat', logoColor: 'white', style: 'for-the-badge',
        });
        expect(Object.keys(endpointJson({ label: 'l', message: 'm', color: 'c', updated: 't' }))).toHaveLength(4);
    });

    it('stores the look fields and leaves out the ones not given', async () => {
        const store = createStore({ containerClient: fakeContainer() });
        const saved = await store.set('k', { label: 'l', message: 'm', color: 'red', logo: 'bat', style: undefined });
        expect(saved.logo).toBe('bat');
        expect(Object.prototype.hasOwnProperty.call(saved, 'style')).toBe(false);
        expect((await store.get('k')).logo).toBe('bat');
    });
});

describe('tools', () => {
    it('badge_static returns url, markdown and html', async () => {
        const { TOOL_HANDLERS } = makeModule();
        const r = await TOOL_HANDLERS.badge_static({ label: 'tools', message: '12', color: 'green' });
        expect(r.url).toBe('https://img.shields.io/badge/tools-12-green');
        expect(r.markdown).toBe('![tools: 12](https://img.shields.io/badge/tools-12-green)');
    });

    it('reports bad input as INVALID_ARGUMENT', async () => {
        const { TOOL_HANDLERS } = makeModule();
        await expect(TOOL_HANDLERS.badge_static({ label: 'x' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        await expect(TOOL_HANDLERS.badge_static({ label: 'x', message: 'y', color: 'red;' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        await expect(TOOL_HANDLERS.badge_static({ label: 'x', message: 'y', style: 'wobbly' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('badge_threshold picks the colour', async () => {
        const { TOOL_HANDLERS } = makeModule();
        const r = await TOOL_HANDLERS.badge_threshold({ label: 'lint', value: 94, suffix: '%' });
        expect(r.color).toBe('brightgreen');
        expect(r.url).toBe('https://img.shields.io/badge/lint-94%25-brightgreen');
    });

    it('badge_review_stamp needs exactly one of reviewed or due', async () => {
        const { TOOL_HANDLERS } = makeModule();
        await expect(TOOL_HANDLERS.badge_review_stamp({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        await expect(TOOL_HANDLERS.badge_review_stamp({ reviewed: '2026-10-16', due: '2027-04-16' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        const r = await TOOL_HANDLERS.badge_review_stamp({ reviewed: '2026-10-16' });
        expect(r.message).toBe('16 Oct 2026');
        await expect(TOOL_HANDLERS.badge_review_stamp({ due: '2026-02-30' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('badge_wall joins markdown with spaces and html with newlines', async () => {
        const { TOOL_HANDLERS } = makeModule();
        const badges = [{ label: 'a', message: '1' }, { label: 'b', message: '2', color: 'red' }];
        const md = await TOOL_HANDLERS.badge_wall({ badges });
        expect(md.count).toBe(2);
        expect(md.block.split('![')).toHaveLength(3);
        expect(md.block).toContain('![a: 1](https://img.shields.io/badge/a-1-blue) ![b: 2]');
        const html = await TOOL_HANDLERS.badge_wall({ badges, format: 'html' });
        expect(html.block.split('\n')).toHaveLength(2);
        await expect(TOOL_HANDLERS.badge_wall({ badges: [] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('badge_set stores a value and returns a live embed', async () => {
        const { TOOL_HANDLERS, store } = makeModule();
        const r = await TOOL_HANDLERS.badge_set({ key: 'Walker-Runs', label: 'walker runs', value: 95, suffix: '%' });
        expect(r.key).toBe('walker-runs');
        expect(r.color).toBe('brightgreen');
        expect(r.jsonUrl).toBe('https://func.example/api/mcp-shields/badge/walker-runs');
        expect(r.url).toContain('https://img.shields.io/endpoint?url=');
        expect((await store.get('walker-runs')).message).toBe('95%');
    });

    it('badge_set without a base URL still stores and says what is missing', async () => {
        const { TOOL_HANDLERS } = makeModule(null);
        const r = await TOOL_HANDLERS.badge_set({ key: 'k', label: 'l', message: 'm' });
        expect(r.jsonPath).toBe('/api/mcp-shields/badge/k');
        expect(r.note).toMatch(/SHIELDS_PUBLIC_BASE_URL/);
    });

    it('badge_set never stores a colour that would break the badge', async () => {
        const { TOOL_HANDLERS, store } = makeModule();
        await expect(TOOL_HANDLERS.badge_set({ key: 'k', label: 'l', message: 'm', color: 'red;' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        expect(await store.get('k')).toBeUndefined();
        await expect(TOOL_HANDLERS.badge_set({ key: 'k', label: 'l' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        await expect(TOOL_HANDLERS.badge_set({ key: '../x', label: 'l', message: 'm' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('badge_set stores the look and normalises its colours', async () => {
        const { TOOL_HANDLERS, store } = makeModule();
        const r = await TOOL_HANDLERS.badge_set({
            key: 'night-moon', label: 'moon', message: 'full moon', color: '#D8B800',
            logo: 'bat', logoColor: 'White', labelColor: '#1B1033', style: 'for-the-badge',
        });
        expect(r.color).toBe('d8b800');
        expect(r.labelColor).toBe('1b1033');
        expect(r.logoColor).toBe('white');
        expect(r.url).toContain('style=for-the-badge');
        const stored = await store.get('night-moon');
        expect(stored.logo).toBe('bat');
        expect(stored.style).toBe('for-the-badge');
    });

    it('badge_set rejects a bad look and stores nothing', async () => {
        const { TOOL_HANDLERS, store } = makeModule();
        const base = { key: 'k', label: 'l', message: 'm' };
        await expect(TOOL_HANDLERS.badge_set({ ...base, logo: '../x' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        await expect(TOOL_HANDLERS.badge_set({ ...base, logo: 'a b' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        await expect(TOOL_HANDLERS.badge_set({ ...base, labelColor: 'red;' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        await expect(TOOL_HANDLERS.badge_set({ ...base, logoColor: '<x>' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        await expect(TOOL_HANDLERS.badge_set({ ...base, style: 'wobbly' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        expect(await store.get('k')).toBeUndefined();
    });

    it('setting a key again replaces the whole badge, including its look', async () => {
        const { TOOL_HANDLERS, store } = makeModule();
        await TOOL_HANDLERS.badge_set({ key: 'k', label: 'l', message: 'm', logo: 'bat', labelColor: 'black' });
        await TOOL_HANDLERS.badge_set({ key: 'k', label: 'l', message: 'n' });
        const stored = await store.get('k');
        expect(stored.message).toBe('n');
        expect(stored.logo).toBeUndefined();
        expect(stored.labelColor).toBeUndefined();
    });

    it('badge_list shows the look of each badge', async () => {
        const { TOOL_HANDLERS } = makeModule();
        await TOOL_HANDLERS.badge_set({ key: 'a', label: 'a', message: '1', logo: 'bat' });
        const listed = await TOOL_HANDLERS.badge_list({});
        expect(listed.badges[0].logo).toBe('bat');
    });

    it('badge_list and badge_delete', async () => {
        const { TOOL_HANDLERS } = makeModule();
        await TOOL_HANDLERS.badge_set({ key: 'b', label: 'b', message: '2' });
        await TOOL_HANDLERS.badge_set({ key: 'a', label: 'a', message: '1' });
        const listed = await TOOL_HANDLERS.badge_list({});
        expect(listed.count).toBe(2);
        expect(listed.badges.map((b) => b.key)).toEqual(['a', 'b']);
        expect(await TOOL_HANDLERS.badge_delete({ key: 'a' })).toEqual({ key: 'a', deleted: true });
        expect(await TOOL_HANDLERS.badge_delete({ key: 'a' })).toEqual({ key: 'a', deleted: false });
    });

    it('defines a schema for every handler', () => {
        const { TOOLS, TOOL_HANDLERS } = makeModule();
        expect(TOOLS.map((t) => t.name).sort()).toEqual(Object.keys(TOOL_HANDLERS).sort());
        TOOLS.forEach((t) => expect(t.inputSchema.type).toBe('object'));
    });
});

describe('MCP envelope', () => {
    it('initialize returns instructions', async () => {
        const res = await handleMcpRequest({ jsonrpc: '2.0', method: 'initialize', id: 1 }, context, makeModule());
        expect(res.result.serverInfo.name).toBe('gcc-shields-mcp');
        expect(res.result.serverInfo.instructions).toMatch(/Live badges/);
        expect(res.id).toBe(1);
    });

    it('tools/list returns the seven tools', async () => {
        const res = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 2 }, context, makeModule());
        expect(res.result.tools).toHaveLength(7);
    });

    it('tools/call wraps the result as MCP text content', async () => {
        const res = await handleMcpRequest({
            jsonrpc: '2.0', method: 'tools/call', id: 3,
            params: { name: 'badge_static', arguments: { label: 'a', message: 'b' } },
        }, context, makeModule());
        expect(res.result.isError).toBeUndefined();
        expect(JSON.parse(res.result.content[0].text).url).toBe('https://img.shields.io/badge/a-b-blue');
    });

    it('tool failures come back as isError with a code', async () => {
        const res = await handleMcpRequest({
            jsonrpc: '2.0', method: 'tools/call', id: 4,
            params: { name: 'badge_static', arguments: { label: 'a' } },
        }, context, makeModule());
        expect(res.result.isError).toBe(true);
        expect(JSON.parse(res.result.content[0].text)).toMatchObject({ code: 'INVALID_ARGUMENT', tool: 'badge_static' });
    });

    it('storage failures are INTERNAL_ERROR, not INVALID_ARGUMENT', async () => {
        const mod = makeModule();
        mod.container.createIfNotExists = async () => { throw new Error('storage down'); };
        const res = await handleMcpRequest({
            jsonrpc: '2.0', method: 'tools/call', id: 5,
            params: { name: 'badge_list', arguments: {} },
        }, context, mod);
        expect(res.result.isError).toBe(true);
        expect(JSON.parse(res.result.content[0].text)).toMatchObject({ code: 'INTERNAL_ERROR', error: 'storage down' });
    });

    it('rejects unknown tools, inherited names, bad envelopes and unknown methods', async () => {
        const mod = makeModule();
        const unknown = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/call', id: 6, params: { name: 'nope' } }, context, mod);
        expect(unknown.error.code).toBe(-32602);
        const inherited = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/call', id: 7, params: { name: 'constructor' } }, context, mod);
        expect(inherited.error.code).toBe(-32602);
        expect((await handleMcpRequest([], context, mod)).error.code).toBe(-32600);
        expect((await handleMcpRequest({ jsonrpc: '1.0', method: 'ping', id: 8 }, context, mod)).error.code).toBe(-32600);
        expect((await handleMcpRequest({ jsonrpc: '2.0', method: 'nope', id: 9 }, context, mod)).error.code).toBe(-32601);
    });

    it('answers ping and swallows notifications/initialized', async () => {
        const mod = makeModule();
        expect((await handleMcpRequest({ jsonrpc: '2.0', method: 'ping', id: 10 }, context, mod)).result).toEqual({});
        expect(await handleMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, context, mod)).toBeNull();
    });
});

describe('public badge route', () => {
    it('serves the Shields JSON with a short cache', async () => {
        const mod = makeModule();
        await mod.store.set('runs', { label: 'runs', message: '7', color: 'green' });
        const res = await handleBadgeRequest('runs', context, mod);
        expect(res.status).toBe(200);
        expect(res.headers['Cache-Control']).toBe('public, max-age=60');
        expect(JSON.parse(res.body)).toEqual({ schemaVersion: 1, label: 'runs', message: '7', color: 'green' });
    });

    it('serves the look fields to Shields, and nothing else', async () => {
        const mod = makeModule();
        await mod.store.set('moon', {
            label: 'moon', message: 'full moon', color: 'd8b800', logo: 'bat', logoColor: 'white', labelColor: '1b1033', style: 'for-the-badge',
        });
        const body = JSON.parse((await handleBadgeRequest('moon', context, mod)).body);
        expect(body).toEqual({
            schemaVersion: 1, label: 'moon', message: 'full moon', color: 'd8b800',
            labelColor: '1b1033', namedLogo: 'bat', logoColor: 'white', style: 'for-the-badge',
        });
        expect(body.updated).toBeUndefined();
    });

    it('accepts a .json suffix and any letter case', async () => {
        const mod = makeModule();
        await mod.store.set('runs', { label: 'runs', message: '7', color: 'green' });
        expect((await handleBadgeRequest('Runs.json', context, mod)).status).toBe(200);
    });

    it('returns 404 for unknown or malformed keys, without leaking anything', async () => {
        const mod = makeModule();
        const missing = await handleBadgeRequest('nope', context, mod);
        expect(missing.status).toBe(404);
        expect(JSON.parse(missing.body)).toMatchObject({ schemaVersion: 1, message: 'not found', isError: true });
        expect((await handleBadgeRequest('../etc', context, mod)).status).toBe(404);
        expect((await handleBadgeRequest(undefined, context, mod)).status).toBe(404);
    });

    it('returns 503 when storage fails', async () => {
        const mod = makeModule();
        mod.container.createIfNotExists = async () => { throw new Error('storage down'); };
        const res = await handleBadgeRequest('runs', context, mod);
        expect(res.status).toBe(503);
        expect(res.body).not.toMatch(/storage down/);
    });
});
