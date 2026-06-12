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

// Elements that establish a visual text boundary. Used so extracted text
// keeps block structure ("Example Domain\nThis domain…") instead of
// concatenating ("Example DomainThis domain…") — downstream models need
// the boundaries to comprehend the content.
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'BUTTON', 'DD', 'DIV',
  'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LEGEND', 'LI',
  'MAIN', 'NAV', 'OL', 'OPTION', 'P', 'PRE', 'SECTION', 'SELECT',
  'TABLE', 'TD', 'TH', 'TR', 'UL',
]);

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'SVG']);

/**
 * Extracts visible text from a DOM subtree with block-aware boundaries:
 * block-level elements contribute newlines, inline flow contributes spaces.
 */
function blockAwareText(root) {
  const parts = [];

  (function walk(node) {
    if (node.nodeType === 3) { // text node
      parts.push(node.textContent);
      return;
    }
    if (node.nodeType !== 1) return; // elements only beyond here

    const tag = node.tagName;
    if (SKIP_TAGS.has(tag)) return;

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) parts.push('\n');
    for (const child of node.childNodes) walk(child);
    if (isBlock) parts.push('\n');
  })(root);

  return parts.join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Builds a short CSS-ish descriptor for an element: tag#id or tag.class.
 */
function elementDescriptor(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const firstClass = el.classList && el.classList[0];
  return firstClass ? `${tag}.${firstClass}` : tag;
}

module.exports = { truncate, STYLE_WHITELIST, blockAwareText, elementDescriptor };
