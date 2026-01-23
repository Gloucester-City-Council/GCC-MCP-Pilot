# Committees API Documentation

This API provides access to Gloucester City Council committee information via Azure Functions.

## Base URL

**Production**: `https://gcc-committees-mcp.azurewebsites.net/api`
**Local Development**: `http://localhost:7071/api`

## Endpoints

### 1. List All Committees

Get a complete list of all committees.

```http
GET /committees/all
GET /committees/list
GET /committees
```

**Example**:
```bash
curl https://gcc-committees-mcp.azurewebsites.net/api/committees/all
```

**Response**:
```json
[
  {
    "id": 129,
    "title": "Cabinet",
    "category": "Cabinet",
    "members": [...],
    ...
  }
]
```

---

### 2. Get Committee by ID

Retrieve detailed information about a specific committee.

```http
GET /committees/get/{id}
```

**Parameters**:
- `id` (path, required): Committee ID

**Example**:
```bash
curl https://gcc-committees-mcp.azurewebsites.net/api/committees/get/129
```

**Response**:
```json
{
  "id": 129,
  "title": "Cabinet",
  "category": "Cabinet",
  "purpose": "...",
  "members": [
    {
      "uid": 1001,
      "name": "John Doe",
      "role": "Chair"
    }
  ],
  "urls": {...}
}
```

---

### 3. Search Committees

Search committees by name or category.

```http
GET /committees/search?query={query}&category={category}
```

**Query Parameters**:
- `query` (optional): Search term to match against committee names
- `category` (optional): Filter by category

**Examples**:
```bash
# Search by name
curl "https://gcc-committees-mcp.azurewebsites.net/api/committees/search?query=Cabinet"

# Search by category
curl "https://gcc-committees-mcp.azurewebsites.net/api/committees/search?category=Overview"

# Combined search
curl "https://gcc-committees-mcp.azurewebsites.net/api/committees/search?query=scrutiny&category=Overview"
```

**Response**:
```json
{
  "query": "Cabinet",
  "category": null,
  "count": 1,
  "results": [...]
}
```

---

### 4. Get Committee Members

Get the member list for a specific committee.

```http
GET /committees/members/{id}
```

**Parameters**:
- `id` (path, required): Committee ID

**Example**:
```bash
curl https://gcc-committees-mcp.azurewebsites.net/api/committees/members/129
```

**Response**:
```json
{
  "committee_id": 129,
  "committee_name": "Cabinet",
  "members": [
    {
      "uid": 1001,
      "name": "John Doe",
      "role": "Chair"
    }
  ]
}
```

---

### 5. List Categories

Get all unique committee categories.

```http
GET /committees/categories
```

**Example**:
```bash
curl https://gcc-committees-mcp.azurewebsites.net/api/committees/categories
```

**Response**:
```json
{
  "categories": [
    "Cabinet",
    "Constitution",
    "Council",
    "Other Committees",
    "Overview and Scrutiny",
    "Regulatory and Other Committees"
  ],
  "count": 6
}
```

---

### 6. Get Committees Summary

Get a high-level summary of all committees with basic information.

```http
GET /committees/summary
```

**Example**:
```bash
curl https://gcc-committees-mcp.azurewebsites.net/api/committees/summary
```

**Response**:
```json
{
  "total_committees": 15,
  "metadata": {
    "council": "Gloucester City Council",
    "generatedUtc": "2026-01-22T...",
    "source": {...}
  },
  "committees": [
    {
      "id": 129,
      "title": "Cabinet",
      "category": "Cabinet",
      "member_count": 7,
      "urls": {...}
    }
  ]
}
```

---

### 7. Get Metadata

Get metadata about the committees dataset.

```http
GET /committees/metadata
```

**Example**:
```bash
curl https://gcc-committees-mcp.azurewebsites.net/api/committees/metadata
```

**Response**:
```json
{
  "council": "Gloucester City Council",
  "generatedUtc": "2026-01-22T13:55:00.000Z",
  "source": {
    "committeesUrl": "https://democracy.gloucester.gov.uk/...",
    "baseUrl": "https://democracy.gloucester.gov.uk"
  },
  "counts": {
    "totalInFeed": 15,
    "activeInOutput": 15,
    "scrapeFailures": 0,
    "withPurposeScraped": 10,
    "withPurposeSuggested": 5
  }
}
```

---

## Error Responses

All endpoints return standard HTTP status codes:

- `200 OK`: Successful request
- `400 Bad Request`: Invalid parameters
- `404 Not Found`: Committee not found
- `500 Internal Server Error`: Server error

**Error Response Format**:
```json
{
  "error": "Committee with ID 999 not found"
}
```

---

## Rate Limiting

Currently no rate limiting is enforced, but please be respectful of the service.

## CORS

CORS is enabled for all origins in development. Production CORS settings should be configured in Azure.

## Support

For issues or questions, please contact the Gloucester City Council IT department.
