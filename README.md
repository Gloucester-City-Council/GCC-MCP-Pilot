# Gloucestershire Councils MCP Server

Azure Functions v4 MCP (Model Context Protocol) server for accessing democratic data from all 7 Gloucestershire councils through their ModernGov SOAP APIs.

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| MCP protocol implementation | ✅ Complete | `initialize`, `tools/list`, `tools/call` |
| Multi-council support | ✅ Complete | All 7 Gloucestershire councils |
| Tool schemas defined | ✅ Complete | 8 tools with full JSON Schema & enum validation |
| Tool routing | ✅ Complete | End-to-end flow working |
| Council discovery | ✅ Complete | `list_available_councils` tool |
| ModernGov SOAP client | ✅ Complete | Multi-endpoint support with fallback to knowledge base |
| Knowledge base | ✅ Complete | 117 committees, 295 wards across all councils |

## Supported Councils (7)

| Council | Committees | Wards | URL |
|---------|------------|-------|-----|
| **Gloucestershire County Council** | 32 | 55 | https://glostext.gloucestershire.gov.uk |
| **Gloucester City Council** | 15 | 39 | https://democracy.gloucester.gov.uk |
| **Tewkesbury Borough Council** | 15 | 38 | https://minutes.tewkesbury.gov.uk |
| **Stroud District Council** | 10 | 51 | https://stroud.moderngov.co.uk |
| **Cheltenham Borough Council** | 18 | 40 | https://democracy.cheltenham.gov.uk |
| **Cotswold District Council** | 18 | 34 | https://meetings.cotswold.gov.uk |
| **Forest of Dean District Council** | 9 | 38 | https://meetings.fdean.gov.uk |

See [docs/COUNCIL_IDENTIFIERS.md](docs/COUNCIL_IDENTIFIERS.md) for exact council name strings required in API calls.

## Project Structure

```
GCC-MCP-Pilot/
├── package.json
├── host.json
├── src/
│   ├── index.js                    # Azure Functions entry point
│   └── functions/
│       ├── mcp.js                  # Main MCP HTTP endpoint
│       └── test-soap.js            # SOAP exploration endpoint
├── lib/
│   ├── mcp-handler.js              # MCP JSON-RPC protocol handler
│   ├── moderngov-client.js         # SOAP client with multi-council support
│   ├── council-config.js           # Council configuration loader
│   └── tools/
│       ├── list-committees.js
│       ├── get-councillors.js
│       ├── get-councillors-by-ward.js
│       ├── get-meetings.js
│       ├── get-meeting-details.js
│       ├── get-attachment.js
│       └── analyze-meeting-document.js
├── json/
│   └── Gloucestershire/
│       ├── councils.json           # Council endpoints
│       └── council_data/
│           ├── Gloucester_City_Council/
│           │   ├── committees.json
│           │   └── wards.json
│           ├── Tewkesbury_Borough_Council/
│           │   ├── committees.json
│           │   └── wards.json
│           └── ... (5 more councils)
└── docs/
    ├── COUNCIL_IDENTIFIERS.md      # Council reference guide
    └── DEMOCRATIC_DATA_INTEGRITY.md
```

## Available MCP Tools

| Tool | Parameters | Description |
|------|------------|-------------|
| `list_available_councils` | None | **Start here!** Lists all 7 councils with metadata |
| `list_committees` | `council_name` (optional) | List committees for one or all councils |
| `get_councillors` | `council_name` (required) | Get all councillors by ward for a council |
| `get_councillors_by_ward` | `council_name`, `ward_name` | Get councillors for a specific ward |
| `get_meetings` | `council_name`, `committee_id` | Get meetings for a committee |
| `get_meeting_details` | `council_name`, `meeting_id` | Get detailed meeting information |
| `get_attachment` | `council_name`, `attachment_id` | Get document metadata and URL |
| `analyze_meeting_document` | `url` | Extract structured content from PDFs |

### Required Parameters

**IMPORTANT**: Most tools require `council_name` parameter with an **exact case-sensitive match**:

✅ Correct: `"Gloucester City Council"`
❌ Wrong: `"gloucester city council"` (case mismatch)
❌ Wrong: `"Gloucester Council"` (missing "City")
❌ Wrong: `"GCC"` (abbreviation)

**Use `list_available_councils` first** to get the exact council names!

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
cd GCC-MCP-Pilot
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
# Test initialize - check server info and available councils
curl -X POST http://localhost:7071/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'

