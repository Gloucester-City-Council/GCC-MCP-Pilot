/**
 * GCC Procurement Schema Loader
 *
 * Loads procurement-contracts-schema-v0.9.3.json once at module initialisation
 * and extracts the key constants used by all five procurement tools.
 *
 * Fail-fast: if the schema file is missing or malformed this module throws on
 * require(), which prevents any tool from returning silent empty results.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const SCHEMA_FILE = process.env.GCC_PROCUREMENT_SCHEMA_FILE || 'procurement-contracts-schema-v0.9.3.json';
const SCHEMA_PATH = path.resolve(__dirname, `../../schemas/${SCHEMA_FILE}`);

let schema;
try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
} catch (err) {
    throw new Error(
        `GCC Procurement: schema file unreadable at ${SCHEMA_PATH} — ${err.message}`
    );
}

// Extract constants — a TypeError here means the schema structure has changed
let MATRIX, WAIVER_MATRIX, THRESHOLDS, NOTICES, DERIVED, CONFLICTS, RISK_FLAGS, SOURCES, KD_TRIGGERS, EXECUTION_AUTHORITY;
try {
    MATRIX = schema.approvals_and_governance
        .decision_making
        .procurement_decision_authority_matrix
        .matrix;

    WAIVER_MATRIX = schema.approvals_and_governance
        .decision_making
        .procurement_decision_authority_matrix
        .waiver_matrix;

    THRESHOLDS = schema.thresholds.sub_central_authorities;

    // notices is the array inside notice_types
    NOTICES = schema.notice_types.notices;

    DERIVED    = schema.derived_fields;
    CONFLICTS  = schema.source_documents.known_conflicts;
    RISK_FLAGS = schema.risk_flags.flags;
    SOURCES    = schema.source_documents.documents;

    KD_TRIGGERS = schema.approvals_and_governance
        .decision_making
        .decision_types
        .key_decision
        .triggers;

    EXECUTION_AUTHORITY = schema.approvals_and_governance.execution_authority;
} catch (err) {
    throw new Error(
        `GCC Procurement: schema structure invalid in ${SCHEMA_PATH} — ${err.message}. ` +
        'Schema may have been updated without corresponding schema-loader changes.'
    );
}

const SCHEMA_VERSION = schema.version;

const RISK_FLAGS_BY_ID = new Map(
    (RISK_FLAGS || []).map(flag => [String(flag.flag_id).toUpperCase(), flag])
);

const NOTICES_BY_CODE = new Map(
    (NOTICES || []).map(notice => [String(notice.code).toUpperCase(), notice])
);

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Return the procurement tier for a given whole-life contract value (inc. VAT).
 * @param {number} value
 * @returns {object|null} tier object from MATRIX, or null if not found
 */
function findTier(value) {
    return MATRIX.find(t =>
        t.min_value_gbp <= value &&
        (t.max_value_gbp === null || value <= t.max_value_gbp)
    ) || null;
}

/**
 * Determine whether a contract value is above the PA2023 threshold for the given type.
 * Source: PA2023-REGS SI 2025/1200, THRESHOLDS.sub_central_authorities
 * @param {number} value
 * @param {string} contractType  goods|services|works|light_touch|concession|mixed
 * @returns {{ above: boolean, thresholdGbp: number, source: string }}
 */
function isAboveThreshold(value, contractType) {
    let thresholdGbp;
    const type = (contractType || '').toLowerCase();

    if (type === 'works') {
        thresholdGbp = THRESHOLDS.works;
    } else if (type === 'light_touch' || type === 'concession') {
        // Concession contracts follow the light-touch threshold — PA2023 Schedule 2
        thresholdGbp = THRESHOLDS.light_touch;
    } else {
        // goods, services, mixed — use most protective sub-central threshold
        thresholdGbp = THRESHOLDS.goods_and_services;
    }

    return {
        above: value >= thresholdGbp,
        thresholdGbp,
        source: 'PA2023-REGS SI 2025/1200 — thresholds.sub_central_authorities'
    };
}

/**
 * Look up a risk flag by its flag_id.
 * @param {string} flagId e.g. 'R11'
 * @returns {object|null}
 */
function findRiskFlag(flagId) {
    if (flagId === undefined || flagId === null) return null;
    return RISK_FLAGS_BY_ID.get(String(flagId).toUpperCase()) || null;
}

/**
 * Look up a notice by its UK code.
 * @param {string} code e.g. 'UK4'
 * @returns {object|null}
 */
function findNotice(code) {
    if (code === undefined || code === null) return null;
    return NOTICES_BY_CODE.get(String(code).toUpperCase()) || null;
}

module.exports = {
    schema,
    SCHEMA_FILE,
    MATRIX,
    WAIVER_MATRIX,
    THRESHOLDS,
    NOTICES,
    DERIVED,
    CONFLICTS,
    RISK_FLAGS,
    SOURCES,
    KD_TRIGGERS,
    EXECUTION_AUTHORITY,
    SCHEMA_VERSION,
    RISK_FLAGS_BY_ID,
    NOTICES_BY_CODE,
    // helpers
    findTier,
    isAboveThreshold,
    findRiskFlag,
    findNotice,
};
