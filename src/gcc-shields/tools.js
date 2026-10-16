/**
 * Shields MCP tool definitions and handlers.
 *
 * createTools() takes its dependencies as arguments so tests can inject an
 * in-memory store and a fixed base URL.
 */

'use strict';

const { STYLES, staticBadgeUrl, endpointBadgeUrl, render } = require('./badge');
const { DEFAULT_BANDS, pickColour } = require('./threshold');
const { reviewedStamp, dueStamp } = require('./stamp');
const { normaliseKey } = require('./store');

const BADGE_ROUTE = '/api/mcp-shields/badge';

class ShieldsError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ShieldsError';
        this.code = code;
    }
}

const invalid = (message) => new ShieldsError('INVALID_ARGUMENT', message);

function reqString(args, name, { allowEmpty = false, max = 200 } = {}) {
    const v = args[name];
    if (typeof v !== 'string') throw invalid(`${name} is required and must be a string`);
    if (!allowEmpty && v.trim() === '') throw invalid(`${name} must not be empty`);
    if (v.length > max) throw invalid(`${name} must be ${max} characters or fewer`);
    return v;
}

function optString(args, name, max = 200) {
    return args[name] === undefined ? undefined : reqString(args, name, { max });
}

function reqNumber(args, name) {
    const v = args[name];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw invalid(`${name} is required and must be a finite number`);
    return v;
}

function optStyle(args) {
    if (args.style === undefined) return undefined;
    if (!STYLES.includes(args.style)) throw invalid(`style must be one of: ${STYLES.join(', ')}`);
    return args.style;
}

function optBands(args) {
    if (args.bands === undefined) return DEFAULT_BANDS;
    if (!Array.isArray(args.bands) || args.bands.length === 0 || args.bands.length > 10) {
        throw invalid('bands must be an array of 1 to 10 items');
    }
    return args.bands.map((b, i) => {
        if (!b || typeof b.from !== 'number' || !Number.isFinite(b.from) || typeof b.color !== 'string') {
            throw invalid(`bands[${i}] needs a numeric "from" and a string "color"`);
        }
        return { from: b.from, color: b.color };
    });
}

/** Turns colour/URL errors from badge.js into INVALID_ARGUMENT. */
function wrap(fn) {
    try {
        return fn();
    } catch (err) {
        if (err instanceof ShieldsError) throw err;
        throw invalid(err.message);
    }
}

const STYLE_SCHEMA = { type: 'string', enum: STYLES };
const BANDS_SCHEMA = {
    type: 'array',
    description: 'Threshold bands. A band applies when value >= from; the highest matching band wins. Default: 90+ brightgreen, 70+ yellow, otherwise red.',
    items: {
        type: 'object',
        properties: { from: { type: 'number' }, color: { type: 'string' } },
        required: ['from', 'color'],
    },
};
const BADGE_PROPS = {
    label: { type: 'string', description: 'Left-hand text.' },
    message: { type: 'string', description: 'Right-hand text.' },
    color: { type: 'string', description: 'Colour name ("green") or hex ("2da44e"). Default blue.' },
    labelColor: { type: 'string' },
    style: STYLE_SCHEMA,
    logo: { type: 'string', description: 'Simple Icons slug, for example "github".' },
    logoColor: { type: 'string' },
};

