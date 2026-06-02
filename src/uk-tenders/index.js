'use strict';

const { callTool } = require('./mcp-client');

const READ_ONLY_ANNOTATIONS = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    idempotentHint: true,
};

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'uk_tenders_search_frameworks',
        description: `Search UK public procurement for existing frameworks GCC could call off instead of running a new competition.

Queries 677k+ records across Find a Tender, Contracts Finder, Public Contracts Scotland, Sell2Wales, and eTendersNI.

Use this BEFORE gcc_procurement_determine_route to check whether a framework_calloff route is available. If a relevant framework exists, pass procurement_route='framework_calloff' to determine_route — the constitutional route and notice obligations change.

Returns the official notice URL on every result. Values are awarded contract ceilings, not actual spend. Data under OGL v3.0 — verify critical details on the official notice.`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                keyword: {
                    type: 'string',
                    description: 'Free-text search on title/description, e.g. "cloud hosting", "waste collection", "domiciliary care"',
                },
                cpv: {
                    type: 'string',
                    description: 'CPV code or 2-digit division prefix, e.g. "72" (IT), "90" (waste), "85" (health/social care)',
                },
                buyer: {
                    type: 'string',
                    description: 'Filter by buyer name, e.g. "Crown Commercial" to find CCS frameworks',
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 50,
                    default: 10,
                },
            },
        },
    },

    {
        name: 'uk_tenders_peer_benchmarks',
        description: `What have similar public sector buyers paid for contracts in this category?

Returns awarded contract values filtered by CPV and/or keyword, ordered by value. Use for pre-procurement market analysis and benchmarking before setting a contract value estimate.

Values are awarded contract ceilings, not actual spend or payments. Some notices carry placeholder ceilings — verify on the official notice URL. Data under OGL v3.0.`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                cpv: {
                    type: 'string',
                    description: 'CPV code or 2-digit division prefix',
                },
                keyword: {
                    type: 'string',
                    description: 'Free-text filter on title/description',
                },
                buyer: {
                    type: 'string',
                    description: 'Filter by buyer name, e.g. "council", "borough"',
                },
                region: {
                    type: 'string',
                    description: 'ONS region code, e.g. "UKK" (South West), "UKH" (East of England)',
                },
                published_from: {
                    type: 'string',
                    description: 'ISO date — only return awards after this date, e.g. "2023-01-01"',
                },
                min_value: {
                    type: 'number',
                    description: 'Minimum awarded value in GBP',
                },
                max_value: {
                    type: 'number',
                    description: 'Maximum awarded value in GBP',
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 50,
                    default: 20,
                },
            },
        },
    },

    {
        name: 'uk_tenders_top_suppliers',
        description: `Suppliers ranked by total awarded contract value for a category.

Use for market intelligence before launching a competition — who are the active suppliers in this space, at what scale, and across which buyers?

Values are contract ceilings not actual spend. Grouped by currency — do not aggregate across GBP and non-GBP results. Data under OGL v3.0.`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                cpv: {
                    type: 'string',
                    description: 'CPV code or 2-digit division prefix',
                },
                keyword: {
                    type: 'string',
                    description: 'Free-text filter on title/description',
                },
                buyer: {
                    type: 'string',
                    description: 'Filter by buyer name',
                },
                region: {
                    type: 'string',
                    description: 'ONS region code',
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 50,
                    default: 20,
                },
            },
        },
    },

    {
        name: 'uk_tenders_data_status',
        description: `Check the freshness and health of the UK tenders index.

Returns per-source last-updated timestamps and health status (green/amber/red) for Find a Tender, Contracts Finder, Public Contracts Scotland, Sell2Wales, and eTendersNI.

Call this when data currency matters for the procurement decision, or when results seem unexpectedly sparse.`,
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
];

// ─── Tool handlers ─────────────────────────────────────────────────────────────
// Each handler translates GCC tool arguments to the upstream uk-tenders tool
// name and argument shape, then proxies the call.

const TOOL_HANDLERS = {

    uk_tenders_search_frameworks: async (args) => {
        // Map to upstream search_tenders with stage=award filter
        return callTool('search_tenders', {
            query: args.keyword,
            cpv: args.cpv,
            buyer: args.buyer,
            stage: 'award',
            limit: args.limit || 10,
        });
    },

    uk_tenders_peer_benchmarks: async (args) => {
        return callTool('search_tenders', {
            query: args.keyword,
            cpv: args.cpv,
            buyer: args.buyer,
            region: args.region,
            published_from: args.published_from,
            min_value: args.min_value,
            max_value: args.max_value,
            stage: 'award',
            limit: args.limit || 20,
        });
    },

    uk_tenders_top_suppliers: async (args) => {
        return callTool('top_suppliers', {
            query: args.keyword,
            cpv: args.cpv,
            buyer: args.buyer,
            region: args.region,
            limit: args.limit || 20,
        });
    },

    uk_tenders_data_status: async () => {
        return callTool('get_status', {});
    },
};

// ─── Server info ───────────────────────────────────────────────────────────────

const SERVER_INFO = {
    name: 'uk-tenders-gcc-proxy',
    version: '1.0.0',
    description: 'UK public procurement market intelligence proxied from tenders.run.cns.me/mcp — 677k+ records, OGL v3.0. Use uk_tenders_search_frameworks before gcc_procurement_determine_route to check framework availability.',
};

module.exports = { TOOLS, TOOL_HANDLERS, SERVER_INFO };
