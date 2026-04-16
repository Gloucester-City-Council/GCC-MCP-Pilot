/**
 * Schema loader - loads the council tax schema pack at cold start
 * Loads four v2.5.3 documents (facts, rules, taxonomy, results) from schemas/CouncilTax/
 * and builds a merged view that preserves backward-compatible JSON Pointer paths.
 * Computes SHA-256 hash and extracts version metadata.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getSchemaDir } = require('../util/config');

// Module-level cache
let cachedSchema = null;
let cachedDocuments = null;
let cachedHash = null;
let cachedVersion = null;
let cachedFinancialYear = null;
let loadError = null;

/**
 * Schema file manifest - the four v2.5.3 documents
 */
const SCHEMA_FILES = {
    facts: 'council_tax_facts.v2.5.3.json',
    rules: 'council_tax_rules.v2.5.3.json',
    taxonomy: 'council_tax_taxonomy.v2.5.3.json',
    results: 'council_tax_results.v2.5.3.json'
};

/**
 * Build a merged schema view from the four documents.
 * Flattens the facts document so that existing JSON Pointer paths
 * (e.g. /discounts, /enforcement, /legal_framework) continue to work,
 * while adding new top-level sections from rules, taxonomy and results.
 */
function buildMergedSchema(docs) {
    const { facts, rules, taxonomy, results } = docs;
    const sd = facts.service_definition || {};
    const adj = facts.adjustment_catalogue || {};
    const ops = facts.operational_facts || {};
    const cs = facts.charge_schedule || {};

    return {
        // Metadata
        schema_metadata: sd.schema_metadata || {},
        document_meta: facts.document_meta || {},
        package_identity: sd.package_identity || {},

        // Service overview and legal framework
        service_overview: sd.service_overview || {},
        legal_framework: sd.legal_framework || {},
        governance: sd.governance || {},
        national_context: sd.national_context || {},
        related_services: sd.related_services || {},

        // Valuation and charging
        valuation_and_charging: cs.valuation_and_charging || {},

        // Adjustments (discounts, premiums, exemptions, CTS)
        discounts: adj.discounts || {},
        property_premiums: adj.property_premiums || {},
        exemptions: adj.exemptions || {},
        council_tax_support: adj.council_tax_support || {},

        // Operational facts
        payment: ops.payment || {},
        liability: ops.liability || {},
        enforcement: ops.enforcement || {},
        appeals_and_challenges: ops.appeals_and_challenges || {},
        service_standards: ops.service_standards || {},
        data_privacy: ops.data_privacy || {},
        channels: ops.channels || {},
        complaints: ops.complaints || {},
        holiday_lets_and_self_catering: ops.holiday_lets_and_self_catering || {},
        fraud: ops.fraud || {},
        security_warning: ops.security_warning || {},

        // Publication and quality control
        publication_control: facts.publication_control || {},
        open_issues: facts.open_issues || [],
        sources: facts.sources || [],
        cross_document_index: facts.cross_document_index || {},

        // Charge outputs from results document (2026/27 approved rates)
        charge_outputs: results.charge_outputs || {},
        evidence_requirements: results.evidence_requirements || [],
        execution_readiness: results.execution_readiness || {},

        // Rules from rules document
        rule_sets: rules.rule_sets || {},
        executable_rules: rules.executable_rule_slices || {},
        calculation_order: rules.calculation_order || [],
        conflict_resolution: rules.conflict_resolution || {},

        // Taxonomy controlled vocabulary
        taxonomy: {
            mechanisms: taxonomy.mechanisms || [],
            legal_basis_types: taxonomy.legal_basis_types || [],
            discount_categories: taxonomy.discount_categories || [],
            exemption_categories: taxonomy.exemption_categories || [],
            exemption_classes: taxonomy.exemption_classes || [],
            occupancy_statuses: taxonomy.occupancy_statuses || [],
            property_statuses: taxonomy.property_statuses || [],
            person_roles: taxonomy.person_roles || [],
            evidence_types: taxonomy.evidence_types || [],
            decision_outcomes: taxonomy.decision_outcomes || [],
            themes: taxonomy.themes || [],
            calc_stages: taxonomy.calc_stages || [],
            rule_types: taxonomy.rule_types || [],
            effect_types: taxonomy.effect_types || []
        }
    };
}

/**
 * Load all schema documents from disk
 * @returns {object|null} Merged schema or null on error
 */
function loadSchema() {
    if (cachedSchema !== null) {
        return cachedSchema;
    }

    if (loadError !== null) {
        return null;
    }

    try {
        const schemaDir = getSchemaDir();
        const absoluteDir = path.resolve(process.cwd(), schemaDir);

        const docs = {};
        const hashInput = crypto.createHash('sha256');

        for (const [key, filename] of Object.entries(SCHEMA_FILES)) {
            const filePath = path.join(absoluteDir, filename);
            const content = fs.readFileSync(filePath, 'utf8');
            docs[key] = JSON.parse(content);
            hashInput.update(content);
        }

        cachedDocuments = docs;
        cachedHash = 'sha256:' + hashInput.digest('hex');

        // Build merged view
        cachedSchema = buildMergedSchema(docs);

        // Extract version from facts document metadata
        const factsMeta = docs.facts.document_meta || {};
        cachedVersion = factsMeta.version || factsMeta.document_version || 'unknown';
        cachedFinancialYear = factsMeta.financial_year || 'unknown';

        console.log(`Council Tax schema pack loaded: version=${cachedVersion}, financial_year=${cachedFinancialYear}, hash=${cachedHash.substring(0, 20)}...`);

        return cachedSchema;
    } catch (err) {
        loadError = err;
        console.error('Failed to load council tax schema pack:', err.message);
        return null;
    }
}

/**
 * Get the merged schema (loads if not already loaded)
 * @returns {object|null} Merged schema object or null if load failed
 */
function getSchema() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedSchema;
}

/**
 * Get individual document by type
 * @param {string} docType - One of 'facts', 'rules', 'taxonomy', 'results'
 * @returns {object|null} Raw document or null
 */
function getDocument(docType) {
    if (cachedDocuments === null && loadError === null) {
        loadSchema();
    }
    return cachedDocuments ? cachedDocuments[docType] || null : null;
}

/**
 * Get the schema hash (combined hash of all 4 documents)
 * @returns {string|null} SHA-256 hash or null if not loaded
 */
function getSchemaHash() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedHash;
}

/**
 * Get the schema version
 * @returns {string|null} Schema version or null if not loaded
 */
function getSchemaVersion() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedVersion;
}

/**
 * Get the financial year
 * @returns {string|null} Financial year or null if not loaded
 */
function getFinancialYear() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedFinancialYear;
}

/**
 * Check if schema is loaded successfully
 * @returns {boolean} True if loaded
 */
function isSchemaLoaded() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedSchema !== null;
}

/**
 * Get the load error if any
 * @returns {Error|null} Load error or null
 */
function getLoadError() {
    return loadError;
}

/**
 * Force reload of the schema (for testing)
 */
function reloadSchema() {
    cachedSchema = null;
    cachedDocuments = null;
    cachedHash = null;
    cachedVersion = null;
    cachedFinancialYear = null;
    loadError = null;
    return loadSchema();
}

module.exports = {
    getSchema,
    getDocument,
    getSchemaHash,
    getSchemaVersion,
    getFinancialYear,
    isSchemaLoaded,
    getLoadError,
    reloadSchema
};
