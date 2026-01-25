/**
 * Get Councillors Tool
 * Returns ward councillors for a given postcode
 */

const moderngovClient = require('../moderngov-client');

/**
 * Get councillors who represent a given postcode
 *
 * @param {string} postcode - UK postcode to look up
 * @returns {Promise<object>} Councillor information
 */
async function getCouncillors(postcode) {
    // Normalize postcode (uppercase, trim whitespace)
    const normalizedPostcode = postcode.toUpperCase().trim();

    // Validate postcode format (basic check)
    const postcodeRegex = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
    if (!postcodeRegex.test(normalizedPostcode)) {
        return {
            error: 'Invalid postcode format',
            postcode: normalizedPostcode,
            hint: 'Please provide a valid UK postcode (e.g., "GL1 1AA")'
        };
    }

    // Get councillors from ModernGov (currently stub data)
    const result = await moderngovClient.getCouncillorsByPostcode(normalizedPostcode);

    return {
        postcode: normalizedPostcode,
        councillors: result.councillors || [],
        ward: result.ward || null,
        note: result.note || 'Data retrieved from ModernGov API',
        council: 'Gloucester City Council'
    };
}

module.exports = { getCouncillors };
