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
        // Default allowlist if not specified
        return [
            '/sections',
            '/schema_metadata',
            '/legal_framework',
            '/package_identity',
            '/service_overview',
            '/valuation_and_charging',
            '/discounts',
            '/property_premiums',
            '/exemptions',
            '/council_tax_support',
            '/payment',
            '/liability',
            '/enforcement',
            '/appeals_and_challenges',
            '/service_standards',
            '/data_privacy',
            '/governance',
            '/channels',
            '/complaints',
            '/holiday_lets_and_self_catering',
            '/related_services',
            '/fraud',
            '/security_warning'
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
 * Get the schema file path
 * @returns {string} Path to schema file
 */
function getSchemaPath() {
    return process.env.MCP_SCHEMA_PATH || 'schemas/council_tax_schema.json';
}

module.exports = {
    getSchemaAllowlist,
    getMaxBytes,
    getSchemaPath
};