# Test tools/list - see all available tools
curl -X POST http://localhost:7071/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'

# Test list_available_councils - discover councils
curl -X POST http://localhost:7071/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_available_councils","arguments":{}},"id":3}'

# Test list_committees - get committees for a specific council
curl -X POST http://localhost:7071/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_committees","arguments":{"council_name":"Gloucester City Council"}},"id":4}'

# Test list_committees - get all councils' committees
curl -X POST http://localhost:7071/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_committees","arguments":{}},"id":5}'

# Test get_councillors
curl -X POST http://localhost:7071/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_councillors","arguments":{"council_name":"Gloucester City Council"}},"id":6}'
```

### Explore SOAP Responses

Use the test-soap endpoint to see actual XML responses from ModernGov:

```bash
# List available operations
curl http://localhost:7071/api/test-soap

# Test GetCommittees
curl http://localhost:7071/api/test-soap/GetCommittees

# Test GetCouncillorsByWard
curl http://localhost:7071/api/test-soap/GetCouncillorsByWard

# Test GetMeetings with committee ID
curl "http://localhost:7071/api/test-soap/GetMeetings?committeeId=544"

# Test GetMeeting with meeting ID
curl "http://localhost:7071/api/test-soap/GetMeeting?meetingId=123456"
```

## Troubleshooting

### "Not getting any information" from ChatGPT/Claude

If you're seeing errors like "not getting any information", check:

1. **Council name parameter**: Ensure exact case-sensitive match
   ```bash
   # Check available councils first
   curl -X POST http://localhost:7071/api/mcp \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_available_councils","arguments":{}},"id":1}'
   ```

2. **Tool response format**: Tools return JSON wrapped in MCP content format:
   ```json
   {
     "result": {
       "content": [{
         "type": "text",
         "text": "{ ...actual data... }"
       }]
     }
   }
   ```

3. **Error responses**: Errors are also wrapped in content format with `isError: true`:
   ```json
   {
     "result": {
       "content": [{
         "type": "text",
         "text": "{\"error\": \"council_name is required\"}"
       }],
       "isError": true
     }
   }
   ```

4. **Check server logs**: Azure Functions logs show all tool calls and errors:
   ```bash
   # In local development
   func start
   # Watch the console output when making requests
   ```

5. **Test manually**: Use curl commands above to verify tools work correctly

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `council_name is required` | Missing parameter | Add `council_name` parameter |
| `Unknown council: ...` | Invalid council name | Use `list_available_councils` to get exact names |
| `Ward not found` | Invalid ward name | Use `get_councillors` to see available wards |
| `SOAP request failed: 403` | Network restriction | Normal - falls back to knowledge base data |

### Debugging Steps

1. **Test tools/list** to verify MCP server is responding
2. **Test list_available_councils** to verify council configuration loaded
3. **Test list_committees** with specific council to verify data access
4. **Check Azure Function logs** for detailed error messages
5. **Verify MCP client configuration** in ChatGPT/Claude settings

## MCP Client Configuration

### ChatGPT Configuration

In ChatGPT settings, configure the MCP server:

```json
{
  "mcpServers": {
    "gloucestershire-councils": {
      "url": "https://your-function-app.azurewebsites.net/api/mcp",
      "apiKey": "your-api-key-if-needed"
    }
  }
}
```

### Claude Desktop Configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gloucestershire-councils": {
      "command": "node",
      "args": ["/path/to/GCC-MCP-Pilot/mcp-stdio-wrapper.js"],
      "env": {
        "MODERNGOV_ENDPOINT": "https://democracy.gloucester.gov.uk/mgWebService.asmx"
      }
    }
  }
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MODERNGOV_ENDPOINT` | ⚠️ Deprecated - now loaded from council config | N/A |

Council endpoints are now configured in `json/Gloucestershire/councils.json`.

## MCP Protocol Reference

This server implements the Model Context Protocol (MCP) JSON-RPC interface:

### Methods

- `initialize` - Returns server capabilities, council list, and instructions
- `tools/list` - Returns 8 available tools with JSON Schema validation
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
        "text": "{ ...JSON result with date context wrapper... }"
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

## Documentation

- [Council Identifiers Reference](docs/COUNCIL_IDENTIFIERS.md) - Complete guide to valid council names
- [Democratic Data Integrity](docs/DEMOCRATIC_DATA_INTEGRITY.md) - Guidelines for handling official records

## License

MIT
