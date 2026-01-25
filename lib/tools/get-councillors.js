/**
 * Get Councillors Tool
 * Returns all councillors organized by ward
 */

const moderngovClient = require('../moderngov-client');

/**
 * Get all councillors organized by ward
 *
 * @returns {Promise<object>} All councillors grouped by ward
 */
async function getCouncillors() {
    // Get all councillors from ModernGov
    const result = await moderngovClient.getCouncillorsByWard();

    return {
        wards: result.wards || [],
        total_wards: (result.wards || []).length,
        total_councillors: (result.wards || []).reduce((sum, ward) =>
            sum + (ward.councillors?.length || 0), 0),
        council: 'Gloucester City Council',
        note: 'All councillors organized by ward. Use get_councillors_by_ward to get councillors for a specific ward.'
    };
}

module.exports = { getCouncillors };
