/**
 * Get Meetings Tool
 * Returns scheduled meetings for a committee in a Gloucestershire council
 */

const moderngovClient = require('../moderngov-client');
const councilConfig = require('../council-config');

/**
 * Get meetings for a specific committee
 *
 * @param {string} councilName - Council name
 * @param {number} committeeId - Committee ID from ModernGov
 * @param {string} fromDate - Start date in DD/MM/YYYY format (optional)
 * @param {string} toDate - End date in DD/MM/YYYY format (optional)
 * @returns {Promise<object>} Meeting information
 */
async function getMeetings(councilName, committeeId, fromDate, toDate) {
    // Validate council name
    if (!councilName) {
        return {
            error: 'council_name is required',
            available_councils: councilConfig.getCouncilNames()
        };
    }

    const council = councilConfig.getCouncil(councilName);
    if (!council) {
        return {
            error: 'Council not found',
            council_name: councilName,
            available_councils: councilConfig.getCouncilNames()
        };
    }

    // Validate committee ID
    if (typeof committeeId !== 'number' && typeof committeeId !== 'string') {
        return {
            error: 'Invalid committee_id',
            hint: 'committee_id must be a number. Use list_committees to find valid IDs.'
        };
    }

    const parsedCommitteeId = parseInt(committeeId, 10);
    if (isNaN(parsedCommitteeId)) {
        return {
            error: 'Invalid committee_id',
            hint: 'committee_id must be a valid integer'
        };
    }

    // Validate date formats if provided (DD/MM/YYYY)
    const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;

    if (fromDate && !dateRegex.test(fromDate)) {
        return {
            error: 'Invalid from_date format',
            hint: 'Date must be in DD/MM/YYYY format (UK format). Example: 01/01/2025'
        };
    }

    if (toDate && !dateRegex.test(toDate)) {
        return {
            error: 'Invalid to_date format',
            hint: 'Date must be in DD/MM/YYYY format (UK format). Example: 31/12/2025'
        };
    }

    // Get meetings from ModernGov
    const result = await moderngovClient.getMeetings(councilName, parsedCommitteeId, fromDate, toDate);

    return {
        council: councilName,
        committee_id: parsedCommitteeId,
        date_range: {
            from: fromDate || 'not specified',
            to: toDate || 'not specified'
        },
        meetings: result.meetings || [],
        total_count: (result.meetings || []).length
    };
}

module.exports = { getMeetings };
