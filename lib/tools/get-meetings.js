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

    const toUkDate = (date) => {
        const pad = n => String(n).padStart(2, '0');
        return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    };

    const parseRelativeDateKeyword = (value) => {
        if (typeof value !== 'string') return null;

        const normalized = value.trim().toLowerCase();
        if (!normalized) return null;

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        if (normalized === 'today') return toUkDate(now);
        if (normalized === 'tomorrow') {
            now.setDate(now.getDate() + 1);
            return toUkDate(now);
        }
        if (normalized === 'yesterday') {
            now.setDate(now.getDate() - 1);
            return toUkDate(now);
        }

        return null;
    };

    // Normalize common relative dates used by MCP clients
    fromDate = parseRelativeDateKeyword(fromDate) || fromDate;
    toDate = parseRelativeDateKeyword(toDate) || toDate;

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

    // ModernGov treats end dates as exclusive, so extend to_date by one day to make
    // it inclusive for users (e.g. 01/01/2026..31/01/2026 includes 31 Jan).
    if (toDate) {
        const [dd, mm, yyyy] = toDate.split('/').map(Number);
        const d = new Date(yyyy, mm - 1, dd);
        d.setDate(d.getDate() + 1);
        toDate = toUkDate(d);
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
