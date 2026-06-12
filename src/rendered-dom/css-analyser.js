'use strict';

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
 * Returns array of { selector, property, value }.
 * Returns [] if css-tree is not available or CSS is unparseable.
 */
function extractColourDeclarations(cssString) {
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
        if (!['color', 'background-color', 'background', 'border-color', 'outline-color'].includes(decl.property)) return;
        try {
          results.push({ selector, property: decl.property, value: ct.generate(decl.value) });
        } catch { /* skip unparseable value */ }
      });
    });

    return results;
  } catch {
    return [];
  }
}

/**
 * Extracts font-size declarations — useful for text spacing checks.
 */
function extractFontDeclarations(cssString) {
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
        if (!['font-size', 'font-weight', 'line-height', 'letter-spacing', 'word-spacing'].includes(decl.property)) return;
        try {
          results.push({ selector, property: decl.property, value: ct.generate(decl.value) });
        } catch { /* skip */ }
      });
    });

    return results;
  } catch {
    return [];
  }
}

module.exports = { extractColourDeclarations, extractFontDeclarations };
