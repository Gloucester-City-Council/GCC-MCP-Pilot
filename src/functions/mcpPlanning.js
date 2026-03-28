/**
 * Azure Functions v4 HTTP Trigger — GCC Planning Assist MCP
 *
 * Exposes 9 read-only MCP tools for the Gloucester householder planning
 * assessment pipeline at POST /api/mcp-planning.
 *
 * Implements the Gloucester City Council Planning Assist MCP Server per
 * Implementation Plan v1.5.1 (March 2026).
 *
 * Completely separate from the existing mcp, mcp-schema, and mcp-procurement
 * endpoints. All tool logic is in src/gcc-planning/.
 *
 * Tools:
 *   Phase 0: planning_ingest_planx_schema (PlanX → GCC facts mapping)
 *   Phase 1: planning_validate_application_facts, planning_detect_case_route
 *   Phase 2: planning_list_applicable_modules, planning_check_validation_requirements, planning_explain_rule
 *   Phase 3: planning_assess_planning_merits, planning_build_assessment_result
 *   Phase 4: planning_build_report_payload
 */

'use strict';

const { app } = require('@azure/functions');

// Wrap module load so a schema load failure returns a 503 rather than
// crashing the entire Azure Functions worker process.
let TOOLS = [], TOOL_HANDLERS = {}, SERVER_INFO = {
    name: 'gcc-planning-mcp',
    version: '1.0.0',
    schemaVersions: {},
    planVersion: '1.5.1',
};
let _moduleLoadError = null;

try {
    ({ TOOLS, TOOL_HANDLERS, SERVER_INFO } = require('../gcc-planning/index'));
} catch (err) {
    _moduleLoadError = err;
    console.error('GCC Planning MCP: module load failed —', err.message);
}
const AVAILABLE_TOOL_NAMES = () => Object.keys(TOOL_HANDLERS).join(', ');

// ─── Date context helper ──────────────────────────────────────────────────────
function getDateContext() {
    const now = new Date();
    return {
        generatedAt: now.toISOString(),
        date: now.toISOString().split('T')[0],
    };
}

