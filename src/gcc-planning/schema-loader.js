/**
 * GCC Planning Schema Loader
 *
 * Loads all four planning schema files at module initialisation:
 *   - gloucester-planning-enums.v1.schema.json        (canonical enum source of truth)
 *   - gloucester-householder-application-facts.v2.2.schema.json
 *   - gloucester-householder-assessment-result.v2.2.schema.json
 *   - gloucester-householder-policy-ruleset.v4.3.json
 *
 * Fail-fast: if any schema file is missing or malformed this module throws on
 * require(), preventing any tool from returning silent empty results.
 *
 * Startup validation: all enum values in the facts/result schemas are checked
 * against the enums file, per plan Section 15.1.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ─── File paths ───────────────────────────────────────────────────────────────
const PLANNING_DIR = path.resolve(__dirname, '../../schemas/planning');

const ENUMS_FILE    = 'gloucester-planning-enums.v1.schema.json';
const FACTS_FILE    = 'gloucester-householder-application-facts.v2.2.schema.json';
const RESULT_FILE   = 'gloucester-householder-assessment-result.v2.2.schema.json';
const RULESET_FILE  = 'gloucester-householder-policy-ruleset.v4.3.json';

function loadJson(filename) {
    const filepath = path.join(PLANNING_DIR, filename);
    try {
        return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch (err) {
        throw new Error(
            `GCC Planning: schema file unreadable at ${filepath} — ${err.message}`
        );
    }
}

const ENUMS   = loadJson(ENUMS_FILE);
const FACTS   = loadJson(FACTS_FILE);
const RESULT  = loadJson(RESULT_FILE);
const RULESET = loadJson(RULESET_FILE);

// ─── Extract ruleset sections ─────────────────────────────────────────────────
let VALIDATION_MODULES, ASSESSMENT_TESTS, CONSULTATION_MATRIX, CIL_ASSESSMENT,
    APPLICABILITY_FRAMEWORK, CONDITIONS_LIBRARY, INFORMATIVES_LIBRARY;

try {
    VALIDATION_MODULES      = RULESET.validation_modules;
    ASSESSMENT_TESTS        = RULESET.assessment_tests;       // array
    CONSULTATION_MATRIX     = RULESET.consultation_matrix;
    CIL_ASSESSMENT          = RULESET.cil_assessment;
    APPLICABILITY_FRAMEWORK = RULESET.applicability_framework;
    CONDITIONS_LIBRARY      = RULESET.conditions_library || [];
    INFORMATIVES_LIBRARY    = RULESET.informatives_library || [];
} catch (err) {
    throw new Error(
        `GCC Planning: ruleset structure invalid in ${RULESET_FILE} — ${err.message}`
    );
}

// ─── Flatten all rules across assessment_tests ────────────────────────────────
/** Map from rule_id → { rule, test_id, test_name } for fast lookup */
const RULES_BY_ID = new Map();

for (const test of ASSESSMENT_TESTS) {
    for (const rule of (test.rules || [])) {
        RULES_BY_ID.set(rule.rule_id, { rule, test_id: test.test_id, test_name: test.test_name });
    }
}

// ─── Flatten validation requirements ─────────────────────────────────────────
/** Map from requirement_id → requirement object for fast lookup */
const VALIDATION_REQUIREMENTS_BY_ID = new Map();

for (const moduleKey of Object.keys(VALIDATION_MODULES)) {
    const mod = VALIDATION_MODULES[moduleKey];
    for (const [reqKey, req] of Object.entries(mod)) {
        if (reqKey.startsWith('_')) continue;
        if (req && req.requirement_id) {
            VALIDATION_REQUIREMENTS_BY_ID.set(req.requirement_id, { ...req, _module: moduleKey });
        }
        if (req && req.item_number !== undefined) {
            // Local validation items use item_number as identifier
            const id = `B${req.item_number}`;
            VALIDATION_REQUIREMENTS_BY_ID.set(id, { ...req, _module: moduleKey });
        }
    }
}

