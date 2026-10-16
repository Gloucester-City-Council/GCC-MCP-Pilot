/**
 * Document review stamps. Dates are always written out ("16 Apr 2027"),
 * never as relative phrases.
 */

'use strict';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

function parseIsoDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        throw new Error(`Date "${s}" must be YYYY-MM-DD.`);
    }
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
        throw new Error(`Date "${s}" is not a real calendar date.`);
    }
    return d;
}

function formatDate(d) {
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function reviewedStamp(isoDate) {
    return { label: 'Reviewed', message: formatDate(parseIsoDate(isoDate)), color: 'blue' };
}

/** Green until warnDays before the due date, amber inside that window, red once past. */
function dueStamp(isoDue, warnDays = 30, now = new Date()) {
    const due = parseIsoDate(isoDue);
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const daysRemaining = Math.round((due.getTime() - today.getTime()) / DAY_MS);
    const date = formatDate(due);
    if (daysRemaining < 0) {
        return { label: 'Review due', message: `overdue since ${date}`, color: 'red', daysRemaining };
    }
    return {
        label: 'Review due',
        message: date,
        color: daysRemaining <= warnDays ? 'orange' : 'brightgreen',
        daysRemaining,
    };
}

module.exports = { parseIsoDate, formatDate, reviewedStamp, dueStamp };
