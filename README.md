# Gloucester City Council Committees MCP Server

A Model Context Protocol (MCP) server providing access to Gloucester City Council committee information. Built with Node.js v24+ using v4 functions architecture with `context.api` initialization.

## Features

- **No SSE**: Uses stdio transport for communication
- **V4 Functions Architecture**: All API functions initialized on `context.api`
- **JavaScript**: Pure JavaScript (no TypeScript compilation needed)
- **Committee Data Access**: Query council committees, members, and metadata

## Architecture

This MCP server uses a v4 functions pattern where all API operations are initialized as functions on the `context.api` object:

```javascript
context.api.getAllCommittees()
context.api.getCommitteeById(id)
context.api.searchCommittees(query, category)
context.api.getMetadata()
context.api.getCategories()
context.api.getCommitteeMembers(committeeId)
context.api.getCommitteesSummary()
```

## Prerequisites

- Node.js v24.0.0 or higher

## Installation

```bash
# Install dependencies
npm install
```

## Usage

### Running the Server

```bash
npm start
```

### Integration with Claude Desktop

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

## Available Resources

The server exposes the following MCP resources:

- `gcc://committees/all` - All committees list
- `gcc://committees/metadata` - Dataset metadata and statistics
- `gcc://committees/categories` - Unique committee categories
- `gcc://committees/{id}` - Individual committee details by ID

## Available Tools

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

The server architecture:

1. **Data Loading**: Loads `json/committees.json` on startup
2. **API Initialization**: Creates v4 functions on `context.api`
3. **MCP Server**: Configures request handlers using `context.api` functions
4. **Transport**: Connects via stdio (no SSE)

## Data Source

Committee data is sourced from Gloucester City Council's democracy portal:
- Base URL: https://democracy.gloucester.gov.uk
- Generated: 2026-01-22

## License

MIT