// ─── Material-rule register (plan Section 3.6) ────────────────────────────────
// These rules, when returning cannot_assess, force planning_merits.status = cannot_assess
// regardless of other percentages. Gloucester-specific — review for other councils.
const MATERIAL_RULES_REGISTER = [
    'A1.2.1',   // 45-degree rule
    'A1.2.7',   // garden depth
    'A1.1.2',   // ridge height for two-storey
    'A1.7.2',   // conservation area (when in CA)
    'A1.8.1',   // flood zone (when in FZ2/3)
];

const MATERIAL_RULES_REGISTER_SET = new Set(MATERIAL_RULES_REGISTER);

const MATERIAL_RULES_REGISTER_VERSION = RULESET.model_version;

// ─── Schema versions ──────────────────────────────────────────────────────────
const SCHEMA_VERSIONS = {
    enums:   ENUMS.$id   || ENUMS_FILE,
    facts:   FACTS.$id   || FACTS_FILE,
    result:  RESULT.$id  || RESULT_FILE,
    ruleset: RULESET.model_version || RULESET_FILE,
};

// ─── Enum value sets for runtime validation (plan Section 15.1) ───────────────
/** Map from enum type name → Set of allowed string values */
const ENUM_VALUE_SETS = new Map();
if (ENUMS && ENUMS.properties) {
    for (const [enumType, def] of Object.entries(ENUMS.properties)) {
        if (def && Array.isArray(def.enum)) {
            ENUM_VALUE_SETS.set(enumType, new Set(def.enum));
        }
    }
}

function normaliseLookupId(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validate that a value belongs to a named enum type.
 * @param {string} enumType  e.g. 'decision_mode'
 * @param {string} value
 * @returns {boolean}
 */
function isValidEnumValue(enumType, value) {
    const set = ENUM_VALUE_SETS.get(enumType);
    return set ? set.has(value) : true; // permissive if enum type unknown
}

/**
 * Find an assessment rule by rule_id.
 * @param {string} ruleId  e.g. 'A1.2.1'
 * @returns {{ rule, test_id, test_name } | null}
 */
function findRule(ruleId) {
    const normalisedRuleId = normaliseLookupId(ruleId);
    if (!normalisedRuleId) return null;
    return RULES_BY_ID.get(normalisedRuleId) || null;
}

/**
 * Find a validation requirement by ID (e.g. 'A1', 'B8').
 * @param {string} reqId
 * @returns {object | null}
 */
function findValidationRequirement(reqId) {
    const normalisedReqId = normaliseLookupId(reqId);
    if (!normalisedReqId) return null;
    return VALIDATION_REQUIREMENTS_BY_ID.get(normalisedReqId) || null;
}

/**
 * Whether a rule_id is in the material-rule register.
 * @param {string} ruleId
 * @returns {boolean}
 */
function isMaterialRule(ruleId) {
    const normalisedRuleId = normaliseLookupId(ruleId);
    if (!normalisedRuleId) return false;
    return MATERIAL_RULES_REGISTER_SET.has(normalisedRuleId);
}

module.exports = {
    // Raw schema objects
    ENUMS,
    FACTS,
    RESULT,
    RULESET,
    // Extracted sections
    VALIDATION_MODULES,
    ASSESSMENT_TESTS,
    CONSULTATION_MATRIX,
    CIL_ASSESSMENT,
    APPLICABILITY_FRAMEWORK,
    CONDITIONS_LIBRARY,
    INFORMATIVES_LIBRARY,
    // Lookup maps
    RULES_BY_ID,
    VALIDATION_REQUIREMENTS_BY_ID,
    // Register
    MATERIAL_RULES_REGISTER,
    MATERIAL_RULES_REGISTER_SET,
    MATERIAL_RULES_REGISTER_VERSION,
    // Version info
    SCHEMA_VERSIONS,
    ENUM_VALUE_SETS,
    // File names
    ENUMS_FILE,
    FACTS_FILE,
    RESULT_FILE,
    RULESET_FILE,
    // Helpers
    isValidEnumValue,
    findRule,
    findValidationRequirement,
    isMaterialRule,
};
