/**
 * Get Meeting Details Tool
 * Returns detailed information about a specific meeting
 */

const moderngovClient = require('../moderngov-client');

/**
 * Get detailed information about a specific meeting
 *
 * @param {number} meetingId - Meeting ID from ModernGov
 * @returns {Promise<object>} Meeting details including agenda and documents
 */
async function getMeetingDetails(meetingId) {
    // Validate meeting ID
    if (typeof meetingId !== 'number' && typeof meetingId !== 'string') {
        return {
            error: 'Invalid meeting_id',
            hint: 'meeting_id must be a number. Use get_meetings to find valid IDs.'
        };
    }

    const parsedMeetingId = parseInt(meetingId, 10);
    if (isNaN(parsedMeetingId)) {
        return {
            error: 'Invalid meeting_id',
            hint: 'meeting_id must be a valid integer'
        };
    }

    // Get meeting details from ModernGov (currently stub data)
    const result = await moderngovClient.getMeeting(parsedMeetingId);

    return {
        meeting_id: parsedMeetingId,
        details: result.details || null,
        agenda: result.agenda || [],
        documents: result.documents || [],
        attendees: result.attendees || [],
        decisions: result.decisions || [],
        note: result.note || 'Data retrieved from ModernGov API',
        council: 'Gloucester City Council',
        links: {
            web_page: `https://democracy.gloucester.gov.uk/ieListDocuments.aspx?MId=${parsedMeetingId}`,
            note: 'Web page link is a standard format - verify meeting exists'
        }
    };
}

module.exports = { getMeetingDetails };
