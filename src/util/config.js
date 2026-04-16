/**
 * Configuration utilities for MCP Schema API
 * Reads from environment variables with sensible defaults
 */

/**
 * Get the schema allowlist from environment
 * @returns {string[]} Array of allowed top-level paths
 */
function getSchemaAllowlist() {
    const envValue = process.env.MCP_SCHEMA_ALLOWLIST;
    if (!envValue) {
        return [
            // Service identity and legal basis
            '/schema_metadata',
            '/document_meta',
            '/package_identity',
            '/service_overview',
            '/legal_framework',
            '/governance',
            '/national_context',
            '/related_services',
            // Valuation and charges
            '/valuation_and_charging',
            '/charge_outputs',
            // Adjustments
            '/discounts',
            '/property_premiums',
            '/exemptions',
            '/council_tax_support',
            // Operational
            '/payment',
            '/liability',
            '/enforcement',
            '/appeals_and_challenges',
            '/service_standards',
            '/data_privacy',
            '/channels',
            '/complaints',
            '/holiday_lets_and_self_catering',
            '/fraud',
            '/security_warning',
            // Quality and publication control
            '/publication_control',
            '/open_issues',
            '/sources',
            '/cross_document_index',
            // Rules and evaluation
            '/rule_sets',
            '/executable_rules',
            '/calculation_order',
            '/conflict_resolution',
            '/evidence_requirements',
            '/execution_readiness',
            // Taxonomy
            '/taxonomy'
        ];
    }
    return envValue.split(',').map(p => p.trim());
}

/**
 * Get maximum bytes limit for schema.get responses
 * @returns {number} Maximum bytes
 */
function getMaxBytes() {
    const envValue = process.env.MCP_MAX_BYTES;
    if (envValue) {
        const parsed = parseInt(envValue, 10);
        if (!isNaN(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return 200000; // Default 200KB
}

/**
 * Get the schema directory path (containing the 4 v2.5.2 documents)
 * @returns {string} Path to schema directory
 */
function getSchemaDir() {
    return process.env.MCP_SCHEMA_DIR || 'schemas/CouncilTax';
}

/**
 * @deprecated Use getSchemaDir() instead. Kept for backward compatibility.
 * @returns {string} Path to schema file or directory
 */
function getSchemaPath() {
    return process.env.MCP_SCHEMA_PATH || getSchemaDir();
}

module.exports = {
    getSchemaAllowlist,
    getMaxBytes,
    getSchemaDir,
    getSchemaPath
};
