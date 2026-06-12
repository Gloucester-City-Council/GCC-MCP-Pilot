'use strict';

// Shared utilities — kept small, no browser or DOM dependencies.

const STYLE_WHITELIST = [
  'display', 'visibility', 'opacity', 'position', 'zIndex', 'overflow',
  'color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight',
  'letterSpacing', 'wordSpacing', 'textAlign', 'textDecoration',
  'outline', 'outlineColor', 'outlineWidth', 'outlineStyle',
  'boxShadow', 'width', 'height', 'minWidth', 'minHeight',
  'pointerEvents', 'cursor',
];

function truncate(str, maxChars) {
  if (!str || str.length <= maxChars) return str;
  return str.substring(0, maxChars);
}

module.exports = { truncate, STYLE_WHITELIST };
