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

    const normalizedWardName = wardName.trim();
    const lowerInput = normalizedWardName.toLowerCase();

    // Primary path: fetch all wards from the live API and find the matching ward.
    // This avoids reliance on the knowledge-base JSON files, which contain
    // councillor data rather than ward data and cannot be used for ward lookup.
    try {
        const result = await moderngovClient.getCouncillorsByWard(councilName);
        const allWards = result.wards || [];

        // Prefer exact case-insensitive match, then fall back to unambiguous substring.
        let ward = allWards.find(w =>
            w.ward_name && w.ward_name.toLowerCase() === lowerInput
        );

        if (!ward) {
            const substringMatches = allWards.filter(w =>
                w.ward_name && w.ward_name.toLowerCase().includes(lowerInput)
            );

            if (substringMatches.length === 1) {
                ward = substringMatches[0];
            } else if (substringMatches.length > 1) {
                return {
                    error: 'Ambiguous ward name',
                    council_name: councilName,
                    ward_name: normalizedWardName,
                    hint: 'Multiple wards matched. Please use the exact ward name.',
                    matching_wards: substringMatches.map(w => w.ward_name).sort()
                };
            } else {
                return {
                    error: 'Ward not found',
                    council_name: councilName,
                    ward_name: normalizedWardName,
                    hint: 'Ward name not recognized. Please check spelling.',
                    available_wards: allWards.map(w => w.ward_name).filter(Boolean).sort()
                };
            }
        }

        return {
            council: councilName,
            ward_name: ward.ward_name,
            ward_id: ward.ward_id,
            councillors: ward.councillors || [],
            count: (ward.councillors || []).length,
            source: 'live_moderngov'
        };
    } catch (e) {
        console.warn(`Could not fetch live ward data for ${councilName}:`, e.message);
    }

    // Fallback: knowledge-base data. Note that the current wards.json files
    // were generated from a councillors endpoint and contain councillor names
    // rather than ward names — they need to be regenerated from GetCouncillorsByWard.
    const wardsData = councilConfig.getWards(councilName);
    if (!wardsData) {
        return {
            error: 'Council not found or no ward data available',
            council_name: councilName,
            available_councils: councilConfig.getCouncilNames()
        };
    }

    const allWards = wardsData.wards || [];

    let ward = allWards.find(w =>
        w.name && w.name.toLowerCase() === lowerInput
    );

    if (!ward) {
        const substringMatches = allWards.filter(w =>
            w.name && w.name.toLowerCase().includes(lowerInput)
        );

        if (substringMatches.length === 1) {
            ward = substringMatches[0];
        } else if (substringMatches.length > 1) {
            return {
                error: 'Ambiguous ward name',
                council_name: councilName,
                ward_name: normalizedWardName,
                hint: 'Multiple wards matched. Please use the exact ward name.',
                matching_wards: substringMatches.map(w => w.name).sort()
            };
        }
    }

    if (!ward) {
        return {
            error: 'Ward not found',
            council_name: councilName,
            ward_name: normalizedWardName,
            hint: 'Ward name not recognized. Live data unavailable; knowledge-base ward data may be stale.',
            available_wards: allWards.map(w => w.name).filter(Boolean).sort()
        };
    }

    return {
        council: councilName,
        ward_name: ward.name,
        ward_id: ward.id,
        note: 'Ward data from knowledge base. Live ModernGov data not available.',
        source: 'knowledge_base'
    };
}

module.exports = { getCouncillorsByWard };
