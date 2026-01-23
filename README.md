# Gloucester City Council Committees Server

A dual-mode server providing access to Gloucester City Council committee information:
1. **Azure Functions** - HTTP REST API for web access
2. **MCP Server** - Model Context Protocol for Claude Desktop integration

Built with Node.js using Azure Functions v4 programming model.

## Features

- **Azure Functions v4**: Production-ready HTTP API deployment
- **MCP Support**: stdio transport for Claude Desktop (no SSE)
- **Simple Architecture**: Self-contained functions using CommonJS
- **JavaScript**: Pure JavaScript (no TypeScript compilation needed)
- **Committee Data Access**: Query council committees, members, and metadata
- **Optimized Deployment**: Clean GitHub Actions workflow

## Prerequisites

- Node.js v20.0.0 or higher
- Azure Functions Core Tools v4 (for local development)
- Azure subscription (for deployment)

## Installation

```bash
# Install dependencies
npm install

# Install Azure Functions Core Tools (if not already installed)
npm install -g azure-functions-core-tools@4 --unsafe-perm true
```

## Usage

### Mode 1: Azure Functions (HTTP API)

Run the server as an Azure Function for HTTP access:

```bash
# Start locally
npm start

# API will be available at:
# http://localhost:7071/api/committees
```

See [API.md](./API.md) for complete API endpoint documentation.

**Deployment to Azure:**

1. Create an Azure Function App in the Azure Portal
2. Get the Publish Profile and add it to GitHub Secrets as `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`
3. Update `AZURE_FUNCTIONAPP_NAME` in `.github/workflows/deploy-azure-functions.yml`
4. Push to `main` branch - deployment happens automatically

### Mode 2: MCP Server (Claude Desktop)

Run as an MCP server for Claude Desktop integration:

```bash
npm run start:mcp
```

Add to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gcc-committees": {
      "command": "node",
      "args": ["/path/to/GCC-MCP-Pilot/server.js"]
    }
  }
}
```

## API Endpoints (Azure Functions Mode)

When running as Azure Functions, the following HTTP endpoints are available:

- `GET /api/committees/all` - Get all committees
- `GET /api/committees/search?query={q}&category={cat}` - Search committees
- `GET /api/committees/get/{id}` - Get committee by ID
- `GET /api/committees/members/{id}` - Get committee members
- `GET /api/committees/categories` - List all categories
- `GET /api/committees/summary` - Get committees summary
- `GET /api/committees/metadata` - Get dataset metadata

See [API.md](./API.md) for detailed endpoint documentation and examples.

## MCP Resources (MCP Server Mode)

The MCP server exposes the following resources:

- `gcc://committees/all` - All committees list
- `gcc://committees/metadata` - Dataset metadata and statistics
- `gcc://committees/categories` - Unique committee categories
- `gcc://committees/{id}` - Individual committee details by ID

## MCP Tools (MCP Server Mode)

### search_committees

Search committees by name or category.

**Parameters:**
- `query` (string, optional): Search query for committee names
- `category` (string, optional): Filter by category

**Example:**
```json
{
  "query": "Cabinet",
  "category": "Cabinet"
}
```

### get_committee

Get detailed information about a specific committee.

**Parameters:**
- `committee_id` (number, required): Committee ID

**Example:**
```json
{
  "committee_id": 129
}
```

### get_committee_members

Get the member list for a specific committee.

**Parameters:**
- `committee_id` (number, required): Committee ID

### list_categories

Get all unique committee categories.

### get_committees_summary

Get a high-level summary of all committees with basic information.

## Data Structure

The committee data includes:

- Committee ID, title, and category
- Purpose and description
- Member list with roles
- Contact information
- URLs for details, meetings, attendance, etc.

## Committee Categories

Available categories include:
- Cabinet
- Council
- Constitution
- Overview and Scrutiny
- Regulatory and Other Committees
- Other Committees

## Development

### Architecture

Simple standalone function files using CommonJS:

**Azure Functions (`src/functions/committees.js`)**:
- Self-contained function using CommonJS (`require`)
- Loads data from `json/committees.json` on cold start
- Uses `app.http()` directly with inline handler
- All logic in one file - no complex imports

**MCP Server (`server.js`)**:
- Separate MCP server for Claude Desktop integration
- Uses ES modules (required by MCP SDK)
- stdio transport (no SSE)

### File Structure

```
├── src/
│   ├── app.js                  # Azure Functions entry point (registers functions)
│   └── functions/
│       └── committees.js       # Self-contained HTTP function (CommonJS)
├── server.js                   # MCP server (ES modules)
├── json/
│   └── committees.json         # Committee data
├── host.json                   # Azure Functions v4 config
└── .github/workflows/
    └── deploy-azure-functions.yml
```

### Azure Functions Configuration

- **host.json**: Azure Functions v4 host configuration
- **local.settings.json**: Local development settings (git-ignored)
- **.funcignore**: Excludes unnecessary files from deployment
- **.github/workflows/deploy-azure-functions.yml**: Optimized deployment workflow

### Adding New Functions

To add a new function, create a new file in `src/functions/`:

```javascript
const { app } = require("@azure/functions");

app.http("yourfunction", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "yourfunction",
  handler: async (request, context) => {
    return {
      status: 200,
      jsonBody: { message: "Hello!" }
    };
  }
});
```

Then register it in `src/app.js`:

```javascript
require('./functions/yourfunction');
```

## Data Source

Committee data is sourced from Gloucester City Council's democracy portal:
- Base URL: https://democracy.gloucester.gov.uk
- Generated: 2026-01-22

## License

MIT
