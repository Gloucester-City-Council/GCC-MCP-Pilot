'use strict';

const { elementDescriptor } = require('./extraction');

const COLOUR_PROPERTIES = ['color', 'background-color', 'background', 'border-color', 'outline-color'];
const FONT_PROPERTIES = ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'word-spacing'];

// css-tree is optional — if absent, colour analysis is skipped.
let csstree = null;
function getCssTree() {
  if (csstree !== null) return csstree;
  try { csstree = require('css-tree'); } catch { csstree = undefined; }
  return csstree;
}

/**
 * Parses CSS and extracts all colour-relevant declarations.
 * Used to build the css_colour_declarations payload for the accessibility MCP.
 *
 * @param {string} cssString
 * @param {string} source - where the CSS came from: 'linked_stylesheet',
 *   'supplied_css', or 'inline_style_block'
 * Returns array of { source, selector, property, value }.
 * Returns [] if css-tree is not available or CSS is unparseable.
 */
function extractColourDeclarations(cssString, source = 'linked_stylesheet') {
  return extractDeclarations(cssString, COLOUR_PROPERTIES, source);
}

/**
 * Extracts font/text-spacing declarations — useful for AAA visual
 * presentation and text spacing checks.
 */
function extractFontDeclarations(cssString, source = 'linked_stylesheet') {
  return extractDeclarations(cssString, FONT_PROPERTIES, source);
}

function extractDeclarations(cssString, properties, source) {
  if (!cssString) return [];
  const ct = getCssTree();
  if (!ct) return [];

  try {
    const ast = ct.parse(cssString, { parseRulePrelude: true, onParseError: () => {} });
    const results = [];

    ct.walk(ast, node => {
      if (node.type !== 'Rule') return;

      let selector = '';
      try { selector = ct.generate(node.prelude); } catch { return; }

      node.block.children.forEach(decl => {
        if (decl.type !== 'Declaration') return;
        if (!properties.includes(decl.property)) return;
        try {
          results.push({ source, selector, property: decl.property, value: ct.generate(decl.value) });
        } catch { /* skip unparseable value */ }
      });
    });

    return results;
  } catch {
    return [];
  }
}

/**
 * Scans elements carrying a style="" attribute and extracts colour and
 * font declarations from them. These never appear in any stylesheet, so
 * they need their own pass for the accessibility MCP handoff.
 *
 * Returns { colour: [...], font: [...] } with entries shaped like the
 * stylesheet declarations but sourced 'style_attribute' and selectored by
 * an element descriptor (tag#id / tag.class).
 */
function extractStyleAttributeDeclarations(document, maxElements = 200) {
  const colour = [];
  const font = [];

  let elements;
  try { elements = Array.from(document.querySelectorAll('[style]')).slice(0, maxElements); }
  catch { return { colour, font }; }

  for (const el of elements) {
    const styleText = el.getAttribute('style') || '';
    const selector = elementDescriptor(el);

    for (const chunk of styleText.split(';')) {
      const idx = chunk.indexOf(':');
      if (idx === -1) continue;
      const property = chunk.slice(0, idx).trim().toLowerCase();
      const value = chunk.slice(idx + 1).trim();
      if (!value) continue;

      if (COLOUR_PROPERTIES.includes(property)) {
        colour.push({ source: 'style_attribute', selector, property, value });
      } else if (FONT_PROPERTIES.includes(property)) {
        font.push({ source: 'style_attribute', selector, property, value });
      }
    }
  }

  return { colour, font };
}

module.exports = { extractColourDeclarations, extractFontDeclarations, extractStyleAttributeDeclarations };

