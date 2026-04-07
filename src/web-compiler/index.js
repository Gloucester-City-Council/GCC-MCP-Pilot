'use strict';

/**
 * Web Compiler pipeline orchestrator.
 *
 * Executes the 14-step deterministic pipeline defined in api_implementation_brief.md.
 * Blocking failures at any step halt the pipeline and return structured errors.
 *
 * Step summary:
 *   1.  validateAuthoring        — structural check of authoring input
 *   2.  normalise                — authoring → site_definition_v5
 *   3.  validateRuntimeDef       — required fields present on runtime definition
 *   4.  runIntegrityChecks       — cross-ref validation across all registries
 *   5.  resolveConditionsAndTransforms (verified during compile)
 *   6-7. resolveTemplates        — per-page template lookup + page_type match
 *   8.  resolveComponents        — verified during compile
 *   9.  resolveTheme             — theme_id + polish_profile_id lookup
 *   10. sanitiseHtml             — html-policy enforcement on all html fields
 *   11. resolveTokenPaths        — verified during compile
 *   12. compileRenderPlan        — typed intermediate render plan
 *   13. (linting embedded in step 12)
 *   14. emitBundle               — HTML/CSS/JS files
 */

const { loadContractsWith }        = require('./contracts/load-contracts');
const { validateAuthoring, normalise } = require('./normaliser/normalise');
const { runIntegrityChecks }       = require('./integrity/integrity-checker');
const { resolveTheme }             = require('./resolver/theme-resolver');
const { resolveTemplate }          = require('./resolver/template-resolver');
const { sanitiseSiteDefinition }   = require('./sanitiser/html-sanitiser');
const { compileRenderPlan }        = require('./compiler/render-plan-compiler');
const { emitHtml }                 = require('./emitter/html-emitter');
const { emitCss }                  = require('./emitter/css-emitter');
const { emitJs }                   = require('./emitter/js-emitter');

/**
 * Run the full pipeline.
 *
 * @param {object} input       Site authoring or site definition payload
 * @param {object} [overrides] Optional registry overrides (for testing / custom registries)
 * @returns {{
 *   ok: boolean,
 *   stage: string,
 *   errors: string[],
 *   warnings: string[],
 *   renderPlan?: object,
 *   bundle?: { html: Array, css: string, js: string },
 *   validationReport: object
 * }}
 */
function run(input, overrides = {}) {
    const startTime = Date.now();
    const warnings = [];
    const contracts = loadContractsWith(overrides);

    // ── Step 1: Validate authoring input ────────────────────────────────────
    const authoingValidation = validateAuthoring(input);
    if (!authoingValidation.valid && input && input.schema_version !== 'site_definition_v5') {
        return failure('validate_authoring_input', authoingValidation.errors, warnings, startTime);
    }

    // ── Step 2: Normalise to runtime site definition ─────────────────────────
    let siteDef, normaliseWarnings;
    try {
        ({ siteDef, warnings: normaliseWarnings } = normalise(input, contracts.templateRegistry));
        warnings.push(...normaliseWarnings);
    } catch (err) {
        return failure('normalise', [err.message], warnings, startTime);
    }

    // ── Step 3: Validate runtime site definition ─────────────────────────────
    const runtimeErrors = validateRuntimeDef(siteDef);
    if (runtimeErrors.length > 0) {
        return failure('validate_site_definition', runtimeErrors, warnings, startTime);
    }

    // ── Step 4: Integrity checks ──────────────────────────────────────────────
    const integrity = runIntegrityChecks(siteDef, contracts);
    warnings.push(...integrity.warnings);
    if (!integrity.passed) {
        // Prepend error_code "integrity_check_failed" so golden tests and callers can match it
        const integrityErrors = [`integrity_check_failed`, ...integrity.errors];
        return failure('run_integrity_checks', integrityErrors, warnings, startTime, { error_code: 'integrity_check_failed' });
    }

    // ── Steps 5–7: Template resolution check (per-page) ───────────────────────
    for (const page of siteDef.pages) {
        try {
            resolveTemplate(page, contracts.templateRegistry);
        } catch (err) {
            return failure('resolve_templates', [err.message], warnings, startTime, { error_code: err.code });
        }
    }

    // ── Step 9: Resolve theme + polish profile ───────────────────────────────
    let themeResolution;
    try {
        themeResolution = resolveTheme(siteDef, contracts.themePack);
    } catch (err) {
        return failure('resolve_theme', [err.message], warnings, startTime, { error_code: err.code });
    }

    // ── Step 10: Sanitise all HTML fields ────────────────────────────────────
    const { errors: sanitiseErrors } = sanitiseSiteDefinition(siteDef, contracts.htmlPolicy);
    if (sanitiseErrors.length > 0) {
        return failure('sanitise_html_fields', sanitiseErrors, warnings, startTime, { error_code: 'html_sanitisation_failed' });
    }

    // ── Steps 11–13: Compile render plan (resolves tokens + a11y lint) ────────
    let renderPlan;
    try {
        renderPlan = compileRenderPlan(siteDef, contracts, themeResolution);
    } catch (err) {
        const code = err.code || 'compile_render_plan';
        return failure('compile_render_plan', [err.message], warnings, startTime, { error_code: code });
    }

    // ── Step 14: Emit bundle ─────────────────────────────────────────────────
    const htmlFiles = emitHtml(renderPlan);
    const cssContent = emitCss(renderPlan, themeResolution.tokens);
    const jsContent  = emitJs(renderPlan.behaviour_manifest);

    const bundle = {
        html: htmlFiles,
        css:  cssContent,
        js:   jsContent,
    };

    return {
        ok: true,
        stage: 'complete',
        errors: [],
        warnings,
        renderPlan,
        bundle,
        validationReport: buildValidationReport(siteDef, integrity, warnings, startTime),
    };
}

