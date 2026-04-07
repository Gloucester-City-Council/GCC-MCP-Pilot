'use strict';

/**
 * MCP Web Compiler — POST /mcp-web-compiler
 *
 * Azure Functions v4 MCP JSON-RPC endpoint implementing a consolidated MCP
 * contract (mcp_api_contract_v6) with <= 10 tools:
 *
 *   discover_assets  — list templates/themes through a single API with filters
 *   process_site     — run validation/normalisation/render operations by mode
 *   manage_templates — validate/create/update/delete/get/list custom templates
 *   run_golden_tests — run built-in acceptance tests
 */

const { app }  = require('@azure/functions');
const compiler = require('../web-compiler/index');
const { loadContracts, loadContractsAsync } = require('../web-compiler/contracts/load-contracts');
const { validateAuthoring }   = require('../web-compiler/normaliser/normalise');
const { runAllGoldenTests }   = require('../web-compiler/testing/golden-test-runner');
const { listCustomTemplates, getTemplate, saveTemplate, deleteTemplate } = require('../web-compiler/storage/template-store');

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'discover_assets',
        description: 'Discover templates and/or themes from a single grouped endpoint.',
        inputSchema: {
            type: 'object',
            properties: {
                asset_type: {
                    type: 'string',
                    enum: ['templates', 'themes', 'all'],
                    description: 'Which assets to return. Defaults to "all".',
                },
            },
            required: [],
        },
    },
    {
        name: 'process_site',
        description: 'Unified site processing API. Select operation to validate, normalise, compile, preview, or build.',
        inputSchema: {
            type: 'object',
            required: ['operation'],
            properties: {
                operation: {
                    type: 'string',
                    enum: [
                        'validate_authoring',
                        'normalise',
                        'validate_definition',
                        'integrity',
                        'render_plan',
                        'preview_page',
                        'build_site',
                    ],
                    description: 'Pipeline operation to execute.',
                },
                authoring_payload: {
                    type: 'object',
                    description: 'The site authoring payload (schema_version: site_authoring_v1). Required for validate_authoring/normalise.',
                },
                site_definition: {
                    type: 'object',
                    description: 'A site_definition_v5 payload. Required for definition/integrity/render/preview/build operations.',
                },
                page_id: {
                    type: 'string',
                    description: 'Required when operation=preview_page.',
                },
            },
        },
    },
    {
        name: 'run_golden_tests',
        description: 'Run the built-in golden test suite. Returns pass/fail counts and per-test results.',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'manage_templates',
        description: 'Grouped template management API with action-based JSON routing.',
        inputSchema: {
            type: 'object',
            required: ['action'],
            properties: {
                action: {
                    type: 'string',
                    enum: ['validate', 'create', 'update', 'delete', 'get', 'list_custom'],
                    description: 'Template management action.',
                },
                template: {
                    type: 'object',
                    description: 'Required for validate/create/update actions.',
                },
                template_id: {
                    type: 'string',
                    description: 'Required for delete/get actions.',
                },
            },
        },
    },
];

const TOOL_NAMES = TOOLS.map(t => t.name).join(', ');

// ── Template validation ───────────────────────────────────────────────────────

const VALID_PAGE_TYPES = [
    'homepage', 'service_page', 'news_page', 'contact_page',
    'eligibility_or_apply_page', 'document_list_page', 'search_results_page',
];

const VALID_LAYOUTS = [
    'full_width', 'single_column', 'two_column', 'two_column_optional_aside',
    'grid_2', 'grid_3', 'stack',
];

const VALID_COMPONENTS = [
    'navigation', 'hero', 'service_card', 'page_header', 'breadcrumb',
    'content_body', 'contact_block', 'eligibility_panel', 'step_list',
    'alert_banner', 'document_list', 'search_results', 'footer',
];

/**
 * Structurally validate a template object.
 * Returns { valid: boolean, errors: string[] }
 */
