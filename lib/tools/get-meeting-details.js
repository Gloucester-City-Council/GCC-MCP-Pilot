/**
 * Get Meeting Details Tool
 * Returns detailed information about a specific meeting in a Gloucestershire council
 */

const moderngovClient = require('../moderngov-client');
const councilConfig = require('../council-config');

/**
 * Get detailed information about a specific meeting
 *
 * @param {string} councilName - Council name
 * @param {number} meetingId - Meeting ID from ModernGov
 * @returns {Promise<object>} Meeting details including agenda and documents
 */
async function getMeetingDetails(councilName, meetingId) {
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

    // Get meeting details from ModernGov
    const result = await moderngovClient.getMeeting(councilName, parsedMeetingId);

    const webPageUrl = `${council.url}/ieListDocuments.aspx?MId=${parsedMeetingId}`;

    return {
        council: councilName,
        meeting_id: parsedMeetingId,
        details: result.details || null,
        agenda: result.agenda || [],
        documents: result.documents || [],
        attendees: result.attendees || [],
        decisions: result.decisions || [],
        note: result.note || 'Data retrieved from ModernGov API',
        links: {
            web_page: webPageUrl,
            note: 'Web page link is a standard format - verify meeting exists'
        },
        // Democratic data integrity metadata
        data_classification: 'official_record',
        is_official_record: true,
        source: {
            system: 'ModernGov',
            council: councilName,
            url: webPageUrl
        },
        official_content_guidance: {
            verbatim_required: [
                'decisions',
                'recommendations',
                'resolutions',
                'motions'
            ],
            may_summarize: [
                'agenda item titles',
                'document descriptions',
                'attendee lists'
            ],
            note: 'When presenting official decisions or recommendations, quote verbatim and include source link. Clearly separate official record from interpretation.'
        }
    };
}

module.exports = { getMeetingDetails };
