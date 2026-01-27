# Council Identifiers Reference

This document provides a complete reference for identifying and querying Gloucestershire councils through the MCP server.

## Overview

The MCP server provides access to democratic data for **7 Gloucestershire councils**. All tools that query council-specific data require a `council_name` parameter with an exact case-sensitive match.

## Quick Reference

### Parameter Name
All council-specific tools use: **`council_name`**

### Discovery Tool
Use the **`list_available_councils`** tool to discover all available councils and their metadata programmatically.

## Valid Council Names

These are the exact strings (case-sensitive) that must be used in the `council_name` parameter:

| Council Name | URL | Committees | Wards |
|--------------|-----|------------|-------|
| **Gloucestershire County Council** | https://glostext.gloucestershire.gov.uk | 32 | 55 |
| **Gloucester City Council** | https://democracy.gloucester.gov.uk | 15 | 39 |
| **Tewkesbury Borough Council** | https://minutes.tewkesbury.gov.uk | 15 | 38 |
| **Stroud District Council** | https://stroud.moderngov.co.uk | 10 | 51 |
| **Cheltenham Borough Council** | https://democracy.cheltenham.gov.uk | 18 | 40 |
| **Cotswold District Council** | https://meetings.cotswold.gov.uk | 18 | 34 |
| **Forest of Dean District Council** | https://meetings.fdean.gov.uk | 9 | 38 |

## Tools That Require Council Name

The following tools require the `council_name` parameter:

### Required Parameter
- ✅ `get_councillors` - Get all councillors for a council
- ✅ `get_councillors_by_ward` - Get councillors by ward
- ✅ `get_meetings` - Get committee meetings
- ✅ `get_meeting_details` - Get meeting details
- ✅ `get_attachment` - Get document attachments

### Optional Parameter
- 🔄 `list_committees` - Returns all councils if omitted, or specific council if provided

### No Parameter
- ℹ️ `list_available_councils` - Lists all available councils (use this first!)
- ℹ️ `analyze_meeting_document` - Document analysis (uses URLs)

## Usage Examples

### Correct Usage ✅
```json
{
  "council_name": "Gloucester City Council"
}
```

### Incorrect Usage ❌
```json
// Wrong - missing "City"
{
  "council_name": "Gloucester Council"
}

// Wrong - incorrect case
{
  "council_name": "gloucester city council"
}

// Wrong - abbreviation
{
  "council_name": "GCC"
}
```

## Best Practices

1. **Always use `list_available_councils` first** when discovering councils
2. **Copy the exact name** from the tool response or this document
3. **Check for typos** - the parameter is case-sensitive
4. **Use enum validation** - The JSON schema includes enum constraints to validate council names
5. **Handle errors gracefully** - Invalid council names will return a helpful error with available councils

## Schema Validation

All `council_name` parameters include:
- **Type constraint**: Must be a string
- **Enum constraint**: Must match one of the 7 valid council names exactly
- **Description**: Includes reminder about exact matching and reference to `list_available_councils`

Example schema:
```json
{
  "council_name": {
    "type": "string",
    "description": "Council name. Must match exactly (case-sensitive). Use list_available_councils to see valid names.",
    "enum": [
      "Gloucestershire County Council",
      "Gloucester City Council",
      "Tewkesbury Borough Council",
      "Stroud District Council",
      "Cheltenham Borough Council",
      "Cotswold District Council",
      "Forest of Dean District Council"
    ]
  }
}
```

## Data Sources

Council data is loaded from:
- **Main config**: `json/Gloucestershire/councils.json`
- **Committee data**: `json/Gloucestershire/council_data/{Council_Name}/committees.json`
- **Ward data**: `json/Gloucestershire/council_data/{Council_Name}/wards.json`

Where `{Council_Name}` is the council name with spaces replaced by underscores (e.g., `Gloucester_City_Council`).

## Support

For issues with council identifiers or data availability:
1. Check this reference document first
2. Use `list_available_councils` to verify current configuration
3. Report issues at: https://github.com/Gloucester-City-Council/GCC-MCP-Pilot/issues
