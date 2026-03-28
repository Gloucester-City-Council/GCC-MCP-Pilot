import { app } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { ulid } from "ulid";

// ---------------------------------------------------------------------------
// Blob client (module scope — reused across invocations)
// ---------------------------------------------------------------------------

const blobServiceClient = new BlobServiceClient(
  `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
  new DefaultAzureCredential()
);

const containerClient = blobServiceClient.getContainerClient("mcp-notes");

// Create the container on first use if it doesn't already exist.
// Resolves once per function instance — all requests await this promise.
const containerReady = containerClient.createIfNotExists();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = ["schema", "build", "architecture", "decision", "idea", "reference"];

// ---------------------------------------------------------------------------
// Tool manifest
// ---------------------------------------------------------------------------

const TOOL_MANIFEST = {
  tools: [
    {
      name: "add_note",
      description:
        "Add a note to the personal store. For ideas, schema decisions, build notes and architectural thinking only. Do not store case-specific information, resident data, or commercially sensitive material.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string" },
          category: {
            type: "string",
            enum: VALID_CATEGORIES,
          },
          tags: { type: "array", items: { type: "string" } },
          related: { type: "array", items: { type: "string" } },
          supersedes: { type: "string" },
        },
        required: ["content", "category"],
      },
    },
    {
      name: "get_notes",
      description: "List notes, optionally filtered by category, tag, or date.",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string" },
          tag: { type: "string" },
          since: { type: "string", description: "ISO8601 date" },
        },
      },
    },
    {
      name: "get_note",
      description: "Retrieve a single note by ID.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "get_related",
      description:
        "Retrieve a note and all its directly linked notes in one call.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_note",
      description:
        "Permanently delete a note. Consider superseding instead if you want to preserve the chain.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Blob helpers
// ---------------------------------------------------------------------------

async function readNote(id) {
  const blobClient = containerClient.getBlobClient(`notes/${id}.json`);
  try {
    const download = await blobClient.download();
    const chunks = [];
    for await (const chunk of download.readableStreamBody) {
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch (err) {
    if (err.statusCode === 404 || err.code === "BlobNotFound") return null;
    throw err;
  }
}

async function writeNote(note) {
  const blobClient = containerClient.getBlockBlobClient(`notes/${note.id}.json`);
  const content = JSON.stringify(note, null, 2);
  await blobClient.upload(content, Buffer.byteLength(content), {
    blobHTTPHeaders: { blobContentType: "application/json" },
  });
}

async function deleteBlob(id) {
  const blobClient = containerClient.getBlobClient(`notes/${id}.json`);
  try {
    await blobClient.delete();
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.code === "BlobNotFound") return false;
    throw err;
  }
}

async function listAllNotes() {
  const notes = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix: "notes/" })) {
    const id = blob.name.replace(/^notes\//, "").replace(/\.json$/, "");
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

async function addNote(input) {
  const { content, category, tags = [], related = [], supersedes = null } = input;

  if (!content) return { status: 400, body: { error: "content is required" } };
  if (!category) return { status: 400, body: { error: "category is required" } };
  if (!VALID_CATEGORIES.includes(category)) {
    return {
      status: 400,
      body: { error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` },
    };
  }

  const id = ulid();
  const created_at = new Date().toISOString();

  const note = {
    id,
    content,
    category,
    tags,
    related,
    supersedes,
    created_at,
    source: "conversation",
  };

  await writeNote(note);
  return { status: 200, body: { id, created_at } };
}

async function getNotes(input) {
  const { category, tag, since } = input || {};
  const sinceDate = since ? new Date(since) : null;

  let notes = await listAllNotes();

  if (category) notes = notes.filter((n) => n.category === category);
  if (tag) notes = notes.filter((n) => Array.isArray(n.tags) && n.tags.includes(tag));
  if (sinceDate) notes = notes.filter((n) => new Date(n.created_at) >= sinceDate);

  const summaries = notes.map((n) => ({
    id: n.id,
    category: n.category,
    tags: n.tags,
    created_at: n.created_at,
    preview: (n.content || "").slice(0, 100),
  }));

  return { status: 200, body: summaries };
}

async function getNote(input) {
  const { id } = input;
  if (!id) return { status: 400, body: { error: "id is required" } };

  const note = await readNote(id);
  if (!note) return { status: 404, body: { error: "Note not found", id } };

  return { status: 200, body: note };
}

async function getRelated(input) {
  const { id } = input;
  if (!id) return { status: 400, body: { error: "id is required" } };

  const root = await readNote(id);
  if (!root) return { status: 404, body: { error: "Note not found", id } };

  const relatedNotes = await Promise.all(
    (root.related || []).map((rid) => readNote(rid))
  );

  const supersededNote = root.supersedes ? await readNote(root.supersedes) : null;

  return {
    status: 200,
    body: {
      root,
      related: relatedNotes.filter(Boolean),
      supersedes: supersededNote,
    },
  };
}

async function deleteNote(input) {
  const { id } = input;
  if (!id) return { status: 400, body: { error: "id is required" } };

  const deleted = await deleteBlob(id);
  if (!deleted) return { status: 404, body: { error: "Note not found", id } };

  return { status: 200, body: { deleted: id } };
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

const HANDLERS = {
  add_note: addNote,
  get_notes: getNotes,
  get_note: getNote,
  get_related: getRelated,
  delete_note: deleteNote,
};

// ---------------------------------------------------------------------------
// Azure Function HTTP trigger
// ---------------------------------------------------------------------------

app.http("mcp", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "mcp-notes",
  handler: async (request, context) => {
    await containerReady;

    if (request.method === "GET") {
      return {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(TOOL_MANIFEST),
      };
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid JSON body" }),
      };
    }

    const { tool, input = {} } = body;

    if (!tool) {
      return {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "tool is required" }),
      };
    }

    const handler = HANDLERS[tool];
    if (!handler) {
      return {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `Unknown tool: ${tool}`,
          available: Object.keys(HANDLERS),
        }),
      };
    }

    try {
      const result = await handler(input);
      return {
        status: result.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.body),
      };
    } catch (err) {
      context.error("Tool execution error", { tool, error: err.message });
      return {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Internal error", tool }),
      };
    }
  },
});
