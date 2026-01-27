/**
 * Get Councillors Tool
 * Returns all councillors organized by ward for a Gloucestershire council
 */

const moderngovClient = require('../moderngov-client');
const councilConfig = require('../council-config');

/**
 * Get all councillors organized by ward for a council
 *
 * @param {string} councilName - Council name
 * @returns {Promise<object>} All councillors grouped by ward
 */
async function getCouncillors(councilName) {
    if (!councilName) {
        return {
            error: 'council_name is required',
            available_councils: councilConfig.getCouncilNames()
        };
    }

    // Try to get live data from ModernGov
    try {
        const result = await moderngovClient.getCouncillorsByWard(councilName);

        return {
            council: councilName,
            wards: result.wards || [],
            total_wards: (result.wards || []).length,
            total_councillors: (result.wards || []).reduce((sum, ward) =>
                sum + (ward.councillors?.length || 0), 0),
            note: 'All councillors organized by ward. Use get_councillors_by_ward to get councillors for a specific ward.',
            source: 'live_moderngov'
        };
    } catch (e) {
        // Fallback to ward data from knowledge base
        const wardsData = councilConfig.getWards(councilName);
        if (!wardsData) {
            return {
                error: 'Council not found or no ward data available',
                council_name: councilName,
                available_councils: councilConfig.getCouncilNames()
            };
        }

        return {
            council: councilName,
            wards: wardsData.wards || [],
            total_wards: (wardsData.wards || []).length,
            note: 'Ward data from knowledge base. Live ModernGov data not available.',
            source: 'knowledge_base',
            error_detail: e.message
        };
    }
}

module.exports = { getCouncillors };
