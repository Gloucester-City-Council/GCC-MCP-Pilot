/**
 * PipelineOrchestrator
 *
 * Coordinates all pipeline steps for build_assessment_result.
 * Per plan Section 6, the pipeline is:
 *   1. Intake / raw facts
 *   2. Schema validation
 *   3. Data quality (FactsNormaliser)
 *   4. Route/scope (ScopeEngine)
 *   5. Validation (ValidationEngine)
 *   6. Policy merits (PolicyEngine)
 *   7. Assembly (ResultAssembler)
 *   8. Diagnostics
 *
 * Returns: { result, diagnostics, processingState }
 */

'use strict';

const { normalise }     = require('./facts-normaliser');
const { detectScope }   = require('./scope-engine');
const { runValidation } = require('./validation-engine');
const { assessMerits }  = require('./policy-engine');
const { assemble }      = require('./result-assembler');
const { SCHEMA_VERSIONS, MATERIAL_RULES_REGISTER, MATERIAL_RULES_REGISTER_VERSION } = require('../schema-loader');

/**
 * Run the full assessment pipeline.
 *
 * @param {object} rawFacts   Raw or pre-normalised facts object
 * @param {string} mode       strict|advisory|pre_application (default: strict)
 * @returns {{ result, diagnostics, processingState }}
 */
function run(rawFacts, mode) {
    const startTime = Date.now();
    mode = mode || 'strict';
    const stepsExecuted = [];
    const gatingDecisions = [];

    // ── Step 1: Schema validation (basic structural check) ───────────────────
    stepsExecuted.push('schema_validation');
    const schemaValidationResult = validateSchema(rawFacts);
    if (!schemaValidationResult.valid) {
        const diagnostics = buildDiagnostics({
            processingState: 'schema_invalid',
            stepsExecuted,
            gatingDecisions: [{ step: 'schema_validation', decision: 'halted', reason: schemaValidationResult.reason }],
            versions: SCHEMA_VERSIONS,
            materialRulesRegisterVersion: MATERIAL_RULES_REGISTER_VERSION,
            durationMs: Date.now() - startTime,
        });
        // Return a minimal result with the schema error
        return {
            processingState: 'schema_invalid',
            result: buildSchemaInvalidResult(rawFacts, schemaValidationResult.reason),
            diagnostics,
        };
    }
    gatingDecisions.push({ step: 'schema_validation', decision: 'passed' });

    // ── Step 2: Data quality / normalisation ─────────────────────────────────
    stepsExecuted.push('facts_normalisation');
    const { canonicalFacts, dataQualityIssues, dataQualityStatus, isLawfulUseRouteBlocked } =
        normalise(rawFacts);
    const dataQuality = { dataQualityIssues, dataQualityStatus, isLawfulUseRouteBlocked };

    // ── Step 3: Determine processing state ───────────────────────────────────
    let processingState;
    if (dataQualityStatus === 'conflicted') {
        processingState = 'data_compromised';
        gatingDecisions.push({ step: 'data_quality', decision: 'data_compromised', reason: 'Conflicting or blocked data quality.' });
    } else {
        processingState = 'partial_assessment'; // will be upgraded after merits
        gatingDecisions.push({ step: 'data_quality', decision: 'passed', status: dataQualityStatus });
    }

    // ── Step 4: Scope detection ───────────────────────────────────────────────
    stepsExecuted.push('scope_detection');
    const scope = detectScope(canonicalFacts, dataQuality);
    gatingDecisions.push({ step: 'scope_detection', decision: 'completed', route: scope.route });

    // ── Step 5: Validation ────────────────────────────────────────────────────
    stepsExecuted.push('validation');
    const validation = runValidation(canonicalFacts, scope, mode);

    // Gate merits on validation in strict mode
    if (mode === 'strict' && validation.validationStatus === 'invalid') {
        processingState = 'validation_blocked';
        gatingDecisions.push({ step: 'validation', decision: 'merits_gated', reason: 'Validation invalid in strict mode.' });

        const result = assemble({
            facts: canonicalFacts, dataQuality, scope, validation,
            merits: { meritsStatus: 'not_run', ruleOutcomes: [], manualReviewFlags: [], isAdvisory: false },
            mode, processingState,
        });
        const diagnostics = buildDiagnostics({ processingState, stepsExecuted, gatingDecisions, versions: SCHEMA_VERSIONS, materialRulesRegisterVersion: MATERIAL_RULES_REGISTER_VERSION, durationMs: Date.now() - startTime });
        return { processingState, result, diagnostics };
    }

    gatingDecisions.push({ step: 'validation', decision: 'completed', status: validation.validationStatus });

    // ── Step 6: Policy merits ─────────────────────────────────────────────────
    stepsExecuted.push('policy_merits');
    const merits = assessMerits(canonicalFacts, scope, dataQuality, mode);
    gatingDecisions.push({ step: 'policy_merits', decision: 'completed', status: merits.meritsStatus });

    // Upgrade processing state based on merits
    if (merits.meritsStatus === 'not_run') {
        // Stays partial or data_compromised
    } else if (merits.ruleOutcomes.some(r => r.status === 'cannot_assess')) {
        if (processingState !== 'data_compromised') processingState = 'partial_assessment';
    } else if (processingState !== 'data_compromised') {
        processingState = 'full_assessment';
    }

    // ── Step 7: Assembly ──────────────────────────────────────────────────────
    stepsExecuted.push('result_assembly');
    const result = assemble({ facts: canonicalFacts, dataQuality, scope, validation, merits, mode, processingState });

    const diagnostics = buildDiagnostics({
        processingState,
        stepsExecuted,
        gatingDecisions,
        versions: SCHEMA_VERSIONS,
        materialRulesRegisterVersion: MATERIAL_RULES_REGISTER_VERSION,
        materialRulesApplied: MATERIAL_RULES_REGISTER,
        durationMs: Date.now() - startTime,
    });

    return { processingState, result, diagnostics };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Basic structural schema validation.
 * Checks that the required top-level fields are present.
 */
function validateSchema(facts) {
    if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
        return { valid: false, reason: 'Facts must be a JSON object.' };
    }
    const required = ['application', 'site', 'proposal'];
    const missing = required.filter(f => !facts[f] || typeof facts[f] !== 'object');
    if (missing.length > 0) {
        return { valid: false, reason: `Required top-level sections missing: ${missing.join(', ')}.` };
    }
    return { valid: true };
}

