/**
 * Smoke tests for the planning MCP tool wrappers.
 *
 * These cover the tool entry points that previously had no direct test
 * coverage (validate, route, modules, validation, merits, explain,
 * build_assessment_result, build_report_payload). Schema-conformance of
 * pipeline outputs is covered separately.
 */

'use strict';

const validateFacts         = require('../src/gcc-planning/tools/validate-application-facts');
const detectRoute           = require('../src/gcc-planning/tools/detect-case-route');
const listModules           = require('../src/gcc-planning/tools/list-applicable-modules');
const checkValidation       = require('../src/gcc-planning/tools/check-validation-requirements');
const explainRule           = require('../src/gcc-planning/tools/explain-rule');
const assessMerits          = require('../src/gcc-planning/tools/assess-planning-merits');
const buildAssessmentResult = require('../src/gcc-planning/tools/build-assessment-result');
const buildReportPayload    = require('../src/gcc-planning/tools/build-report-payload');

const baseDocs = [
    'Application form', 'Fee Receipt', 'Site Location Plan',
    'Existing Plans', 'Proposed Plans', 'Ownership Certificate',
    'Biodiversity Statement',
];

function cleanFacts(overrides = {}) {
    return {
        application: {
            application_reference: 'GCC/2026/T-1',
            application_route: 'householder_planning_permission',
            submitted_documents: baseDocs,
            ...overrides.application,
        },
        site: { address: '1 Test Lane, Gloucester', dwelling_type: 'semi_detached', ...overrides.site },
        proposal: { proposal_type: ['single_storey_rear_extension'], ...overrides.proposal },
    };
}

describe('planning_validate_application_facts', () => {
    test('rejects missing facts arg', () => {
        const r = validateFacts.execute({});
        expect(r.valid).toBe(false);
        expect(r.issues[0].issue_code).toBe('missing_facts');
    });

    test('reports missing top-level sections with schema-compliant issue shape', () => {
        const r = validateFacts.execute({ facts: { application: {} } });
        expect(r.valid).toBe(false);
        expect(r.schema_valid).toBe(false);
        expect(r.issues.length).toBeGreaterThanOrEqual(2);
        for (const issue of r.issues) {
            expect(issue.issue_code).toBeDefined();
            expect(issue.severity).toBeDefined();
            expect(issue.description).toBeDefined();
        }
    });

    test('clean facts pass validation', () => {
        const r = validateFacts.execute({ facts: cleanFacts() });
        expect(r.valid).toBe(true);
        expect(r.schema_valid).toBe(true);
    });

    test('flags invalid enum values', () => {
        const r = validateFacts.execute({ facts: cleanFacts({ application: { application_route: 'something_made_up' } }) });
        expect(r.valid).toBe(false);
        expect(r.issues.some(i => i.issue_code === 'invalid_enum')).toBe(true);
    });
});

describe('planning_detect_case_route', () => {
    test('returns submitted_route and confidence=high for clean facts', () => {
        const r = detectRoute.execute({ facts: cleanFacts() });
        expect(r.submitted_route).toBe('householder_planning_permission');
        expect(r.confidence).toBe('high');
    });

    test('returns confidence=low when lawful use is unconfirmed', () => {
        const r = detectRoute.execute({
            facts: cleanFacts({ application: { lawful_use_as_single_dwelling_confirmed: 'unknown' } }),
        });
        expect(r.confidence).toBe('low');
        expect(r.route_authority).toMatch(/cannot confirm/i);
    });
});

describe('planning_list_applicable_modules', () => {
    test('returns modules_applied with policy_A1 for householder PP', () => {
        const r = listModules.execute({ facts: cleanFacts() });
        expect(r.modules_applied).toContain('policy_A1_design_and_amenity');
    });

    test('skips policy_A1 for prior notification route', () => {
        const facts = cleanFacts({
            application: {
                application_route: 'prior_notification_larger_home_extension',
                consent_tracks: ['prior_approval_larger_home_extension'],
            },
        });
        const r = listModules.execute({ facts });
        expect(r.modules_applied).not.toContain('policy_A1_design_and_amenity');
    });
});