function createTools({ store, baseUrl }) {
    function liveEmbed(key, entry, style) {
        const base = baseUrl();
        if (!base) {
            return {
                key,
                ...entry,
                jsonPath: `${BADGE_ROUTE}/${key}`,
                note: 'Set SHIELDS_PUBLIC_BASE_URL (or deploy where WEBSITE_HOSTNAME is set) to get an embeddable URL.',
            };
        }
        const jsonUrl = `${base}${BADGE_ROUTE}/${key}`;
        return { key, ...entry, jsonUrl, ...render(endpointBadgeUrl(jsonUrl, style), entry.label, entry.message) };
    }

    const TOOLS = [
        {
            name: 'badge_static',
            description: 'Build a static Shields.io badge. Returns the image URL plus Markdown and HTML embeds. Alt text is "label: message".',
            inputSchema: { type: 'object', properties: BADGE_PROPS, required: ['label', 'message'] },
        },
        {
            name: 'badge_threshold',
            description: 'Badge for a number whose colour comes from threshold bands. Defaults: 90+ green, 70+ yellow, otherwise red.',
            inputSchema: {
                type: 'object',
                properties: {
                    label: { type: 'string' },
                    value: { type: 'number' },
                    suffix: { type: 'string', description: 'Appended to the value, for example "%".' },
                    bands: BANDS_SCHEMA,
                    style: STYLE_SCHEMA,
                },
                required: ['label', 'value'],
            },
        },
        {
            name: 'badge_review_stamp',
            description: 'Document stamp. Give `reviewed` (YYYY-MM-DD) for a "Reviewed" badge, or `due` (YYYY-MM-DD) for a "Review due" badge that turns orange inside warnDays and red once overdue. Dates are written out in full.',
            inputSchema: {
                type: 'object',
                properties: {
                    reviewed: { type: 'string', description: 'YYYY-MM-DD' },
                    due: { type: 'string', description: 'YYYY-MM-DD' },
                    warnDays: { type: 'integer', minimum: 0, description: 'Default 30.' },
                    style: STYLE_SCHEMA,
                },
            },
        },
        {
            name: 'badge_wall',
            description: 'Render several badges as one pasteable block, as Markdown or HTML.',
            inputSchema: {
                type: 'object',
                properties: {
                    badges: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 40,
                        items: { type: 'object', properties: BADGE_PROPS, required: ['label', 'message'] },
                    },
                    format: { type: 'string', enum: ['markdown', 'html'], description: 'Default markdown.' },
                },
                required: ['badges'],
            },
        },
        {
            name: 'badge_set',
            description: 'Create or update a live badge under a key. Give `message` directly, or a numeric `value` (with optional suffix and bands) to have the colour chosen. The badge updates wherever it is embedded.',
            inputSchema: {
                type: 'object',
                properties: {
                    key: { type: 'string', description: '1-64 characters: letters, digits, dot, underscore, hyphen. Stored lower-case.' },
                    label: { type: 'string' },
                    message: { type: 'string' },
                    value: { type: 'number' },
                    suffix: { type: 'string' },
                    color: { type: 'string' },
                    bands: BANDS_SCHEMA,
                    style: STYLE_SCHEMA,
                },
                required: ['key', 'label'],
            },
        },
        {
            name: 'badge_list',
            description: 'List every live badge with its embed code.',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'badge_delete',
            description: 'Remove a live badge. Existing embeds will show "not found".',
            inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
        },
    ];

    const TOOL_HANDLERS = {
        async badge_static(args) {
            const label = reqString(args, 'label', { allowEmpty: true });
            const message = reqString(args, 'message');
            const spec = {
                label,
                message,
                color: optString(args, 'color', 40),
                labelColor: optString(args, 'labelColor', 40),
                style: optStyle(args),
                logo: optString(args, 'logo', 60),
                logoColor: optString(args, 'logoColor', 40),
            };
            return wrap(() => render(staticBadgeUrl(spec), label, message));
        },

        async badge_threshold(args) {
            const label = reqString(args, 'label', { allowEmpty: true });
            const value = reqNumber(args, 'value');
            const message = `${value}${optString(args, 'suffix', 20) || ''}`;
            const color = pickColour(value, optBands(args));
            const style = optStyle(args);
            return wrap(() => ({ color, ...render(staticBadgeUrl({ label, message, color, style }), label, message) }));
        },

        async badge_review_stamp(args) {
            const hasReviewed = args.reviewed !== undefined;
            const hasDue = args.due !== undefined;
            if (hasReviewed === hasDue) throw invalid('Give exactly one of `reviewed` or `due`');
            const warnDays = args.warnDays === undefined ? 30 : args.warnDays;
            if (!Number.isInteger(warnDays) || warnDays < 0) throw invalid('warnDays must be a whole number, 0 or more');
            const style = optStyle(args);
            return wrap(() => {
                const s = hasReviewed ? reviewedStamp(args.reviewed) : dueStamp(args.due, warnDays);
                return { ...s, ...render(staticBadgeUrl({ label: s.label, message: s.message, color: s.color, style }), s.label, s.message) };
            });
        },

        async badge_wall(args) {
            if (!Array.isArray(args.badges) || args.badges.length < 1 || args.badges.length > 40) {
                throw invalid('badges must be an array of 1 to 40 items');
            }
            const format = args.format === undefined ? 'markdown' : args.format;
            if (format !== 'markdown' && format !== 'html') throw invalid('format must be "markdown" or "html"');
            const parts = args.badges.map((b, i) => {
                if (!b || typeof b !== 'object') throw invalid(`badges[${i}] must be an object`);
                const label = reqString(b, 'label', { allowEmpty: true });
                const message = reqString(b, 'message');
                const spec = {
                    label,
                    message,
                    color: optString(b, 'color', 40),
                    labelColor: optString(b, 'labelColor', 40),
                    style: optStyle(b),
                    logo: optString(b, 'logo', 60),
                    logoColor: optString(b, 'logoColor', 40),
                };
                return wrap(() => render(staticBadgeUrl(spec), label, message));
            });
            return {
                format,
                count: parts.length,
                block: parts.map((p) => (format === 'html' ? p.html : p.markdown)).join(format === 'html' ? '\n' : ' '),
            };
        },

        async badge_set(args) {
            const key = wrap(() => normaliseKey(args.key));
            const label = reqString(args, 'label', { allowEmpty: true });
            if (args.message === undefined && args.value === undefined) throw invalid('Give `message` or `value`');
            const message = args.message !== undefined
                ? reqString(args, 'message')
                : `${reqNumber(args, 'value')}${optString(args, 'suffix', 20) || ''}`;
            const color = args.color !== undefined
                ? reqString(args, 'color', { max: 40 })
                : args.value !== undefined
                    ? pickColour(args.value, optBands(args))
                    : 'blue';
            const style = optStyle(args);
            // Validate before storing, so a bad colour never reaches the public JSON.
            wrap(() => staticBadgeUrl({ label, message, color }));
            const entry = await store.set(key, { label, message, color });
            return liveEmbed(key, entry, style);
        },

        async badge_list() {
            const rows = await store.list();
            return { count: rows.length, badges: rows.map(([key, entry]) => liveEmbed(key, entry)) };
        },

        async badge_delete(args) {
            const key = wrap(() => normaliseKey(args.key));
            return { key, deleted: await store.delete(key) };
        },
    };

    return { TOOLS, TOOL_HANDLERS };
}

module.exports = { createTools, ShieldsError };
