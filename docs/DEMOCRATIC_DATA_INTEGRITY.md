# Democratic Data Integrity Guidelines

## Overview

When using data from Gloucester-Democracy-MCP tools (committee meetings, agendas, documents), you are accessing **official statutory records of democratic decision-making**. These require special handling to preserve democratic accountability and information governance.

## Mandatory Rules for Official Records

### 1. NEVER Paraphrase Formal Decisions

The following **MUST be quoted verbatim**:
- Committee recommendations
- Council decisions
- Formal resolutions
- Motions

Use blockquote formatting for official text.

### 2. ALWAYS Provide Source Links

- Every piece of official information must link back to the source
- Use the provided URLs from MCP responses (`source_url`, `web_page`)
- Format as clickable links: `[View committee paper](url)`

### 3. Distinguish Official Record from Interpretation

Use clear structure:
1. **Official Record** (exact quote)
2. **Plain English Explanation** (your interpretation)
3. **Source Link**

Never blend official text with paraphrasing.

## Response Structure for Democratic Data

```
**Official Record:**
> [Exact quote from document]

**In Plain English:**
[Your explanation/interpretation]

**Source:** [Link to original document]
```

## When Summarizing Committee Papers

| Content Type | Treatment |
|-------------|-----------|
| Background/context | High-level summary acceptable |
| Recommendations | Quote directly |
| Decisions | Quote directly |
| Resolutions | Quote directly |
| Financial implications | Quote directly |
| Legal implications | Quote directly |

Always note: "For full details, see [link]"

## Prohibited Actions

- Paraphrasing formal decisions (e.g., "The council decided to align budgets")
- Presenting interpretations as if they are official record
- Omitting source links for official decisions
- Combining multiple recommendations into your own summary without quoting

## Correct vs Incorrect Examples

### CORRECT:

```
The committee paper makes one formal recommendation:

> "The base budgets need to be in line with the Councils activity
> to ensure they are realistic forecasts and in line with the actual
> outturn to prevent significant variations."

This means the council needs to align its budgets with actual spending
to avoid the overspends that have occurred in previous years.

[View full committee paper](https://democracy.gloucester.gov.uk/...)
```

### INCORRECT:

```
The council wants to make budgets more realistic to prevent overspends.
```

(This paraphrases the official recommendation without quoting it)

## Data Classification Awareness

MCP responses include metadata to help identify official content:

| Field | Meaning |
|-------|---------|
| `data_classification: "official_record"` | Treat as statutory record |
| `is_official_record: true` | Apply all verbatim quoting rules |
| `official_sections` | Array of section names requiring verbatim quotes |
| `source_url` | Always include in your response |

## Handling Questions About Official Records

**User asks:** "What did the council decide about the budget?"

**CORRECT response:**

```
At the Council meeting on 29 January 2026, the committee paper recommended:

> "[exact recommendation text]"

This addresses [plain English explanation of what this means].

[View meeting agenda](url) | [View committee paper](url)
```

## Transparency About Sources

- Make it clear when information comes from ModernGov
- Example: "According to the official committee paper published on ModernGov..."
- Never present official record as if it's your own knowledge

## When Official Text is Unclear or Contains Errors

- Quote it exactly as written
- Note: "The official text states [quote]. [Your interpretation if needed]"
- Do not "fix" grammatical errors or typos in official quotes
- You can note issues: `[sic]` or "Note: This appears in the original document"

## Why This Matters

These rules protect democratic accountability by:

1. **Preserving the integrity** of the official record
2. **Ensuring citizens can verify** information at source
3. **Clearly separating** fact from interpretation
4. **Maintaining the statutory nature** of committee decisions
5. **Supporting information governance** and audit requirements

## The Golden Rule

> **When in doubt: quote verbatim, cite source, explain separately.**

## MCP Tool Reference

### get_meeting_details

Returns official meeting data including:
- `data_classification`: "official_record"
- `is_official_record`: true
- `official_content_guidance`: Specifies what requires verbatim quoting

### analyze_meeting_document

Returns extracted document content including:
- `data_classification`: "official_record"
- `official_sections`: Array of sections requiring verbatim quotes
- `summarizable_sections`: Array of sections that may be summarized
- `content_guidance`: Formatting guidance

### Response Fields to Always Include

When presenting data from these tools, always include:

1. The `source_url` or `web_page` link
2. Verbatim quotes for content from `official_sections`
3. Clear separation between quote and interpretation

## User Preference Setting

Users can add this to their Claude preferences:

```
When I ask about council meetings, committee decisions, or democratic
processes, always quote official recommendations and decisions verbatim
rather than paraphrasing them. Include links to source documents.
Clearly separate official record from your explanations.
```

## Example Full Response Pattern

**User:** "What did the revised budget paper recommend?"

**Claude Response:**

```
The Revised Budget 2025-26 paper contains one formal recommendation to Council:

> "The base budgets need to be in line with the Councils activity to ensure
> they are realistic forecasts and in line with the actual outturn to prevent
> significant variations. This is an important part of the recovery plan and
> the requirements of the statutory recommendations."

**What this means:** The council needs to reset its budgets to match actual
spending patterns, rather than using unrealistic estimates that have led to
consistent overspends. This is specifically required as part of responding
to the External Auditor's Statutory Recommendations issued in October 2025.

The paper recommends increasing the 2025-26 budget by £2.85m to reflect
realistic spending in areas like commercial property income (down £1.8m),
IT costs (up £298k), and crematorium income (down £496k).

[View full committee paper](https://democracy.gloucester.gov.uk/...)
```

This response pattern ensures:
- Official record is protected and quoted
- Users still get helpful explanations
- Sources are always traceable
- Information governance requirements met
- Democratic accountability preserved
- Interpretation clearly distinguished from record