// ─── MCP JSON-RPC handler ─────────────────────────────────────────────────────
async function handleMcpRequest(request, context) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return {
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request: body must be a JSON object' },
            id: null,
        };
    }

    const { jsonrpc, method, params, id } = request;
    const requestId = Object.prototype.hasOwnProperty.call(request, 'id') && id !== undefined ? id : null;

    if (jsonrpc !== '2.0') {
        return {
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
            id: requestId,
        };
    }

    context.log(`Processing MCP Planning method: ${method}`);

    switch (method) {
        case 'initialize':
            return {
                jsonrpc: '2.0',
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: {
                        ...SERVER_INFO,
                        ...getDateContext(),
                        instructions: buildInstructions(),
                    },
                },
                id,
            };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return {
                jsonrpc: '2.0',
                result: { tools: TOOLS },
                id,
            };

        case 'tools/call': {
            const { name, arguments: args } = params || {};
            const toolStart = Date.now();

            if (!name) {
                return {
                    jsonrpc: '2.0',
                    error: { code: -32602, message: 'Invalid params: tool name is required' },
                    id,
                };
            }

            const handler = TOOL_HANDLERS[name];
            if (!handler) {
                return {
                    jsonrpc: '2.0',
                    error: {
                        code: -32602,
                        message: `Unknown tool: ${name}. Available: ${AVAILABLE_TOOL_NAMES()}`,
                    },
                    id,
                };
            }

            try {
                context.log(`Executing planning tool: ${name}`);
                const result = await Promise.resolve(handler(args || {}));
                context.log(`Planning tool completed [${name}] in ${Date.now() - toolStart}ms`);

                const wrappedResult = {
                    ...getDateContext(),
                    schemaVersions: SERVER_INFO.schemaVersions,
                    planVersion: SERVER_INFO.planVersion,
                    tool: name,
                    data: result,
                };

                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(wrappedResult, null, 2),
                            },
                        ],
                    },
                    id,
                };
            } catch (error) {
                context.log.error(`Planning tool error [${name}]: ${error.message}`);
                if (error && error.stack) {
                    context.log.error(`Planning tool error stack [${name}]: ${error.stack}`);
                }
                context.log.error(`Planning tool failed [${name}] after ${Date.now() - toolStart}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error: error.message,
                                    tool: name,
                                    note: 'An unexpected error occurred executing the planning tool.',
                                }, null, 2),
                            },
                        ],
                        isError: true,
                    },
                    id,
                };
            }
        }

        case 'ping':
            return { jsonrpc: '2.0', result: {}, id };

        default:
            return {
                jsonrpc: '2.0',
                error: { code: -32601, message: `Method not found: ${method}` },
                id,
            };
    }
}

function buildInstructions() {
    const sv = SERVER_INFO.schemaVersions || {};
    return `🏛️ GLOUCESTER CITY COUNCIL PLANNING ASSIST MCP SERVER

This MCP implements the Gloucester householder planning assessment pipeline (Plan v${SERVER_INFO.planVersion}).
All rules are derived from the Gloucester planning schemas:
  Facts: ${sv.facts || 'gloucester-householder-application-facts.v2.2'}
  Result: ${sv.result || 'gloucester-householder-assessment-result.v2.2'}
  Ruleset: ${sv.ruleset || 'gloucester-householder-policy-ruleset.v4.3'}
  Enums: ${sv.enums || 'gloucester-planning-enums.v1'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 TOOLS BY PHASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PHASE 0 — PlanX Ingestion (optional — for applications submitted via PlanX)
  planning_ingest_planx_schema         — Map PlanX application JSON → GCC facts (pass mapped_facts to Phase 1)

PHASE 1 — Foundation (Schema validation + route detection)
  planning_validate_application_facts  — Validate facts object structure and enum values
  planning_detect_case_route           — Detect submitted route and consent tracks

PHASE 2 — Validation (No recommendation)
  planning_list_applicable_modules     — Which modules apply and why
  planning_check_validation_requirements — Validation outcomes per requirement
  planning_explain_rule                — Explain any rule, requirement, or concept

PHASE 3 — Full pipeline
  planning_assess_planning_merits      — Run Policy A1 rules; merits status only
  planning_build_assessment_result     — FULL pipeline; SOLE recommendation authority

PHASE 4 — Reporting
  planning_build_report_payload        — Structured payload for AI-rendered reports

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ DESIGN PRINCIPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Deterministic logic — AI extracts facts; MCP validates, routes, and assesses.
2. planning_build_assessment_result is the SOLE source of recommendation. No other tool makes a recommendation.
3. In data_compromised state: validation is authoritative; merits are advisory only.
4. Route detection reports the submitted route. It cannot always confirm correctness.
5. No rule returns "pass" if prerequisite facts are absent → "cannot_assess".
6. Every outcome carries legal_basis, effect_type, threshold_status.

⚠️ ADVISORY: This server is Gloucester City Council specific. Rules and thresholds are derived from
Gloucester's adopted policies and local validation checklist. Do not apply to other councils without review.`;
}

// ─── HTTP trigger registration ────────────────────────────────────────────────
app.http('mcpPlanning', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'mcp-planning',
    handler: async (request, context) => {
        const requestStart = Date.now();
        context.log('MCP Planning request received');

        // Schema failed to load at startup — surface the error
        if (_moduleLoadError) {
            context.log.error('Planning MCP unavailable — schema load error:', _moduleLoadError.message);
            return {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: `Planning MCP unavailable: ${_moduleLoadError.message}`,
                    },
                    id: null,
                }),
            };
        }

        try {
            let body;
            try {
                body = await request.json();
            } catch (parseError) {
                context.log.error('Failed to parse request body:', parseError);
                if (parseError && parseError.stack) {
                    context.log.error('MCP Planning parse error stack:', parseError.stack);
                }
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        error: { code: -32700, message: 'Parse error: Invalid JSON' },
                        id: null,
                    }),
                };
            }

            const response = await handleMcpRequest(body, context);

            // Notifications return null — respond with 204
            if (response === null) {
                context.log(`MCP Planning request completed with 204 in ${Date.now() - requestStart}ms`);
                return { status: 204 };
            }

            context.log(`MCP Planning request completed with 200 in ${Date.now() - requestStart}ms`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
            };
        } catch (error) {
            context.log.error('MCP Planning unhandled error:', error);
            if (error && error.stack) {
                context.log.error('MCP Planning unhandled error stack:', error.stack);
            }
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: error.message },
                    id: null,
                }),
            };
        }
    },
});