function validateTemplateObject(tmpl) {
    const errors = [];

    if (!tmpl || typeof tmpl !== 'object') {
        return { valid: false, errors: ['template must be an object'] };
    }

    // id
    if (!tmpl.id) {
        errors.push('template.id is required');
    } else if (!/^[a-z0-9_-]+$/.test(tmpl.id)) {
        errors.push(`template.id "${tmpl.id}" must match ^[a-z0-9_-]+$`);
    }

    // page_type
    if (!tmpl.page_type) {
        errors.push('template.page_type is required');
    } else if (!VALID_PAGE_TYPES.includes(tmpl.page_type)) {
        errors.push(`template.page_type "${tmpl.page_type}" must be one of: ${VALID_PAGE_TYPES.join(', ')}`);
    }

    // regions
    if (!Array.isArray(tmpl.regions) || tmpl.regions.length === 0) {
        errors.push('template.regions must be a non-empty array');
    } else {
        const seenOrders = new Set();
        tmpl.regions.forEach((region, i) => {
            const prefix = `regions[${i}]`;
            if (!region.id)     errors.push(`${prefix}.id is required`);
            if (!region.order)  errors.push(`${prefix}.order is required`);
            else if (seenOrders.has(region.order)) errors.push(`${prefix}.order ${region.order} is duplicated`);
            else seenOrders.add(region.order);

            if (!region.layout) {
                errors.push(`${prefix}.layout is required`);
            } else if (!VALID_LAYOUTS.includes(region.layout)) {
                errors.push(`${prefix}.layout "${region.layout}" must be one of: ${VALID_LAYOUTS.join(', ')}`);
            }

            if (!Array.isArray(region.components) || region.components.length === 0) {
                errors.push(`${prefix}.components must be a non-empty array`);
            } else {
                region.components.forEach((comp, j) => {
                    if (!comp.component) {
                        errors.push(`${prefix}.components[${j}].component is required`);
                    } else if (!VALID_COMPONENTS.includes(comp.component)) {
                        errors.push(`${prefix}.components[${j}].component "${comp.component}" must be one of: ${VALID_COMPONENTS.join(', ')}`);
                    }
                });
            }
        });
    }

    // required_components
    if (!Array.isArray(tmpl.required_components)) {
        errors.push('template.required_components must be an array');
    }

    // content_mappings
    if (!Array.isArray(tmpl.content_mappings)) {
        errors.push('template.content_mappings must be an array');
    } else {
        tmpl.content_mappings.forEach((m, i) => {
            const prefix = `content_mappings[${i}]`;
            if (!m.source_field)      errors.push(`${prefix}.source_field is required`);
            if (!m.target_component)  errors.push(`${prefix}.target_component is required`);
            if (!m.target_slot)       errors.push(`${prefix}.target_slot is required`);
        });
    }

    return { valid: errors.length === 0, errors };
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleTool(name, args) {
    // Compile tools use the async loader so custom blob templates are included.
    // List/theme tools only need the base contracts and can remain synchronous.
    const contracts = loadContracts();

    switch (name) {

        case 'discover_assets': {
            const assetType = args.asset_type || 'all';
            const templates = (contracts.templateRegistry.templates || []).map(t => ({
                id:                  t.id,
                page_type:           t.page_type,
                required_components: t.required_components || [],
                region_count:        (t.regions || []).length,
            }));
            const { manifest, polish_profiles, tokens } = contracts.themePack;
            const themes = {
                theme_id:           manifest.theme_id,
                name:               manifest.name,
                category:           manifest.category,
                supported_polish_profiles: manifest.supported_polish_profiles,
                polish_profiles:    polish_profiles.map(p => ({
                    id:           p.id,
                    density:      p.density,
                    visual_tone:  p.visual_tone,
                    corner_style: p.corner_style,
                })),
                token_categories:   Object.keys(tokens || {}),
            };

            if (assetType === 'templates') {
                return { asset_type: assetType, templates, count: templates.length };
            }
            if (assetType === 'themes') {
                return { asset_type: assetType, themes };
            }
            if (assetType === 'all') {
                return { asset_type: assetType, templates, themes, template_count: templates.length };
            }
            return { ok: false, errors: [`Unsupported asset_type "${assetType}"`] };
        }

        case 'process_site': {
            const operation = args.operation;
            if (!operation) return { ok: false, errors: ['operation is required'] };

            if (operation === 'validate_authoring') {
                const payload = args.authoring_payload;
                if (!payload) return { valid: false, errors: ['authoring_payload is required'] };
                const { valid, errors } = validateAuthoring(payload);
                return { operation, valid, errors, error_count: errors.length };
            }

            if (operation === 'normalise') {
                const payload = args.authoring_payload;
                if (!payload) return { ok: false, errors: ['authoring_payload is required'] };
                const { validateAuthoring: va, normalise } = require('../web-compiler/normaliser/normalise');
                const check = va(payload);
                if (!check.valid) return { ok: false, errors: check.errors };
                const { siteDef, warnings } = normalise(payload);
                return { ok: true, operation, site_definition: siteDef, warnings };
            }

            const payload = args.site_definition;
            if (!payload) return { ok: false, errors: ['site_definition is required'] };
            const mergedContracts = await loadContractsAsync();

            if (operation === 'validate_definition' || operation === 'integrity') {
                const result = compiler.validateOnly(payload, mergedContracts);
                return {
                    ok:                result.ok,
                    operation,
                    errors:            result.errors,
                    warnings:          result.warnings,
                    validation_report: result.validationReport,
                };
            }

            if (operation === 'render_plan') {
                const result = compiler.buildRenderPlan(payload, mergedContracts);
                return {
                    ok:                result.ok,
                    operation,
                    errors:            result.errors,
                    warnings:          result.warnings,
                    render_plan:       result.renderPlan,
                    validation_report: result.validationReport,
                };
            }

            if (operation === 'preview_page') {
                const pageId = args.page_id;
                if (!pageId) return { ok: false, errors: ['page_id is required'] };

                const result = compiler.run(payload, mergedContracts);
                if (!result.ok) return { ok: false, operation, errors: result.errors, warnings: result.warnings };

                const htmlFile = (result.bundle.html || []).find(f =>
                    f.filename === `${pageId}.html` || (pageId === 'home' && f.filename === 'index.html')
                );

                if (!htmlFile) {
                    return {
                        ok: false,
                        operation,
                        errors: [`Page "${pageId}" not found in bundle. Available: ${result.bundle.html.map(f => f.filename).join(', ')}`],
                    };
                }

                return {
                    ok:       true,
                    operation,
                    page_id:  pageId,
                    filename: htmlFile.filename,
                    html:     htmlFile.content,
                    warnings: result.warnings,
                };
            }

            if (operation === 'build_site') {
                const result = compiler.run(payload, mergedContracts);
                if (!result.ok) {
                    return {
                        ok:      false,
                        operation,
                        stage:   result.stage,
                        errors:  result.errors,
                        warnings: result.warnings,
                    };
                }

                return {
                    ok:           true,
                    operation,
                    warnings:     result.warnings,
                    render_plan:  result.renderPlan,
                    bundle: {
                        html_files:    result.bundle.html,
                        css:           result.bundle.css,
                        js:            result.bundle.js,
                        asset_manifest: result.renderPlan.asset_manifest,
                    },
                    validation_report: result.validationReport,
                };
            }

            return { ok: false, errors: [`Unsupported process_site operation "${operation}"`] };
        }

        case 'run_golden_tests': {
            const testResults = runAllGoldenTests();
            return {
                passed:  testResults.passed,
                failed:  testResults.failed,
                total:   testResults.total,
                results: testResults.results,
            };
        }

        case 'manage_templates': {
            const action = args.action;
            if (!action) return { ok: false, errors: ['action is required'] };

            if (action === 'list_custom') {
                const templates = await listCustomTemplates();
                return { ok: true, action, templates, count: templates.length };
            }

            if (action === 'get') {
                const templateId = args.template_id;
                if (!templateId) return { ok: false, errors: ['template_id is required'] };
                const template = await getTemplate(templateId);
                if (!template) return { ok: false, action, errors: [`Template "${templateId}" not found`] };
                return { ok: true, action, template };
            }

            if (action === 'validate') {
                const tmpl = args.template;
                if (!tmpl) return { valid: false, errors: ['template is required'] };
                const { valid, errors } = validateTemplateObject(tmpl);
                return { action, valid, errors, error_count: errors.length };
            }

            if (action === 'create') {
                const tmpl = args.template;
                if (!tmpl) return { ok: false, errors: ['template is required'] };
                const { valid, errors } = validateTemplateObject(tmpl);
                if (!valid) return { ok: false, action, errors };

                const existing = await getTemplate(tmpl.id);
                if (existing) {
                    return {
                        ok: false,
                        action,
                        errors: [`Template "${tmpl.id}" already exists. Use action="update" to overwrite it.`],
                    };
                }

                await saveTemplate(tmpl);
                return { ok: true, action, template_id: tmpl.id, message: `Template "${tmpl.id}" created successfully.` };
            }

            if (action === 'update') {
                const tmpl = args.template;
                if (!tmpl) return { ok: false, errors: ['template is required'] };
                const { valid, errors } = validateTemplateObject(tmpl);
                if (!valid) return { ok: false, action, errors };

                const existing = await getTemplate(tmpl.id);
                if (!existing) {
                    return {
                        ok: false,
                        action,
                        errors: [`Template "${tmpl.id}" does not exist. Use action="create" to add a new template.`],
                    };
                }

                await saveTemplate(tmpl);
                return { ok: true, action, template_id: tmpl.id, message: `Template "${tmpl.id}" updated successfully.` };
            }

            if (action === 'delete') {
                const templateId = args.template_id;
                if (!templateId) return { ok: false, errors: ['template_id is required'] };

                // Prevent deletion of base/sample templates (they are not in blob)
                const existing = await getTemplate(templateId);
                if (!existing) {
                    return {
                        ok: false,
                        action,
                        errors: [`Template "${templateId}" not found in custom template store. Base templates cannot be deleted.`],
                    };
                }

                await deleteTemplate(templateId);
                return { ok: true, action, template_id: templateId, message: `Template "${templateId}" deleted successfully.` };
            }

            return { ok: false, errors: [`Unsupported manage_templates action "${action}"`] };
        }

        default:
            throw new Error(`Unknown tool: ${name}. Available: ${TOOL_NAMES}`);
    }
}

// ── MCP JSON-RPC handler ──────────────────────────────────────────────────────

async function handleMcpRequest(body, context) {
    if (!body || typeof body !== 'object') {
        return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null };
    }

    const { jsonrpc, method, params, id } = body;
    if (jsonrpc !== '2.0') {
        return { jsonrpc: '2.0', error: { code: -32600, message: 'jsonrpc must be "2.0"' }, id: null };
    }

    context.log(`[mcpWebCompiler] method: ${method}`);

    switch (method) {

        case 'initialize':
            return {
                jsonrpc: '2.0',
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: { tools: {} },
                    serverInfo: {
                        name:    'gcc-web-compiler-mcp',
                        version: '1.0.0',
                        description: 'Deterministic web compiler — compiles typed site definitions into HTML/CSS/JS bundles',
                        instructions: `WEB COMPILER MCP — gcc-web-compiler-mcp

Compiles a site_definition_v5 (content + design schema) into finished HTML/CSS/JS.
No LLM at render time — fully deterministic, schema-driven pipeline.

QUICK START:
1. discover_assets  — inspect templates/themes from one grouped tool
2. process_site     — choose operation (validate/normalise/render/build)
3. manage_templates — validate/create/update/delete custom templates

VALIDATION TOOLS:
- process_site(operation="validate_authoring")   — check authoring payload
- process_site(operation="normalise")            — authoring → runtime definition
- process_site(operation="integrity")            — cross-reference registries
- process_site(operation="render_plan")          — compile intermediate plan

PIPELINE: validate → normalise → integrity check → template resolve →
          theme resolve → HTML sanitise → token resolve → render plan →
          lint → emit HTML/CSS/JS

process_site accepts either authoring_payload or site_definition depending on operation.
run_golden_tests runs the built-in acceptance test suite.`,
                        schema_bundle: 'site_builder_schema_v5_clean',
                    },
                },
                id,
            };

        case 'notifications/initialized':
            return null;

        case 'tools/list':
            return { jsonrpc: '2.0', result: { tools: TOOLS }, id };

        case 'tools/call': {
            const { name, arguments: toolArgs } = params || {};
            if (!name) {
                return { jsonrpc: '2.0', error: { code: -32602, message: 'tool name is required' }, id };
            }
            const knownTool = TOOLS.find(t => t.name === name);
            if (!knownTool) {
                return { jsonrpc: '2.0', error: { code: -32602, message: `Unknown tool: ${name}. Available: ${TOOL_NAMES}` }, id };
            }

            const start = Date.now();
            try {
                const result = await handleTool(name, toolArgs || {});
                context.log(`[mcpWebCompiler] tool ${name} completed in ${Date.now() - start}ms`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                    },
                    id,
                };
            } catch (err) {
                context.log.error(`[mcpWebCompiler] tool ${name} error: ${err.message}`);
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [{ type: 'text', text: JSON.stringify({ error: err.message, tool: name }) }],
                        isError: true,
                    },
                    id,
                };
            }
        }

        case 'ping':
            return { jsonrpc: '2.0', result: {}, id };

        default:
            return { jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id };
    }
}

// ── Azure Function registration ───────────────────────────────────────────────

app.http('mcpWebCompiler', {
    methods:   ['POST'],
    authLevel: 'anonymous',
    route:     'mcp-web-compiler',
    handler: async (request, context) => {
        context.log('[mcpWebCompiler] request received');
        const start = Date.now();

        let body;
        try {
            body = await request.json();
        } catch (err) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null }),
            };
        }

        const response = await handleMcpRequest(body, context);
        if (response === null) {
            return { status: 204 };
        }

        context.log(`[mcpWebCompiler] completed in ${Date.now() - start}ms`);
        return {
            status:  200,
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(response),
        };
    },
});
