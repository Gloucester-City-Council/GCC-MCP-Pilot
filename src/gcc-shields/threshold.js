/**
 * Colour selection from threshold bands. A band applies when value >= from.
 */

'use strict';

const DEFAULT_BANDS = [
    { from: 90, color: 'brightgreen' },
    { from: 70, color: 'yellow' },
    { from: 0, color: 'red' },
];

function pickColour(value, bands = DEFAULT_BANDS, fallback = 'lightgrey') {
    if (!Number.isFinite(value)) return fallback;
    const hit = [...bands].sort((a, b) => b.from - a.from).find((b) => value >= b.from);
    return hit ? hit.color : fallback;
}

module.exports = { DEFAULT_BANDS, pickColour };
