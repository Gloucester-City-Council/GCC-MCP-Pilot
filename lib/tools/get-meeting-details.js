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

    const meetingIdString = String(meetingId).trim();
    if (!/^\d+$/.test(meetingIdString)) {
        return {
            error: 'Invalid meeting_id',
            hint: 'meeting_id must be a valid integer'
        };
    }

    const parsedMeetingId = parseInt(meetingIdString, 10);
    if (parsedMeetingId <= 0) {
        return {
            error: 'Invalid meeting_id',
            hint: 'meeting_id must be greater than 0'
        };
    }

    // Get meeting details from ModernGov
    let result;
    try {
        result = await moderngovClient.getMeeting(councilName, parsedMeetingId);
    } catch (e) {
        return {
            error: 'Failed to retrieve meeting details',
            status_code: 503,
            council: councilName,
            meeting_id: parsedMeetingId,
            hint: 'The ModernGov API is temporarily unavailable. Please try again or check the council website directly.',
            error_detail: e.message
        };
    }

    const meetingDetails = result.details || null;
    const meetingNotFound =
        !meetingDetails ||
        meetingDetails.id === 0 ||
        meetingDetails.id === null ||
        Number.isNaN(meetingDetails.id) ||
        meetingDetails.id !== parsedMeetingId;

    if (meetingNotFound) {
        return {
            error: 'Meeting not found',
            status_code: 404,
            council: councilName,
            meeting_id: parsedMeetingId,
            hint: 'Use get_meetings to discover valid meeting IDs for this council.'
        };
    }

    const webPageUrl = `${council.url}/ieListDocuments.aspx?MId=${parsedMeetingId}`;

    // Extract documents and decisions from agenda items, since the SOAP
    // GetMeeting response embeds these within each agenda item rather than
    // returning them as separate top-level collections.
    const agendaItems = result.agenda || [];

    const documents = agendaItems.flatMap(item =>
        (item.linked_documents || []).map(doc => ({
            ...doc,
            agenda_item_id: item.id,
            agenda_item_title: item.title
        }))
    );

    const decisions = agendaItems
        .filter(item => item.is_decision && item.decision)
        .map(item => ({
            agenda_item_id: item.id,
            agenda_item_title: item.title,
            decision: item.decision
        }));

    // Determine agenda status and provide helpful context
    const agendaPublished = meetingDetails.agenda_published || false;
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
        const meetingDate = meetingDetails.date;
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
        details: meetingDetails,
        agenda: agendaItems,
        agenda_status: agendaStatus,
        documents: documents,
        attendees: result.attendees || [],
        decisions: decisions,
        note: 'Data retrieved from ModernGov API',
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
