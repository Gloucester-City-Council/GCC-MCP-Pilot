'use strict';

const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Blob client — lazy-initialised, never at module load time.
// Eager initialisation at the top level will crash the function app on cold
// start if the env var is missing. Always call getContainerClient() inside
// a function, never at module scope.
// ---------------------------------------------------------------------------

let _blobServiceClient = null;

function getContainerClient() {
    console.log('[mcpNotes] getContainerClient called');
    if (!_blobServiceClient) {
        const cs = process.env.STORAGE_CONNECTION;
        console.log('[mcpNotes] STORAGE_CONNECTION set:', !!cs);
        if (!cs) throw new Error('STORAGE_CONNECTION environment variable is not set');
        try {
            _blobServiceClient = BlobServiceClient.fromConnectionString(cs);
            console.log('[mcpNotes] BlobServiceClient created');
        } catch (err) {
            console.error('[mcpNotes] BlobServiceClient.fromConnectionString failed:', err.message);
            throw err;
        }
    }
    return _blobServiceClient.getContainerClient('mcp-notes');
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
                category: { type: 'string' },
                tag: { type: 'string' },
                since: { type: 'string', description: 'ISO8601 date' },
            },
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

async function ensureContainer(containerClient) {
    console.log('[mcpNotes] ensureContainer called');
    try {
        await containerClient.createIfNotExists();
        console.log('[mcpNotes] ensureContainer succeeded');
    } catch (err) {
        console.error('[mcpNotes] ensureContainer failed:', err.code, err.message);
        if (err.code !== 'ContainerAlreadyExists') throw err;
    }
}

async function readNote(id) {
    const containerClient = getContainerClient();
    await ensureContainer(containerClient);
    const blobClient = containerClient.getBlobClient(`notes/${id}.json`);
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
    const containerClient = getContainerClient();
    await ensureContainer(containerClient);
    const blobClient = containerClient.getBlockBlobClient(`notes/${note.id}.json`);
    const content = JSON.stringify(note, null, 2);
    await blobClient.upload(content, Buffer.byteLength(content), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
    });
}

async function deleteBlob(id) {
    const containerClient = getContainerClient();
    await ensureContainer(containerClient);
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
    const containerClient = getContainerClient();
    await ensureContainer(containerClient);
    const notes = [];
    for await (const blob of containerClient.listBlobsFlat({ prefix: 'notes/' })) {
        const id = blob.name.replace(/^notes\//, '').replace(/\.json$/, '');
        const note = await readNote(id);
        if (note) notes.push(note);
    }
    // ULIDs are lexicographically sortable — ascending = chronological
    notes.sort((a, b) => a.id.localeCompare(b.id));
    return notes;
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function addNote(args) {
    process.stdout.write('[mcpNotes] addNote called\n');
    try {
        const { content, category, tags = [], related = [], supersedes = null } = args;

        if (!VALID_CATEGORIES.includes(category)) {
            throw new Error(`category must be one of: ${VALID_CATEGORIES.join(', ')}`);
        }

        process.stdout.write('[mcpNotes] generating id\n');
        const timestamp = Date.now().toString(36).padStart(10, '0').toUpperCase();
        const random = crypto.randomBytes(10).toString('hex').toUpperCase();
        const id = timestamp + random;
        process.stdout.write(`[mcpNotes] id=${id}\n`);
        const created_at = new Date().toISOString();
        const note = { id, content, category, tags, related, supersedes, created_at, source: 'conversation' };

        process.stdout.write('[mcpNotes] calling writeNote\n');
        await writeNote(note);
        process.stdout.write('[mcpNotes] writeNote done\n');
        return { id, created_at };
    } catch (err) {
        process.stderr.write(`[mcpNotes] addNote ERROR: ${err && err.message ? err.message : String(err)}\n`);
        process.stderr.write(`[mcpNotes] addNote STACK: ${err && err.stack ? err.stack : 'none'}\n`);
        throw err;
    }
}

    await writeNote(note);
    return { id, created_at };
}

async function getNotes(args) {
    const { category, tag, since } = args || {};
    const sinceDate = since ? new Date(since) : null;

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

            if (!name) {
                return { jsonrpc: '2.0', error: { code: -32602, message: 'Invalid params: tool name is required' }, id };
            }

            const handler = TOOL_HANDLERS[name];
            if (!handler) {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: `Unknown tool: ${name}. Available: ${Object.keys(TOOL_HANDLERS).join(', ')}` },
                    id,
                };
            }

            try {
                context.log(`Executing notes tool: ${name}`);
                const result = await Promise.resolve(handler(args || {}));
                context.log(`Notes tool succeeded: ${name}`);

                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify({ ...getDateContext(), tool: name, data: result }, null, 2) }],
                    },
                    id,
                };
            } catch (err) {
                context.log.error(`Notes tool error [${name}]: ${err.message}`);
                context.log.error(`Notes tool error stack: ${err.stack}`);
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
        context.log('MCP Notes request received');

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.error('Failed to parse request body:', parseError);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null }),
                };
            }

            const response = await handleMcpRequest(body, context);

            if (response === null) return { status: 204 };

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
            };
        } catch (err) {
            context.log.error('MCP Notes unhandled error:', err.message);
            context.log.error('MCP Notes unhandled stack:', err.stack);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null }),
            };
        }
    },
});
