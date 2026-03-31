/**
 * Get Gloucester Constitution Tool
 *
 * Gloucester City Council's Constitution is held under committee ID 564 in
 * ModernGov. Each "meeting" in this committee represents a version or amendment
 * of the Constitution, and the attached documents are the constitutional text
 * and associated governance documents.
 *
 * This tool surfaces those documents without requiring the caller to know the
 * internal committee ID or navigate the meeting structure manually.
 */

const moderngovClient = require('../moderngov-client');
const councilConfig = require('../council-config');

const GLOUCESTER_COUNCIL_NAME = 'Gloucester City Council';
const CONSTITUTION_COMMITTEE_ID = 564;

// Broad date range to capture all historic and future constitution versions
const DEFAULT_FROM_DATE = '01/01/2000';
const DEFAULT_TO_DATE = '31/12/2099';

/**
 * Get the Gloucester City Council Constitution and associated documents.
 *
 * @param {object} options
 * @param {boolean} [options.include_documents=false] - When true, fetches full
 *   meeting details for every constitution meeting to include attached documents.
 *   This makes multiple API calls and may be slower.
 * @returns {Promise<object>} Constitution meetings and optional document details.
 */
async function getGloucesterConstitution({ include_documents = false } = {}) {
    const council = councilConfig.getCouncil(GLOUCESTER_COUNCIL_NAME);
    if (!council) {
        return {
            error: 'Gloucester City Council configuration not found',
            hint: 'This is an internal configuration error - please raise an issue.'
        };
    }

    // Fetch all meetings for the Constitution committee
    let meetingsResult;
    try {
        meetingsResult = await moderngovClient.getMeetings(
            GLOUCESTER_COUNCIL_NAME,
            CONSTITUTION_COMMITTEE_ID,
            DEFAULT_FROM_DATE,
            DEFAULT_TO_DATE
        );
    } catch (e) {
        return {
            error: 'Failed to retrieve constitution meetings from ModernGov',
            status_code: 503,
            hint: 'The ModernGov API is temporarily unavailable. You can browse the constitution directly at the URL in the links object.',
            links: {
                committee_page: `${council.url}/mgCommitteeDetails.aspx?ID=${CONSTITUTION_COMMITTEE_ID}`,
                meetings_list: `${council.url}/ieListMeetings.aspx?CommitteeId=${CONSTITUTION_COMMITTEE_ID}`
            },
            error_detail: e.message
        };
    }

    const rawMeetings = meetingsResult.meetings || [];

    // Enrich meetings with direct web links
    const meetings = rawMeetings.map(meeting => ({
        ...meeting,
        links: {
            web_page: `${council.url}/ieListDocuments.aspx?MId=${meeting.id}`,
            calendar_ics: `${council.url}/ieListMeetings.aspx?MeetingId=${meeting.id}&ical=1&lookahead=0&mode=export`
        }
    }));

    // Optionally fetch full details (including attached documents) for every meeting
    let meetingsWithDocuments = null;
    if (include_documents && meetings.length > 0) {
        meetingsWithDocuments = await Promise.all(
            meetings.map(async meeting => {
                try {
                    const details = await moderngovClient.getMeeting(
                        GLOUCESTER_COUNCIL_NAME,
                        meeting.id
                    );
                    const agendaItems = details.agenda || [];
                    const documents = agendaItems.flatMap(item =>
                        (item.linked_documents || []).map(doc => ({
                            ...doc,
                            agenda_item_id: item.id,
                            agenda_item_title: item.title
                        }))
                    );
                    return {
                        ...meeting,
                        agenda: agendaItems,
                        documents
                    };
                } catch (e) {
                    return {
                        ...meeting,
                        documents_error: `Failed to fetch documents: ${e.message}`
                    };
                }
            })
        );
    }

    const committeePageUrl = `${council.url}/mgCommitteeDetails.aspx?ID=${CONSTITUTION_COMMITTEE_ID}`;
    const meetingsListUrl = `${council.url}/ieListMeetings.aspx?CommitteeId=${CONSTITUTION_COMMITTEE_ID}`;

    return {
        council: GLOUCESTER_COUNCIL_NAME,
        committee: {
            id: CONSTITUTION_COMMITTEE_ID,
            title: 'Constitution',
            category: 'Constitution',
            purpose: 'Maintains and oversees the Council\'s Constitution and associated governance arrangements, ensuring it remains current and fit for purpose.',
            links: {
                committee_page: committeePageUrl,
                meetings_list: meetingsListUrl
            }
        },
        meetings: meetingsWithDocuments || meetings,
        total_meetings: meetings.length,
        include_documents,
        note: include_documents
            ? 'Full meeting details and attached documents are included. Each document URL can be passed to analyze_meeting_document or get_attachment for further analysis.'
            : 'Set include_documents=true to fetch attached documents for each meeting. Each meeting\'s web_page link goes directly to its documents.',
        // Democratic data integrity metadata
        data_classification: 'official_record',
        is_official_record: true,
        source: {
            system: 'ModernGov',
            council: GLOUCESTER_COUNCIL_NAME,
            committee_id: CONSTITUTION_COMMITTEE_ID,
            url: committeePageUrl
        },
        official_content_guidance: {
            verbatim_required: [
                'constitutional provisions',
                'procedural rules',
                'delegated authority',
                'standing orders'
            ],
            note: 'The Constitution is a statutory document. Any constitutional text, rules, or provisions must be quoted verbatim and linked to the source document. Do not paraphrase constitutional provisions.'
        }
    };
}

module.exports = { getGloucesterConstitution };
