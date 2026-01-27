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

    // Determine agenda status and provide helpful context
    const agendaPublished = result.details?.agenda_published || false;
    const agendaItems = result.agenda || [];
    const hasAgenda = agendaItems.length > 0;

    let agendaStatus = {};
    if (hasAgenda) {
        agendaStatus = {
            status: 'available',
            item_count: agendaItems.length,
            note: 'Agenda is published and available'
        };
    } else if (!agendaPublished) {
        // Parse meeting date to determine if it's future or past
        const meetingDate = result.details?.date;
        let timeContext = '';
        if (meetingDate) {
            try {
                // UK date format: DD/MM/YYYY
                const [day, month, year] = meetingDate.split('/');
                const parsedDate = new Date(year, month - 1, day);
                const now = new Date();
                timeContext = parsedDate > now ? ' (meeting is scheduled for the future)' : ' (meeting has occurred)';
            } catch (e) {
                // Ignore date parsing errors
            }
        }

        agendaStatus = {
            status: 'not_published',
            item_count: 0,
            reason: 'Agenda has not been published yet',
            note: `The agenda for this meeting has not been published${timeContext}. Check the web page for updates or contact the council for the expected publication date.`,
            suggestion: 'Agendas are typically published 5 working days before the meeting date (as per UK Local Authority regulations)'
        };
    } else {
        // Published flag is true but no items - possible scrape failure or genuinely empty
        agendaStatus = {
            status: 'published_but_empty',
            item_count: 0,
            reason: 'Agenda is marked as published but no items were returned',
            note: 'This could indicate a data retrieval issue or the agenda may have no formal items. Check the web page directly.',
            suggestion: 'View the meeting page to verify if agenda items are visible there'
        };
    }

    return {
        council: councilName,
        meeting_id: parsedMeetingId,
        details: result.details || null,
        agenda: agendaItems,
        agenda_status: agendaStatus,
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
