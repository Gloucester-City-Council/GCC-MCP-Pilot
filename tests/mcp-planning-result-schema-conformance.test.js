/**
 * Schema-conformance tests for the planning MCP pipeline output.
 *
 * The result returned by `pipeline-orchestrator.run()` must conform to
 * gloucester-householder-assessment-result.v2.2.schema.json. The previous
 * tests only checked individual fields; this suite compiles the schema
 * with ajv and validates real pipeline outputs across the major scenarios.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const Ajv  = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { run } = require('../src/gcc-planning/pipeline/pipeline-orchestrator');

const SCHEMA_DIR = path.resolve(__dirname, '../schemas/planning');
const factsSchema  = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'gloucester-householder-application-facts.v2.2.schema.json'), 'utf8'));
const resultSchema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'gloucester-householder-assessment-result.v2.2.schema.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(factsSchema);
const validateResult = ajv.compile(resultSchema);

function mustConform(result, label) {
    const ok = validateResult(result);
    if (!ok) {
        const summary = (validateResult.errors || []).map(e => `${e.instancePath || '/'} ${e.message}`).join('\n');
        throw new Error(`${label} did not conform to result schema v2.2:\n${summary}`);
    }
    return ok;
}

const baseDocs = [
    'Application form', 'Fee Receipt', 'Site Location Plan',
    'Existing Plans', 'Proposed Plans', 'Ownership Certificate',
    'Biodiversity Statement',
];

describe('pipeline result conforms to assessment-result v2.2 schema', () => {
    test('clean householder PP application produces a valid result', () => {
        const facts = {
            application: {
                application_reference: 'GCC/2026/CLEAN-1',
                application_route: 'householder_planning_permission',
                submitted_documents: baseDocs,
            },
            site: {
                address: '1 High St, Gloucester GL1 1AA',
                dwelling_type: 'semi_detached',
                conservation_area: false,
                flood_zone: '1',
            },
            proposal: {
                proposal_type: ['single_storey_rear_extension'],
                extension_depth_from_existing_rear_wall_mm: 3000,
                gross_internal_area_sqm: 28,
            },
        };
        const { result } = run(facts, 'strict');
        expect(mustConform(result, 'clean householder PP')).toBe(true);
    });

    test('schema-invalid input produces a valid result', () => {
        const { result, processingState } = run({}, 'strict');
        expect(processingState).toBe('schema_invalid');
        expect(mustConform(result, 'schema_invalid result')).toBe(true);
    });

    test('data-compromised case (lawful use unconfirmed) produces a valid result', () => {
        const facts = {
            application: {
                application_reference: 'GCC/2026/DC-1',
                application_route: 'householder_planning_permission',
                lawful_use_as_single_dwelling_confirmed: 'no',
                submitted_documents: baseDocs,
            },
            site: { address: '12 Mixed Use Way', dwelling_type: 'semi_detached' },
            proposal: { proposal_type: ['single_storey_rear_extension'] },
        };
        const { result, processingState } = run(facts, 'advisory');
        expect(processingState).toBe('data_compromised');
        expect(mustConform(result, 'data-compromised result')).toBe(true);
        // Advisory caveat must propagate via manual_review_flags (schema does
        // not allow a free-form advisory_only flag on planning_merits).
        expect(result.planning_merits.manual_review_flags.some(f => f.startsWith('ADVISORY_ONLY:'))).toBe(true);
    });

    test('prior notification route produces a valid result with cil.applicability=not_run', () => {
        const facts = {
            application: {
                application_reference: 'GCC/2026/PN-1',
                application_route: 'prior_notification_larger_home_extension',
                submitted_documents: ['application form', 'site location plan'],
            },
            site: { address: '5 Long Garden Rd', dwelling_type: 'detached' },
            proposal: {
                proposal_type: ['single_storey_rear_extension'],
                extension_depth_from_existing_rear_wall_mm: 5500,
            },
        };
        const { result } = run(facts, 'strict');
        expect(mustConform(result, 'prior notification result')).toBe(true);
        expect(result.cil.applicability).toBe('not_run');
        expect(result.consultations.status).toBe('not_run');
    });

    test('conservation area triggers heritage consultation and produces a valid result', () => {
        const facts = {
            application: {
                application_reference: 'GCC/2026/CA-1',
                application_route: 'householder_planning_permission',
                submitted_documents: [...baseDocs, 'Design and Access Statement', 'Heritage Statement'],
            },
            site: {
                address: '12 Westgate St, Gloucester GL1 2NQ',
                dwelling_type: 'terrace',
                conservation_area: true,
            },
            proposal: {
                proposal_type: ['single_storey_rear_extension'],
                extension_depth_from_existing_rear_wall_mm: 3000,
                gross_internal_area_sqm: 25,
            },
        };
        const { result } = run(facts, 'strict');
        expect(mustConform(result, 'conservation area result')).toBe(true);
        expect(result.consultations.items.some(c => /Conservation Officer/i.test(c.consultee))).toBe(true);
    });

    test('validation requirement_outcomes carry source_module and applicability', () => {
        const facts = {
            application: {
                application_reference: 'GCC/2026/REQ-1',
                application_route: 'householder_planning_permission',
                submitted_documents: baseDocs,
            },
            site: { address: '1 Test Way', dwelling_type: 'detached' },
            proposal: { proposal_type: ['single_storey_rear_extension'] },
        };
        const { result } = run(facts, 'strict');
        for (const req of result.validation.requirement_outcomes) {
            expect(req.source_module).toBeDefined();
            expect(req.applicability).toMatch(/applies|does_not_apply|uncertain_manual_review/);
        }
    });

    test('rule_outcomes carry threshold_status and applicability', () => {
        const facts = {
            application: {
                application_reference: 'GCC/2026/RULE-1',
                application_route: 'householder_planning_permission',
                submitted_documents: baseDocs,
            },
            site: { address: '1 Test Way', dwelling_type: 'semi_detached' },
            proposal: {
                proposal_type: ['two_storey_side_extension'],
                extension_ridge_height_mm: 7500,
                existing_ridge_height_mm: 8000,
                setback_from_front_building_line_mm: 1500,
            },
        };
        const { result } = run(facts, 'strict');
        for (const rule of result.planning_merits.rule_outcomes) {
            expect(rule.applicability).toMatch(/applies|does_not_apply|uncertain_manual_review/);
            expect(rule.threshold_status).toBeDefined();
            expect(rule.legal_basis).toBeDefined();
            expect(rule.effect_type).toBeDefined();
        }
    });
});
