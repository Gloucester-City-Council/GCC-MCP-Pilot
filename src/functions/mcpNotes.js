'use strict';

const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Blob client / container singletons
//
// Keep SDK clients at module scope so requests reuse connection pools and
// avoid repeated client construction costs. Initialisation remains safe for
// cold starts because we only construct clients when needed.
// ---------------------------------------------------------------------------

const NOTES_CONTAINER = process.env.MCP_NOTES_CONTAINER || 'mcp-notes';

let _blobServiceClient = null;
let _containerClient = null;
let _containerReadyPromise = null;

function getContainerClient() {
    if (!_blobServiceClient) {
        const cs = process.env.STORAGE_CONNECTION;
        if (!cs) throw new Error('STORAGE_CONNECTION environment variable is not set');
        _blobServiceClient = BlobServiceClient.fromConnectionString(cs);
    }

    if (!_containerClient) {
        _containerClient = _blobServiceClient.getContainerClient(NOTES_CONTAINER);
    }

    return _containerClient;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = ['schema', 'build', 'architecture', 'decision', 'idea', 'reference'];

const SERVER_INFO = {
    name: 'gcc-notes-mcp',
    version: '1.0.0',
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
    {
        name: 'add_note',
        description: 'Add a note to the personal store. For ideas, schema decisions, build notes and architectural thinking only. Do not store case-specific information, resident data, or commercially sensitive material.',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string' },
                category: { type: 'string', enum: VALID_CATEGORIES },
                tags: { type: 'array', items: { type: 'string' } },
                related: { type: 'array', items: { type: 'string' } },
                supersedes: { type: 'string' },
            },
            required: ['content', 'category'],
        },
    },
    {
        name: 'get_notes',
        description: 'List notes, optionally filtered by category, tag, or date.',
        inputSchema: {
            type: 'object',
            properties: {
                category: { type: 'string', enum: VALID_CATEGORIES },
                tag: { type: 'string', minLength: 1 },
                since: {
                    type: 'string',
                    format: 'date-time',
                    description: 'ISO8601 timestamp. Only notes created on/after this time are returned.',
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'get_note',
        description: 'Retrieve a single note by ID.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
        },
    },
    {
        name: 'get_related',
        description: 'Retrieve a note and all its directly linked notes in one call.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
        },
    },
    {
        name: 'delete_note',
        description: 'Permanently delete a note. Consider superseding instead if you want to preserve the chain.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
        },
    },
];

// ---------------------------------------------------------------------------
// Safe error logger — context.log.error may not exist in all runtime versions
// ---------------------------------------------------------------------------

function logError(context, ...args) {
    try {
        if (typeof context.log.error === 'function') {
            context.log.error(...args);
        } else if (typeof context.error === 'function') {
            context.error(...args);
        } else {
            console.error(...args);
        }
    } catch (_) {
        console.error(...args);
    }
}

// ---------------------------------------------------------------------------
// Date context helper
// ---------------------------------------------------------------------------

function getDateContext() {
    const now = new Date();
    return {
        generatedAt: now.toISOString(),
        date: now.toISOString().split('T')[0],
    };
}

// ---------------------------------------------------------------------------
// Blob helpers
// ---------------------------------------------------------------------------

async function ensureContainerReady(containerClient = null) {
    const resolvedContainerClient = containerClient || getContainerClient();

    if (!_containerReadyPromise) {
        _containerReadyPromise = resolvedContainerClient.createIfNotExists().catch((err) => {
            _containerReadyPromise = null;
            if (err.code !== 'ContainerAlreadyExists') throw err;
        });
    }

    await _containerReadyPromise;
    return resolvedContainerClient;
}

async function readNote(id, containerClient = null) {
    const resolvedContainerClient = await ensureContainerReady(containerClient);
    const blobClient = resolvedContainerClient.getBlobClient(`notes/${id}.json`);
    try {
        const download = await blobClient.download();
        const chunks = [];
        for await (const chunk of download.readableStreamBody) {
            chunks.push(chunk);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    } catch (err) {
        if (err.statusCode === 404 || err.code === 'BlobNotFound') return null;
        throw err;
    }
}

async function writeNote(note) {
    const containerClient = await ensureContainerReady();
    const blobClient = containerClient.getBlockBlobClient(`notes/${note.id}.json`);
    const content = JSON.stringify(note, null, 2);
    await blobClient.upload(content, Buffer.byteLength(content), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
    });
}

async function deleteBlob(id) {
    const containerClient = await ensureContainerReady();
    const blobClient = containerClient.getBlobClient(`notes/${id}.json`);
    try {
        await blobClient.delete();
        return true;
    } catch (err) {
        if (err.statusCode === 404 || err.code === 'BlobNotFound') return false;
        throw err;
    }
}

