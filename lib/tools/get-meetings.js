/**
 * Get Meetings Tool
 * Returns scheduled meetings for a committee
 */

const moderngovClient = require('../moderngov-client');

/**
 * Get meetings for a specific committee
 *
 * @param {number} committeeId - Committee ID from ModernGov
 * @param {string} fromDate - Start date in DD/MM/YYYY format (optional)
 * @param {string} toDate - End date in DD/MM/YYYY format (optional)
 * @returns {Promise<object>} Meeting information
 */
async function getMeetings(committeeId, fromDate, toDate) {
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
    const result = await moderngovClient.getMeetings(parsedCommitteeId, fromDate, toDate);

    return {
        committee_id: parsedCommitteeId,
        date_range: {
            from: fromDate || 'not specified',
            to: toDate || 'not specified'
        },
        meetings: result.meetings || [],
        total_count: (result.meetings || []).length,
        council: 'Gloucester City Council'
    };
}

module.exports = { getMeetings };