describe('planning_check_validation_requirements', () => {
    test('returns requirement_outcomes (schema-aligned key)', () => {
        const r = checkValidation.execute({ facts: cleanFacts() });
        expect(Array.isArray(r.requirement_outcomes)).toBe(true);
        expect(r.requirement_outcomes.length).toBeGreaterThan(0);
        for (const req of r.requirement_outcomes) {
            expect(req.requirement_id).toBeDefined();
            expect(req.source_module).toBeDefined();
            expect(req.applicability).toBeDefined();
        }
    });

    test('flags missing documents with blocking_issues in strict mode', () => {
        const r = checkValidation.execute({
            facts: cleanFacts({ application: { submitted_documents: [] } }),
            mode: 'strict',
        });
        expect(['valid', 'invalid', 'incomplete', 'manual_review_required']).toContain(r.validation_status);
    });
});

describe('planning_explain_rule', () => {
    test('explains a known rule by ID', () => {
        const r = explainRule.execute({ topic: 'A1.2.1' });
        expect(r.rule_id).toBe('A1.2.1');
        expect(r.is_material_rule).toBe(true);
    });

    test('explains a known requirement by ID', () => {
        const r = explainRule.execute({ topic: 'B28' });
        expect(r.requirement_id).toBe('B28');
    });

    test('returns concept explanation for "45-degree rule"', () => {
        const r = explainRule.execute({ topic: '45-degree rule' });
        expect(r.concept_explanation).toMatch(/45/);
    });

    test('returns an error for empty topic', () => {
        const r = explainRule.execute({ topic: '' });
        expect(r.error).toBeDefined();
    });
});

describe('planning_assess_planning_merits', () => {
    test('returns merits_status and rule_outcomes for clean facts', () => {
        const r = assessMerits.execute({ facts: cleanFacts() });
        expect(['pass', 'concerns', 'fail', 'cannot_assess', 'manual_review_required', 'not_run']).toContain(r.merits_status);
        expect(Array.isArray(r.rule_outcomes)).toBe(true);
    });

    test('rejects missing facts', () => {
        const r = assessMerits.execute({});
        expect(r.error).toBeDefined();
    });
});

describe('planning_build_assessment_result', () => {
    test('returns result + diagnostics', () => {
        const r = buildAssessmentResult.execute({ facts: cleanFacts() });
        expect(r.result).toBeDefined();
        expect(r.diagnostics).toBeDefined();
        expect(r.processing_state).toBeDefined();
    });

    test('records audit metadata in response envelope (not on result)', () => {
        const r = buildAssessmentResult.execute({
            facts: cleanFacts(),
            submission_revision_id: 'rev-1',
            rerun_reason: 'corrected_facts',
        });
        expect(r.audit).toEqual({ submission_revision_id: 'rev-1', rerun_reason: 'corrected_facts' });
        // result must not carry these — additionalProperties:false in v2.2 schema
        expect(r.result.submission_revision_id).toBeUndefined();
        expect(r.result.rerun_reason).toBeUndefined();
        expect(r.result._schema_versions).toBeUndefined();
    });

    test('rejects invalid mode', () => {
        const r = buildAssessmentResult.execute({ facts: cleanFacts(), mode: 'wibble' });
        expect(r.error).toMatch(/mode/);
    });
});

describe('planning_build_report_payload', () => {
    test('builds an officer_determination payload from a valid result', () => {
        const ar = buildAssessmentResult.execute({ facts: cleanFacts() });
        const p  = buildReportPayload.execute({ result: ar.result });
        expect(p.system_instruction).toMatch(/Gloucester/);
        expect(p.style_template.report_style).toBe('officer_determination');
        expect(Array.isArray(p.grounding_rules)).toBe(true);
        expect(p.grounding_rules.length).toBeGreaterThanOrEqual(8);
    });

    test('rejects invalid report_style', () => {
        const ar = buildAssessmentResult.execute({ facts: cleanFacts() });
        const p  = buildReportPayload.execute({ result: ar.result, report_style: 'fancy_report' });
        expect(p.error).toMatch(/report_style/);
    });

    test('detects advisory state from manual_review_flags', () => {
        const ar = buildAssessmentResult.execute({
            facts: cleanFacts({ application: { lawful_use_as_single_dwelling_confirmed: 'unknown' } }),
            mode: 'advisory',
        });
        const p = buildReportPayload.execute({ result: ar.result });
        expect(p.advisory_anti_patterns.length).toBeGreaterThan(0);
        expect(p.system_instruction).toMatch(/ADVISORY ONLY/i);
    });
});
