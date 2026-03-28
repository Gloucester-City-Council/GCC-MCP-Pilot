/**
 * Get Meetings Tool
 * Returns scheduled meetings for a committee in a Gloucestershire council
 */

const moderngovClient = require('../moderngov-client');
const councilConfig = require('../council-config');
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function formatUkDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function parseDateInput(input) {
    if (!input) return null;

    const value = String(input).trim().toLowerCase();
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (value === 'today') return new Date(now);
    if (value === 'yesterday') return new Date(now.getTime() - DAY_IN_MS);
    if (value === 'tomorrow') return new Date(now.getTime() + DAY_IN_MS);

    const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!dateRegex.test(value)) return null;

    const [dd, mm, yyyy] = value.split('/').map(Number);
    const parsed = new Date(yyyy, mm - 1, dd);

    // Reject impossible dates (e.g. 31/02/2026)
    if (
        parsed.getFullYear() !== yyyy ||
        parsed.getMonth() !== (mm - 1) ||
        parsed.getDate() !== dd
    ) {
        return null;
    }

    return parsed;
}

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

    const committeeIdString = String(committeeId).trim();
    if (!/^\d+$/.test(committeeIdString)) {
        return {
            error: 'Invalid committee_id',
            hint: 'committee_id must be a valid integer'
        };
    }

    const parsedCommitteeId = parseInt(committeeIdString, 10);
    if (parsedCommitteeId <= 0) {
        return {
            error: 'Invalid committee_id',
            hint: 'committee_id must be greater than 0'
        };
    }

    const parsedFromDate = parseDateInput(fromDate);
    if (fromDate && !parsedFromDate) {
        return {
            error: 'Invalid from_date format',
            hint: 'Date must be DD/MM/YYYY, or one of: today, yesterday, tomorrow'
        };
    }

    const parsedToDate = parseDateInput(toDate);
    if (toDate && !parsedToDate) {
        return {
            error: 'Invalid to_date format',
            hint: 'Date must be DD/MM/YYYY, or one of: today, yesterday, tomorrow'
        };
    }

    if (parsedFromDate) {
        fromDate = formatUkDate(parsedFromDate);
    }

    // ModernGov treats end date as exclusive, so shift to_date by +1 day to preserve
    // intuitive inclusive behavior for users.
    if (parsedToDate) {
        const exclusiveToDate = new Date(parsedToDate.getTime() + DAY_IN_MS);
        toDate = formatUkDate(exclusiveToDate);
    }

    // Get meetings from ModernGov
    let result;
    try {
        result = await moderngovClient.getMeetings(councilName, parsedCommitteeId, fromDate, toDate);
    } catch (e) {
        return {
            error: 'Failed to retrieve meetings',
            status_code: 503,
            council: councilName,
            committee_id: parsedCommitteeId,
            hint: 'The ModernGov API is temporarily unavailable. Please try again or use list_committees to verify the committee ID.',
            error_detail: e.message
        };
    }

    // Enrich each meeting with web links and additional context
    const enrichedMeetings = (result.meetings || []).map(meeting => {
        const meetingId = meeting.id;
        const webPageUrl = `${council.url}/ieListDocuments.aspx?MId=${meetingId}`;
        const calendarIcsUrl = `${council.url}/ieListMeetings.aspx?MeetingId=${meetingId}&ical=1&lookahead=0&mode=export`;

        return {
            ...meeting,
            links: {
                web_page: webPageUrl,
                calendar_ics: calendarIcsUrl
            }
        };
    });

    return {
        council: councilName,
        committee_id: parsedCommitteeId,
        date_range: {
            from: fromDate || 'not specified',
            to: toDate || 'not specified'
        },
        meetings: enrichedMeetings,
        total_count: enrichedMeetings.length,
        note: 'Each meeting includes direct links to the web page and calendar export (ICS format)'
    };
}

module.exports = { getMeetings };
