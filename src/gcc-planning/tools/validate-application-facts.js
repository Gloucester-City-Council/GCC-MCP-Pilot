/**
 * Tool: planning_validate_application_facts (Phase 1)
 *
 * Schema validation only. No recommendation. No merits.
 * Checks that the submitted facts object conforms to the
 * gloucester-householder-application-facts.v2.2 schema structure.
 *
 * Per plan Section 5: "validate_application_facts — Phase 1. Schema validation. No recommendation."
 */

'use strict';

const { normalise } = require('../pipeline/facts-normaliser');
const { SCHEMA_VERSIONS } = require('../schema-loader');

/**
 * @param {object} args  MCP tool arguments
 * @returns {object}     Tool result
 */
function execute(args) {
    const { facts, mode = 'strict' } = args;

    if (!facts || typeof facts !== 'object') {
        return {
            valid: false,
            schema_valid: false,
            issues: [{ code: 'missing_facts', message: 'A "facts" object is required.', severity: 'blocking' }],
            schema_versions: SCHEMA_VERSIONS,
        };
    }

    // Basic structural check
    const required = ['application', 'site', 'proposal'];
    const missingTopLevel = required.filter(f => !facts[f] || typeof facts[f] !== 'object');

    if (missingTopLevel.length > 0) {
        return {
            valid: false,
            schema_valid: false,
            issues: missingTopLevel.map(f => ({
                code: `missing_section_${f}`,
                message: `Required top-level section "${f}" is missing or not an object.`,
                severity: 'blocking',
                field: f,
            })),
            schema_versions: SCHEMA_VERSIONS,
            note: 'Facts object must have "application", "site", and "proposal" sections.',
        };
    }

    // Run data quality normalisation (catches semantic issues)
    const { dataQualityIssues, dataQualityStatus } = normalise(facts);

    const blockingIssues = dataQualityIssues.filter(i => i.severity === 'blocking');
    const warnings       = dataQualityIssues.filter(i => i.severity === 'warning');

    // Enum checks for key fields
    const enumIssues = validateEnums(facts);

    const allIssues = [...blockingIssues, ...enumIssues, ...warnings];
    const isValid = blockingIssues.length === 0 && enumIssues.length === 0;

    return {
        valid: isValid,
        schema_valid: missingTopLevel.length === 0,
        data_quality_status: dataQualityStatus,
        issues: allIssues,
        issue_count: {
            blocking: blockingIssues.length + enumIssues.length,
            warning:  warnings.length,
        },
        schema_versions: SCHEMA_VERSIONS,
        note: isValid
            ? 'Facts object passes structural and data quality validation.'
            : `Facts object has ${blockingIssues.length + enumIssues.length} blocking issue(s). Review the issues list before proceeding.`,
    };
}

/**
 * Validate key enum fields against allowed values.
 */
function validateEnums(facts) {
    const issues = [];
    const app  = facts.application || {};
    const site = facts.site        || {};

    const validRoutes = new Set([
        'householder_planning_permission',
        'householder_planning_permission_and_listed_building_consent',
        'pre_application_householder',
        'prior_notification_larger_home_extension',
    ]);
    if (app.application_route && !validRoutes.has(app.application_route)) {
        issues.push({
            code: 'invalid_enum',
            message: `application_route "${app.application_route}" is not a valid value. Expected: ${[...validRoutes].join(', ')}.`,
            severity: 'blocking',
            field: 'application.application_route',
        });
    }

    const validFloodZones = new Set(['1', '2', '3a', '3b', 'unknown']);
    if (site.flood_zone && !validFloodZones.has(site.flood_zone)) {
        issues.push({
            code: 'invalid_enum',
            message: `flood_zone "${site.flood_zone}" is not a valid value. Expected: ${[...validFloodZones].join(', ')}.`,
            severity: 'blocking',
            field: 'site.flood_zone',
        });
    }

    const validDwellingTypes = new Set(['detached', 'semi_detached', 'terrace', 'end_terrace', 'bungalow', 'flat', 'other']);
    if (site.dwelling_type && !validDwellingTypes.has(site.dwelling_type)) {
        issues.push({
            code: 'invalid_enum',
            message: `dwelling_type "${site.dwelling_type}" is not a valid value.`,
            severity: 'blocking',
            field: 'site.dwelling_type',
        });
    }

    return issues;
}

module.exports = { execute };
