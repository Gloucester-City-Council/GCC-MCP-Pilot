#!/usr/bin/env node

/**
 * Gloucester City Council Committees MCP Server
 *
 * MCP server using v4 functions with context.api initialization
 * No SSE - uses stdio transport
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Get project paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Context object that will hold our API functions
const context = {
  api: {},
  data: null
};

/**
 * Load committees data from JSON file
 */
async function loadCommitteesData() {
  try {
    const filePath = join(__dirname, "json", "committees.json");
    const fileContent = await readFile(filePath, "utf-8");
    context.data = JSON.parse(fileContent);
    console.error(`✓ Loaded ${context.data?.committees?.length || 0} committees`);
  } catch (error) {
    console.error("✗ Failed to load committees data:", error);
    throw error;
  }
}

/**
 * Initialize all v4 API functions on context.api
 */
function initializeApiFunctions() {

  // API function: Get all committees
  context.api.getAllCommittees = () => {
    return context.data?.committees || [];
  };

  // API function: Get committee by ID
  context.api.getCommitteeById = (id) => {
    return context.data?.committees?.find(c => c.id === id);
  };

  // API function: Search committees
  context.api.searchCommittees = (query, category) => {
    let results = context.api.getAllCommittees();

    if (query) {
      const queryLower = query.toLowerCase();
      results = results.filter(c =>
        c.title.toLowerCase().includes(queryLower)
      );
    }

    if (category) {
      const categoryLower = category.toLowerCase();
      results = results.filter(c =>
        c.category && c.category.toLowerCase().includes(categoryLower)
      );
    }

    return results;
  };

  // API function: Get metadata
  context.api.getMetadata = () => {
    return {
      council: context.data?.council,
      generatedUtc: context.data?.generatedUtc,
      source: context.data?.source,
      counts: context.data?.counts
    };
  };

  // API function: Get categories
  context.api.getCategories = () => {
    const categories = new Set();
    context.api.getAllCommittees().forEach(c => {
      if (c.category) {
        categories.add(c.category);
      }
    });
    return Array.from(categories).sort();
  };

  // API function: Get committee members
  context.api.getCommitteeMembers = (committeeId) => {
    const committee = context.api.getCommitteeById(committeeId);
    if (!committee) {
      return null;
    }
    return {
      committee_id: committeeId,
      committee_name: committee.title,
      members: committee.members || []
    };
  };

  // API function: Get committees summary
  context.api.getCommitteesSummary = () => {
    const committees = context.api.getAllCommittees();
    const summary = committees.map(c => ({
      id: c.id,
      title: c.title,
      category: c.category,
      member_count: c.members?.length || 0,
      urls: c.urls
    }));

    return {
      total_committees: summary.length,
      metadata: context.api.getMetadata(),
      committees: summary
    };
  };

  // API function: List all resources
  context.api.listResources = () => {
    const committees = context.api.getAllCommittees();

    const resources = [
      {
        uri: "gcc://committees/all",
        name: "All Committees",
        description: "Complete list of all Gloucester City Council committees",
        mimeType: "application/json"
      },
      {
        uri: "gcc://committees/metadata",
        name: "Committees Metadata",
        description: "Metadata about the committees dataset",
        mimeType: "application/json"
      },
      {
        uri: "gcc://committees/categories",
        name: "Committee Categories",
        description: "List of unique committee categories",
        mimeType: "application/json"
      }
    ];

    // Add individual committee resources
    committees.forEach(committee => {
      resources.push({
        uri: `gcc://committees/${committee.id}`,
        name: `Committee: ${committee.title}`,
        description: `Details for ${committee.title} (ID: ${committee.id})`,
        mimeType: "application/json"
      });
    });

    return resources;
  };

  // API function: Read a resource
  context.api.readResource = (uri) => {
    if (uri === "gcc://committees/all") {
      return JSON.stringify(context.api.getAllCommittees(), null, 2);
    }

    if (uri === "gcc://committees/metadata") {
      return JSON.stringify(context.api.getMetadata(), null, 2);
    }

    if (uri === "gcc://committees/categories") {
      return JSON.stringify(context.api.getCategories(), null, 2);
    }

    if (uri.startsWith("gcc://committees/")) {
      const committeeId = parseInt(uri.split("/").pop());
      if (isNaN(committeeId)) {
        throw new Error(`Invalid committee ID in URI: ${uri}`);
      }

      const committee = context.api.getCommitteeById(committeeId);
      if (!committee) {
        throw new Error(`Committee with ID ${committeeId} not found`);
      }

      return JSON.stringify(committee, null, 2);
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  };

  // API function: List all tools
  context.api.listTools = () => {
    return [
      {
        name: "search_committees",
        description: "Search committees by name or category. Returns matching committees with their details.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query to match against committee names"
            },
            category: {
              type: "string",
              description: "Filter by committee category (e.g., 'Cabinet', 'Council', 'Overview and Scrutiny')"
            }
          }
        }
      },
      {
        name: "get_committee",
        description: "Get detailed information about a specific committee by ID",
        inputSchema: {
          type: "object",
          properties: {
            committee_id: {
              type: "number",
              description: "The unique ID of the committee"
            }
          },
          required: ["committee_id"]
        }
      },
      {
        name: "get_committee_members",
        description: "Get the list of members for a specific committee",
        inputSchema: {
          type: "object",
          properties: {
            committee_id: {
              type: "number",
              description: "The unique ID of the committee"
            }
          },
          required: ["committee_id"]
        }
      },
      {
        name: "list_categories",
        description: "Get a list of all unique committee categories",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_committees_summary",
        description: "Get a high-level summary of all committees with basic information",
        inputSchema: {
          type: "object",
          properties: {}
        }
      }
    ];
  };

  // API function: Call a tool
  context.api.callTool = (name, args) => {
    switch (name) {
      case "search_committees": {
        const query = args?.query;
        const category = args?.category;
        const results = context.api.searchCommittees(query, category);

        return {
          query,
          category,
          count: results.length,
          results
        };
      }

      case "get_committee": {
        const committeeId = args?.committee_id;
        if (typeof committeeId !== "number") {
          throw new Error("committee_id is required and must be a number");
        }

        const committee = context.api.getCommitteeById(committeeId);
        if (!committee) {
          return { error: `Committee with ID ${committeeId} not found` };
        }

        return committee;
      }

      case "get_committee_members": {
        const committeeId = args?.committee_id;
        if (typeof committeeId !== "number") {
          throw new Error("committee_id is required and must be a number");
        }

        const result = context.api.getCommitteeMembers(committeeId);
        if (!result) {
          return { error: `Committee with ID ${committeeId} not found` };
        }

        return result;
      }

      case "list_categories": {
        const categories = context.api.getCategories();
        return {
          categories,
          count: categories.length
        };
      }

      case "get_committees_summary": {
        return context.api.getCommitteesSummary();
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };

  console.error("✓ Initialized v4 API functions on context.api");
}

/**
 * Create and configure the MCP server
 */
function createServer() {
  const server = new Server(
    {
      name: "gcc-committees",
      version: "1.0.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  // List resources handler - uses context.api
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: context.api.listResources()
    };
  });

  // Read resource handler - uses context.api
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    try {
      const content = context.api.readResource(uri);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: content
          }
        ]
      };
    } catch (error) {
      throw new Error(error.message);
    }
  });

  // List tools handler - uses context.api
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: context.api.listTools()
    };
  });

  // Call tool handler - uses context.api
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = context.api.callTool(name, args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: error.message })
          }
        ]
      };
    }
  });

  return server;
}

/**
 * Main entry point
 */
async function main() {
  console.error("═══════════════════════════════════════════════════════");
  console.error("  Gloucester City Council Committees MCP Server");
  console.error("  v4 Functions Architecture with context.api");
  console.error("═══════════════════════════════════════════════════════");
  console.error(`Node.js version: ${process.version}`);
  console.error("");

  // Step 1: Load data
  await loadCommitteesData();

  // Step 2: Initialize v4 API functions on context.api
  initializeApiFunctions();

  // Step 3: Create MCP server
  const server = createServer();

  // Step 4: Connect to stdio transport (no SSE)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("✓ MCP Server running on stdio (no SSE)");
  console.error("═══════════════════════════════════════════════════════");
}

// Start the server
main().catch((error) => {
  console.error("✗ Fatal error:", error);
  process.exit(1);
});
