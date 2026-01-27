/**
 * Get Councillors By Ward Tool
 * Returns councillors for a specific ward in a Gloucestershire council
 */

const moderngovClient = require('../moderngov-client');
const councilConfig = require('../council-config');

/**
 * Get councillors for a specific ward
 *
 * @param {string} councilName - Council name
 * @param {string} wardName - Ward name (e.g., "Kingsholm and Wotton")
 * @returns {Promise<object>} Councillor information for the ward
 */
async function getCouncillorsByWard(councilName, wardName) {
    if (!councilName) {
        return {
            error: 'council_name is required',
            available_councils: councilConfig.getCouncilNames()
        };
    }

    if (!wardName) {
        return {
            error: 'ward_name is required',
            hint: 'Use get_councillors to see all available wards for this council.'
        };
    }

    // Normalize ward name for lookup
    const normalizedWardName = wardName.trim();

    // Get wards data from knowledge base
    const wardsData = councilConfig.getWards(councilName);
    if (!wardsData) {
        return {
            error: 'Council not found or no ward data available',
            council_name: councilName,
            available_councils: councilConfig.getCouncilNames()
        };
    }

    // Look up ward ID from knowledge base
    const ward = (wardsData.wards || []).find(w =>
        w.name && w.name.toLowerCase().includes(normalizedWardName.toLowerCase())
    );

    if (!ward) {
        // Provide helpful error with available wards
        const availableWards = (wardsData.wards || []).map(w => w.name).filter(Boolean).sort();
        return {
            error: 'Ward not found',
            council_name: councilName,
            ward_name: normalizedWardName,
            hint: 'Ward name not recognized. Please check spelling.',
            available_wards: availableWards
        };
    }

    // Try to get live councillors from ModernGov if we have a ward ID
    if (ward.id) {
        try {
            const result = await moderngovClient.getCouncillorsByWardId(councilName, ward.id);

            return {
                council: councilName,
                ward_name: result.ward_name,
                ward_id: ward.id,
                councillors: result.councillors || [],
                count: (result.councillors || []).length,
                source: 'live_moderngov'
            };
        } catch (e) {
            console.warn(`Could not fetch live ward data for ${councilName}/${wardName}:`, e.message);
        }
    }

    // Return knowledge base data
    return {
        council: councilName,
        ward_name: ward.name,
        ward_id: ward.id,
        note: 'Ward data from knowledge base. Live ModernGov data not available.',
        source: 'knowledge_base'
    };
}

module.exports = { getCouncillorsByWard };