async function listAllNotes() {
    const containerClient = await ensureContainerReady();

    const noteIds = [];
    for await (const blob of containerClient.listBlobsFlat({ prefix: 'notes/' })) {
        const id = blob.name.replace(/^notes\//, '').replace(/\.json$/, '');
        noteIds.push(id);
    }

    if (noteIds.length === 0) {
        return [];
    }

    // Blob reads are network-bound; bounded concurrency materially reduces
    // tail latency for larger note sets without overwhelming the storage API.
    const READ_CONCURRENCY = Math.max(1, Number(process.env.MCP_NOTES_READ_CONCURRENCY || 8));
    const notes = [];

    for (let i = 0; i < noteIds.length; i += READ_CONCURRENCY) {
        const batch = noteIds.slice(i, i + READ_CONCURRENCY);
        const batchNotes = await Promise.all(batch.map((id) => readNote(id, containerClient)));
        notes.push(...batchNotes.filter(Boolean));
    }

    // ULIDs are lexicographically sortable — ascending = chronological
    notes.sort((a, b) => a.id.localeCompare(b.id));
    return notes;
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function addNote(args) {
    const { content, category, tags = [], related = [], supersedes = null } = args;

    if (!VALID_CATEGORIES.includes(category)) {
        throw new Error(`category must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }

    const timestamp = Date.now().toString(36).padStart(10, '0').toUpperCase();
    const random = crypto.randomBytes(10).toString('hex').toUpperCase();
    const id = timestamp + random;
    const created_at = new Date().toISOString();
    const note = { id, content, category, tags, related, supersedes, created_at, source: 'conversation' };

    await writeNote(note);
    return { id, created_at };
}

async function getNotes(args) {
    const { category, tag, since } = args || {};
    const sinceDate = since ? new Date(since) : null;

    if (category && !VALID_CATEGORIES.includes(category)) {
        throw new Error(`category must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }

    if (since && Number.isNaN(sinceDate.getTime())) {
        throw new Error('since must be a valid ISO8601 date-time string');
    }

    let notes = await listAllNotes();

    if (category) notes = notes.filter((n) => n.category === category);
    if (tag) notes = notes.filter((n) => Array.isArray(n.tags) && n.tags.includes(tag));
    if (sinceDate) notes = notes.filter((n) => new Date(n.created_at) >= sinceDate);

    return notes.map((n) => ({
        id: n.id,
        category: n.category,
        tags: n.tags,
        created_at: n.created_at,
        preview: (n.content || '').slice(0, 100),
    }));
}

async function getNote(args) {
    const note = await readNote(args.id);
    if (!note) throw Object.assign(new Error(`Note not found: ${args.id}`), { notFound: true });
    return note;
}

async function getRelated(args) {
    const root = await readNote(args.id);
    if (!root) throw Object.assign(new Error(`Note not found: ${args.id}`), { notFound: true });

    const relatedNotes = await Promise.all((root.related || []).map((rid) => readNote(rid)));
    const supersededNote = root.supersedes ? await readNote(root.supersedes) : null;

    return { root, related: relatedNotes.filter(Boolean), supersedes: supersededNote };
}

async function deleteNote(args) {
    const deleted = await deleteBlob(args.id);
    if (!deleted) throw Object.assign(new Error(`Note not found: ${args.id}`), { notFound: true });
    return { deleted: args.id };
}

const TOOL_HANDLERS = {
    add_note: addNote,
    get_notes: getNotes,
    get_note: getNote,
    get_related: getRelated,
    delete_note: deleteNote,
};
const AVAILABLE_TOOL_NAMES = Object.keys(TOOL_HANDLERS).join(', ');

// ---------------------------------------------------------------------------
// JSON-RPC handler
// ---------------------------------------------------------------------------

async function handleMcpRequest(request, context) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: body must be a JSON object' }, id: null };
    }

    const { jsonrpc, method, params, id } = request;
    const requestId = Object.prototype.hasOwnProperty.call(request, 'id') && id !== undefined ? id : null;

    if (jsonrpc !== '2.0') {
        return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }, id: requestId };
    }

    context.log(`Processing MCP Notes method: ${method}`);

    switch (method) {
        case 'initialize':
            return {
                jsonrpc: '2.0',
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: {
                        ...SERVER_INFO,
                        ...getDateContext(),
                        instructions: 'Personal note store for build and architectural thinking. Use add_note to record ideas, decisions, and references. Notes are immutable — supersede rather than update. All notes are scoped to this project only; do not store resident data or commercially sensitive material.',
                    },
                },
                id,
            };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return { jsonrpc: '2.0', result: { tools: TOOLS }, id };

        case 'tools/call': {
            const { name, arguments: args } = params || {};
            const toolStart = Date.now();

            if (!name) {
                return { jsonrpc: '2.0', error: { code: -32602, message: 'Invalid params: tool name is required' }, id };
            }

            const handler = TOOL_HANDLERS[name];
            if (!handler) {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: `Unknown tool: ${name}. Available: ${AVAILABLE_TOOL_NAMES}` },
                    id,
                };
            }

            try {
                context.log(`Executing notes tool: ${name}`);
                const result = await Promise.resolve(handler(args || {}));
                context.log(`Notes tool completed [${name}] in ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify({ ...getDateContext(), tool: name, data: result }, null, 2) }],
                    },
                    id,
                };
            } catch (err) {
                logError(context,`Notes tool error [${name}]: ${err.message}`);
                logError(context,`Notes tool error stack: ${err.stack}`);
                logError(context,`Notes tool failed [${name}] after ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify({ error: err.message, tool: name, note: 'An unexpected error occurred executing the notes tool.' }, null, 2) }],
                        isError: true,
                    },
                    id,
                };
            }
        }

        case 'ping':
            return { jsonrpc: '2.0', result: {}, id };

        default:
            return { jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id };
    }
}

// ---------------------------------------------------------------------------
// Azure Function HTTP trigger
// ---------------------------------------------------------------------------

app.http('mcpNotes', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp-notes',
    handler: async (request, context) => {
        const requestStart = Date.now();
        context.log('MCP Notes request received');

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                logError(context,'Failed to parse request body:', parseError);
                logError(context,'MCP Notes parse error stack:', parseError.stack);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null }),
                };
            }

            const response = await handleMcpRequest(body, context);

            if (response === null) {
                context.log(`MCP Notes request completed with 204 in ${Date.now() - requestStart}ms`);
                return { status: 204 };
            }

            context.log(`MCP Notes request completed with 200 in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
            };
        } catch (err) {
            logError(context,'MCP Notes unhandled error:', err.message);
            logError(context,'MCP Notes unhandled stack:', err.stack);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null }),
            };
        }
    },
});
