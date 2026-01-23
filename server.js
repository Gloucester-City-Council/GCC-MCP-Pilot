#!/usr/bin/env node

/**
 * Gloucester City Council Committees MCP Server
 *
 * MCP server using v4 functions with context.api initialization
 * No SSE - uses stdio transport
 * All business logic in src/context-api.js
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import context from "./src/context-api.js";

/**
 * Create and configure the MCP server
 * Uses context.api for all business logic
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

    return { resources };
  });

  // Read resource handler - uses context.api
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    let content;

    if (uri === "gcc://committees/all") {
      content = JSON.stringify(context.api.getAllCommittees(), null, 2);
    } else if (uri === "gcc://committees/metadata") {
      content = JSON.stringify(context.api.getMetadata(), null, 2);
    } else if (uri === "gcc://committees/categories") {
      content = JSON.stringify(context.api.getCategories(), null, 2);
    } else if (uri.startsWith("gcc://committees/")) {
      const committeeId = parseInt(uri.split("/").pop());
      if (isNaN(committeeId)) {
        throw new Error(`Invalid committee ID in URI: ${uri}`);
      }

      const committee = context.api.getCommitteeById(committeeId);
      if (!committee) {
        throw new Error(`Committee with ID ${committeeId} not found`);
      }

      content = JSON.stringify(committee, null, 2);
    } else {
      throw new Error(`Unknown resource URI: ${uri}`);
    }

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: content
        }
      ]
    };
  });

  // List tools handler - uses context.api
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
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
      ]
    };
  });

  // Call tool handler - uses context.api
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result;

      switch (name) {
        case "search_committees": {
          const query = args?.query;
          const category = args?.category;
          const results = context.api.searchCommittees(query, category);

          result = {
            query,
            category,
            count: results.length,
            results
          };
          break;
        }

        case "get_committee": {
          const committeeId = args?.committee_id;
          if (typeof committeeId !== "number") {
            throw new Error("committee_id is required and must be a number");
          }

          const committee = context.api.getCommitteeById(committeeId);
          if (!committee) {
            result = { error: `Committee with ID ${committeeId} not found` };
          } else {
            result = committee;
          }
          break;
        }

        case "get_committee_members": {
          const committeeId = args?.committee_id;
          if (typeof committeeId !== "number") {
            throw new Error("committee_id is required and must be a number");
          }

          const members = context.api.getCommitteeMembers(committeeId);
          if (!members) {
            result = { error: `Committee with ID ${committeeId} not found` };
          } else {
            result = members;
          }
          break;
        }

        case "list_categories": {
          const categories = context.api.getCategories();
          result = {
            categories,
            count: categories.length
          };
          break;
        }

        case "get_committees_summary": {
          result = context.api.getCommitteesSummary();
          break;
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

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

  // Initialize context.api
  await context.api.ensureInitialized();

  // Create MCP server
  const server = createServer();

  // Connect to stdio transport (no SSE)
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