/**
 * Run only up to and including the render plan compile step (no emit).
 */
function buildRenderPlan(input, overrides = {}) {
    const result = run(input, overrides);
    if (!result.ok) return result;
    return {
        ok: true,
        stage: 'build_render_plan',
        errors: [],
        warnings: result.warnings,
        renderPlan: result.renderPlan,
        validationReport: result.validationReport,
    };
}

/**
 * Run only integrity checks and return the validation report.
 */
function validateOnly(input, overrides = {}) {
    const startTime = Date.now();
    const warnings = [];
    const contracts = loadContractsWith(overrides);

    const authoingValidation = validateAuthoring(input);
    if (!authoingValidation.valid && input && input.schema_version !== 'site_definition_v5') {
        return failure('validate_authoring_input', authoingValidation.errors, warnings, startTime);
    }

    let siteDef, normaliseWarnings;
    try {
        ({ siteDef, warnings: normaliseWarnings } = normalise(input, contracts.templateRegistry));
        warnings.push(...normaliseWarnings);
    } catch (err) {
        return failure('normalise', [err.message], warnings, startTime);
    }

    const runtimeErrors = validateRuntimeDef(siteDef);
    if (runtimeErrors.length > 0) {
        return failure('validate_site_definition', runtimeErrors, warnings, startTime);
    }

    const integrity = runIntegrityChecks(siteDef, contracts);
    warnings.push(...integrity.warnings);
    const integrityErrors = integrity.passed ? integrity.errors : [`integrity_check_failed`, ...integrity.errors];

    return {
        ok: integrity.passed,
        stage: 'run_integrity_checks',
        errors: integrityErrors,
        warnings,
        validationReport: buildValidationReport(siteDef, integrity, warnings, startTime),
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validateRuntimeDef(siteDef) {
    const errors = [];
    if (!siteDef || siteDef.schema_version !== 'site_definition_v5') {
        errors.push('schema_version must be "site_definition_v5"');
    }
    if (!siteDef || !siteDef.site) errors.push('site object is required');
    else {
        if (!siteDef.site.id)               errors.push('site.id is required');
        if (!siteDef.site.name)             errors.push('site.name is required');
        if (!siteDef.site.theme_id)         errors.push('site.theme_id is required');
        if (!siteDef.site.polish_profile_id) errors.push('site.polish_profile_id is required');
    }
    if (!siteDef || !Array.isArray(siteDef.pages) || siteDef.pages.length === 0) {
        errors.push('pages array is required and must contain at least one page');
    } else {
        siteDef.pages.forEach((p, i) => {
            if (!p.id)          errors.push(`pages[${i}].id is required`);
            if (!p.slug)        errors.push(`pages[${i}].slug is required`);
            if (!p.page_type)   errors.push(`pages[${i}].page_type is required`);
            if (!p.template_id) errors.push(`pages[${i}].template_id is required`);
        });
    }
    return errors;
}

function failure(stage, errors, warnings, startTime, extra = {}) {
    return {
        ok: false,
        stage,
        errors,
        warnings,
        renderPlan: null,
        bundle: null,
        validationReport: {
            stage,
            passed: false,
            errors,
            warnings,
            duration_ms: Date.now() - startTime,
            ...extra,
        },
    };
}

function buildValidationReport(siteDef, integrity, warnings, startTime) {
    return {
        passed: integrity.passed,
        site_id: siteDef && siteDef.site && siteDef.site.id,
        page_count: siteDef && siteDef.pages ? siteDef.pages.length : 0,
        errors: integrity.errors,
        warnings,
        duration_ms: Date.now() - startTime,
    };
}

module.exports = { run, buildRenderPlan, validateOnly };