function buildSchemaInvalidResult(rawFacts, reason) {
    const caseRef = (rawFacts && rawFacts.application && rawFacts.application.application_reference)
        || 'UNREF-SCHEMA-INVALID';
    return {
        case_reference: caseRef,
        address: '',
        assessment_date: new Date().toISOString().split('T')[0],
        scope: { application_route: 'unknown', modules_considered: [], modules_applied: [], modules_skipped: [] },
        data_quality: { status: 'insufficient', issues: [{ code: 'schema_invalid', message: reason, severity: 'blocking' }] },
        validation: { status: 'not_run', requirements: [], blocking_issues: [reason] },
        planning_merits: { status: 'not_run', rule_outcomes: [], manual_review_flags: [] },
        consultations: { consultees: [] },
        cil_screening: { status: 'not_assessed' },
        recommendation: { decision_mode: 'invalid', confidence: 'high', reason_summary: [reason] },
    };
}

function buildDiagnostics({ processingState, stepsExecuted, gatingDecisions, versions, materialRulesRegisterVersion, materialRulesApplied, durationMs }) {
    return {
        processing_state: processingState,
        pipeline_steps_executed: stepsExecuted,
        gating_decisions: gatingDecisions,
        versions_used: versions,
        material_rules_register: {
            version: materialRulesRegisterVersion,
            rules: materialRulesApplied || [],
        },
        timing_ms: durationMs,
        generated_at: new Date().toISOString(),
    };
}

module.exports = { run };
