'use strict';

/**
 * Revised schema loader — loads the council tax v2 five-document pack at cold start.
 * Documents: ct_facts, ct_rules, ct_vocabulary, ct_channel_overlay, ct_chatbot_overlay.
 * Source directory: schemas/CouncilTax/revisedSchema/
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REVISED_SCHEMA_DIR = process.env.MCP_REVISED_SCHEMA_DIR || 'schemas/CouncilTax/revisedSchema';

const DOC_FILES = {
    facts: 'ct_facts.json',
    rules: 'ct_rules.json',
    vocabulary: 'ct_vocabulary.json',
    channel_overlay: 'ct_channel_overlay.json',
    chatbot_overlay: 'ct_chatbot_overlay.json',
};

let cachedSchema = null;
let cachedDocuments = null;
let cachedHash = null;
let cachedVersion = null;
let cachedFinancialYear = null;
let loadError = null;

function buildMergedSchema(docs) {
    const { facts, rules, vocabulary, channel_overlay, chatbot_overlay } = docs;

    return {
        // Authority and identity
        authority: facts.authority || {},

        // Valuation and charging
        valuation: facts.valuation || {},

        // Adjustments
        discounts: facts.discounts || [],
        exemptions: facts.exemptions || [],
        premiums: facts.premiums || {},
        council_tax_support: facts.council_tax_support || {},

        // Operational facts
        liability: facts.liability || {},
        enforcement: facts.enforcement || {},
        appeals: facts.appeals || {},

        // Rules and calculation
        calculation_sequence: rules.calculation_sequence || [],
        conflict_resolution: rules.conflict_resolution || {},
        human_review_gates: rules.human_review_gates || {},
        executable_rules: rules.executable_rules || [],
        narrative_rules: rules.narrative_rules || {},

        // Vocabulary (controlled terms)
        vocabulary: {
            mechanisms: vocabulary.mechanisms || [],
            legal_basis_types: vocabulary.legal_basis_types || [],
            discount_categories: vocabulary.discount_categories || [],
            exemption_categories: vocabulary.exemption_categories || [],
            exemption_classes: vocabulary.exemption_classes || [],
            occupancy_statuses: vocabulary.occupancy_statuses || [],
            property_statuses: vocabulary.property_statuses || [],
            person_roles: vocabulary.person_roles || [],
            liability_bases: vocabulary.liability_bases || [],
            evidence_types: vocabulary.evidence_types || [],
            decision_outcomes: vocabulary.decision_outcomes || [],
            issue_types: vocabulary.issue_types || [],
            source_types: vocabulary.source_types || [],
            themes: vocabulary.themes || [],
            relationship_types: vocabulary.relationship_types || [],
        },

        // Presentation overlays
        channel_overlay: channel_overlay || {},
        chatbot_overlay: chatbot_overlay || {},
    };
}

function loadSchema() {
    if (cachedSchema !== null) return cachedSchema;
    if (loadError !== null) return null;

    try {
        const schemaDir = path.resolve(process.cwd(), REVISED_SCHEMA_DIR);
        const docs = {};
        const hashInput = crypto.createHash('sha256');

        for (const [key, filename] of Object.entries(DOC_FILES)) {
            const filePath = path.join(schemaDir, filename);
            const content = fs.readFileSync(filePath, 'utf8');
            docs[key] = JSON.parse(content);
            hashInput.update(content);
        }

        cachedDocuments = docs;
        cachedHash = 'sha256:' + hashInput.digest('hex');
        cachedSchema = buildMergedSchema(docs);

        const rates = docs.facts.valuation && docs.facts.valuation.rates;
        cachedFinancialYear = rates && rates['2026_27']
            ? rates['2026_27'].financial_year
            : '2026/27';
        cachedVersion = docs.facts['$schema'] || 'gloucester-ct/1.0';

        console.log(`Revised council tax schema loaded: financial_year=${cachedFinancialYear}, hash=${cachedHash.substring(0, 20)}...`);
        return cachedSchema;
    } catch (err) {
        loadError = err;
        console.error('Failed to load revised council tax schema:', err.message);
        return null;
    }
}

function getSchema() {
    if (cachedSchema === null && loadError === null) loadSchema();
    return cachedSchema;
}

function getDocument(docType) {
    if (cachedDocuments === null && loadError === null) loadSchema();
    return cachedDocuments ? (cachedDocuments[docType] || null) : null;
}

function getSchemaHash() {
    if (cachedSchema === null && loadError === null) loadSchema();
    return cachedHash;
}

function getSchemaVersion() {
    if (cachedSchema === null && loadError === null) loadSchema();
    return cachedVersion;
}

function getFinancialYear() {
    if (cachedSchema === null && loadError === null) loadSchema();
    return cachedFinancialYear;
}

function isSchemaLoaded() {
    if (cachedSchema === null && loadError === null) loadSchema();
    return cachedSchema !== null;
}

function getLoadError() {
    return loadError;
}

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
    reloadSchema,
};
