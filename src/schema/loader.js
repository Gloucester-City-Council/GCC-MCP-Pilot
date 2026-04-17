/**
 * Schema loader - loads the council tax schema pack at cold start.
 * Uses the v2.5.6 runtime-first document set (facts, rules, taxonomy, results),
 * while preserving backward-compatible merged paths used by existing tools.
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
let cachedDocumentPack = null;
let loadError = null;

/**
 * Schema file pattern:
 * council_tax_<document>.v<version>.json
 */
const FILE_PATTERN = /^council_tax_(facts|rules|taxonomy|results)\.v(\d+(?:\.\d+)*)\.json$/;
const REQUIRED_DOC_TYPES = ['facts', 'rules', 'taxonomy', 'results'];

function compareVersions(a, b) {
    const aParts = String(a).split('.').map(part => parseInt(part, 10) || 0);
    const bParts = String(b).split('.').map(part => parseInt(part, 10) || 0);
    const maxLen = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < maxLen; i += 1) {
        const diff = (aParts[i] || 0) - (bParts[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

function discoverSchemaPack(schemaDir) {
    const preferredVersion = process.env.MCP_SCHEMA_VERSION
        ? String(process.env.MCP_SCHEMA_VERSION).replace(/^v/i, '')
        : null;
    const byVersion = new Map();
    const files = fs.readdirSync(schemaDir);

    for (const filename of files) {
        const match = filename.match(FILE_PATTERN);
        if (!match) continue;

        const [, docType, version] = match;
        if (!byVersion.has(version)) {
            byVersion.set(version, {});
        }
        byVersion.get(version)[docType] = filename;
    }

    const completeVersions = Array.from(byVersion.entries())
        .filter(([, docs]) => REQUIRED_DOC_TYPES.every(type => docs[type]))
        .map(([version]) => version)
        .sort((a, b) => compareVersions(b, a));

    if (completeVersions.length === 0) {
        throw new Error(`No complete council tax schema pack found in ${schemaDir}`);
    }

    const selectedVersion = preferredVersion && completeVersions.includes(preferredVersion)
        ? preferredVersion
        : completeVersions[0];

    if (preferredVersion && selectedVersion !== preferredVersion) {
        console.warn(`Requested MCP_SCHEMA_VERSION=${preferredVersion} not found as a complete pack. Using ${selectedVersion} instead.`);
    }

    const selectedFiles = byVersion.get(selectedVersion);
    return {
        version: selectedVersion,
        files: {
            facts: selectedFiles.facts,
            rules: selectedFiles.rules,
            taxonomy: selectedFiles.taxonomy,
            results: selectedFiles.results
        }
    };
}

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
        profiles: {
            facts: facts.profiles || {},
            rules: rules.profiles || {},
            taxonomy: taxonomy.profiles || {},
            results: results.profiles || {}
        },

        // Charge outputs from results document (2026/27 approved rates)
        charge_outputs: results.charge_outputs || {},
        evidence_requirements: results.evidence_requirements || [],
        execution_readiness: results.execution_readiness || {},
        runtime_contract: results.runtime_contract || {},
        consumer_contract: results.consumer_contract || {},
        supporting_context: results.supporting_context || {},

        // Rules from rules document
        rule_sets: rules.rule_sets || {},
        executable_rules: rules.executable_rule_slices || {},
        calculation_order: rules.calculation_order || [],
        conflict_resolution: rules.conflict_resolution || {},
        runtime_resolver_contract: rules.runtime_resolver_contract || {},

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
        },

        // Runtime-first sections for API execution
        runtime_vocabularies: taxonomy.runtime_vocabularies || {},
        runtime_case_model: facts.runtime_case_model || {},
        runtime: {
            taxonomy_runtime_vocabularies: taxonomy.runtime_vocabularies || {},
            facts_runtime_case_model: facts.runtime_case_model || {},
            rules_runtime_resolver_contract: rules.runtime_resolver_contract || {},
            results_runtime_contract: results.runtime_contract || {},
            results_consumer_contract: results.consumer_contract || {},
            results_supporting_context: results.supporting_context || {}
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

        const discoveredPack = discoverSchemaPack(absoluteDir);
        const docs = {};
        const hashInput = crypto.createHash('sha256');

        for (const [key, filename] of Object.entries(discoveredPack.files)) {
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
        cachedDocumentPack = `v${discoveredPack.version} (facts, rules, taxonomy, results)`;

        console.log(`Council Tax schema pack loaded: version=${cachedVersion}, financial_year=${cachedFinancialYear}, pack=${cachedDocumentPack}, hash=${cachedHash.substring(0, 20)}...`);

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
 * Get loaded schema document pack identifier
 * @returns {string|null} e.g. "v2.5.6 (facts, rules, taxonomy, results)"
 */
function getDocumentPack() {
    if (cachedSchema === null && loadError === null) {
        loadSchema();
    }
    return cachedDocumentPack;
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
    cachedDocumentPack = null;
    loadError = null;
    return loadSchema();
}

module.exports = {
    getSchema,
    getDocument,
    getSchemaHash,
    getSchemaVersion,
    getFinancialYear,
    getDocumentPack,
    isSchemaLoaded,
    getLoadError,
    reloadSchema,
    discoverSchemaPack
};
