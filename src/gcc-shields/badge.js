/**
 * Shields.io URL building. Pure functions, no I/O.
 */

'use strict';

const BASE = 'https://img.shields.io';
const STYLES = ['flat', 'flat-square', 'plastic', 'for-the-badge', 'social'];

/**
 * Shields static badges use "-" and "_" as separators, so literal ones are
 * doubled, spaces become "_", and everything else is percent-encoded.
 */
function escapeSegment(s) {
    return encodeURIComponent(
        String(s).replace(/-/g, '--').replace(/_/g, '__').replace(/ /g, '_')
    );
}

/** Accepts hex (with or without #) or a plain colour name. Rejects anything else. */
function normaliseColour(c) {
    const v = String(c).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i.test(v)) return v.toLowerCase();
    if (/^[a-z]+$/i.test(v)) return v.toLowerCase();
    throw new Error(`Unrecognised colour "${c}". Use a name like "green" or hex like "2da44e".`);
}

function assertStyle(style) {
    if (style !== undefined && !STYLES.includes(style)) {
        throw new Error(`Unknown style "${style}". Use one of: ${STYLES.join(', ')}.`);
    }
}

function staticBadgeUrl(spec) {
    assertStyle(spec.style);
    const color = normaliseColour(spec.color || 'blue');
    const path = `${BASE}/badge/${escapeSegment(spec.label)}-${escapeSegment(spec.message)}-${color}`;
    const q = new URLSearchParams();
    if (spec.style) q.set('style', spec.style);
    if (spec.logo) q.set('logo', spec.logo);
    if (spec.logoColor) q.set('logoColor', normaliseColour(spec.logoColor));
    if (spec.labelColor) q.set('labelColor', normaliseColour(spec.labelColor));
    const qs = q.toString();
    return qs ? `${path}?${qs}` : path;
}

/** A badge that reads label, message and colour from a JSON document at jsonUrl. */
function endpointBadgeUrl(jsonUrl, style) {
    assertStyle(style);
    const q = new URLSearchParams({ url: jsonUrl });
    if (style) q.set('style', style);
    return `${BASE}/endpoint?${q.toString()}`;
}

function escapeAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Alt text is always "label: message" so the badge is readable without the image. */
function render(url, label, message) {
    const alt = label ? `${label}: ${message}` : String(message);
    return {
        url,
        markdown: `![${alt.replace(/[[\]]/g, '')}](${url})`,
        html: `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}">`,
    };
}

module.exports = { STYLES, escapeSegment, normaliseColour, staticBadgeUrl, endpointBadgeUrl, render };
