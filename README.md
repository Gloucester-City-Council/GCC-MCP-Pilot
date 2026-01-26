# ModernGov MCP Server

Azure Functions v4 MCP (Model Context Protocol) server for accessing the Gloucester City Council ModernGov SOAP API.

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| MCP protocol implementation | ✅ Complete | `initialize`, `tools/list`, `tools/call` |
| Tool schemas defined | ✅ Complete | 4 tools with full JSON Schema |
| Tool routing | ✅ Complete | End-to-end flow working |
| ModernGov SOAP client | ⚠️ STUBBED | Needs response exploration |
| Committee IDs | ⚠️ Pending | Populate from live SOAP data |

## Project Structure

```
moderngov-mcp/
├── package.json
├── host.json
├── src/
│   └── functions/
│       ├── mcp.js          # Main MCP HTTP endpoint
│       └── test-soap.js    # SOAP exploration endpoint
├── lib/
│   ├── mcp-handler.js      # MCP JSON-RPC protocol handler
│   ├── moderngov-client.js # SOAP client (STUB)
│   └── tools/
│       ├── list-committees.js
│       ├── get-councillors.js
│       ├── get-meetings.js
│       └── get-meeting-details.js
└── json/
    └── committees.json     # Committee knowledge base
```

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `list_committees` | List all Gloucester City Council committees |
| `get_councillors` | Get all councillors organized by ward |
| `get_councillors_by_ward` | Get councillors for a specific ward |
| `get_meetings` | Get scheduled meetings for a committee |
| `get_meeting_details` | Get detailed meeting information (agenda, documents, etc.) |
| `get_attachment` | Get metadata and URL for a specific document |
| `analyze_meeting_document` | Extract structured content from committee papers (PDFs) |

## Democratic Data Integrity

**IMPORTANT:** This MCP server returns official statutory records of democratic decision-making. AI assistants using this data must follow special handling rules:

- **Quote verbatim**: Committee recommendations, decisions, resolutions, and motions must be quoted exactly
- **Always link sources**: Include the `source_url` or `web_page` link from responses
- **Separate interpretation**: Clearly distinguish official record from explanations

See [docs/DEMOCRATIC_DATA_INTEGRITY.md](docs/DEMOCRATIC_DATA_INTEGRITY.md) for complete guidelines.

### Data Classification Fields

Tool responses include metadata to identify official content:

```json
{
  "data_classification": "official_record",
  "is_official_record": true,
  "official_sections": ["recommendations", "decisions", "legal_implications"],
  "source": {
    "system": "ModernGov",
    "council": "Gloucester City Council",
    "url": "https://democracy.gloucester.gov.uk/..."
  }
}
```

## Local Development

### Prerequisites

- Node.js 18+
- Azure Functions Core Tools v4

### Setup

```bash
cd moderngov-mcp
npm install
```

### Start the server

```bash
func start
```

The server will start at `http://localhost:7071`

## Testing

### Test MCP Protocol

```bash
# Test initialize
curl -X POST http://localhost:7071/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'

# Test tools/list
curl -X POST http://localhost:7071/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'

# Test tools/call - list committees
curl -X POST http://localhost:7071/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_committees","arguments":{}},"id":3}'

# Test tools/call - get councillors
curl -X POST http://localhost:7071/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_councillors","arguments":{"postcode":"GL1 1AA"}},"id":4}'

# Test tools/call - get meetings
curl -X POST http://localhost:7071/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_meetings","arguments":{"committee_id":123}},"id":5}'

# Test tools/call - get meeting details
curl -X POST http://localhost:7071/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_meeting_details","arguments":{"meeting_id":456}},"id":6}'
```

### Explore SOAP Responses

Use the test-soap endpoint to see actual XML responses from ModernGov:

```bash
# List available operations
curl http://localhost:7071/api/test-soap

# Test GetCommittees
curl http://localhost:7071/api/test-soap/GetCommittees

# Test GetCouncillorsByPostcode
curl "http://localhost:7071/api/test-soap/GetCouncillorsByPostcode?postcode=GL1%201AA"

# Test GetMeetings with committee ID
curl "http://localhost:7071/api/test-soap/GetMeetings?committeeId=123"

# Test GetMeeting with meeting ID
curl "http://localhost:7071/api/test-soap/GetMeeting?meetingId=456"
```

## Next Steps

1. **Explore SOAP responses** - Use `/api/test-soap/{operation}` to see actual XML structure
2. **Implement XML parsing** - Based on actual response structure in `lib/moderngov-client.js`
3. **Update committee IDs** - Populate `moderngov_id` values in `json/committees.json`
4. **Test end-to-end** - Verify full flow with real data

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MODERNGOV_ENDPOINT` | ModernGov SOAP API URL | `https://democracy.gloucester.gov.uk/mgWebService.asmx` |

## MCP Protocol Reference

This server implements the Model Context Protocol (MCP) JSON-RPC interface:

### Methods

- `initialize` - Returns server capabilities and info
- `tools/list` - Returns available tools with JSON Schema
- `tools/call` - Executes a tool and returns results
- `ping` - Health check

### Response Format

All responses follow JSON-RPC 2.0 format:

```json
{
  "jsonrpc": "2.0",
  "result": { ... },
  "id": 1
}
```

Tool call results are wrapped in MCP content format:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{ ... JSON result ... }"
      }
    ]
  },
  "id": 1
}
```

## Deployment

Deploy to Azure Functions using:

```bash
func azure functionapp publish <app-name>
```

## License

MIT
