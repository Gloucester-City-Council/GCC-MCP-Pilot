/**
 * Get Councillors By Ward Tool
 * Returns councillors for a specific ward
 */

const moderngovClient = require('../moderngov-client');
const path = require('path');

// Load ward to ID mapping
let wardMapping;
try {
    wardMapping = require('../../json/wardToID.json');
} catch (e) {
    wardMapping = { wards: {} };
}

/**
 * Get councillors for a specific ward
 *
 * @param {string} wardName - Ward name (e.g., "Kingsholm and Wotton")
 * @returns {Promise<object>} Councillor information for the ward
 */
async function getCouncillorsByWard(wardName) {
    // Normalize ward name for lookup
    const normalizedWardName = wardName.trim();

    // Look up ward ID
    const wardId = wardMapping.wards[normalizedWardName];

    if (!wardId) {
        // Provide helpful error with available wards
        const availableWards = Object.keys(wardMapping.wards).sort();
        return {
            error: 'Ward not found',
            ward_name: normalizedWardName,
            hint: 'Ward name not recognized. Please check spelling and capitalization.',
            available_wards: availableWards
        };
    }

    // Get councillors from ModernGov
    const result = await moderngovClient.getCouncillorsByWardId(wardId);

    return {
        ward_name: normalizedWardName,
        ward_id: wardId,
        councillors: result.councillors || [],
        count: (result.councillors || []).length,
        council: 'Gloucester City Council'
    };
}

module.exports = { getCouncillorsByWard };
