'use strict';

function evaluationGovernance({ jsExecuted = false, cssApplied = false } = {}) {
  return {
    finding_classification: 'not_tested',
    scope: 'jsdom_dom_evaluation',
    engine: 'jsdom + axe-core',
    claim_boundary: {
      can_claim: [
        'axe-core reported the listed automatically detectable violations for this HTML/CSS evaluation.',
        'The page model reflects the DOM state after CSS application' +
          (jsExecuted ? ' and JavaScript execution.' : ' without JavaScript execution.'),
      ],
      cannot_claim: [
        'Do not say the page is WCAG compliant.',
        'Do not say the page is fully accessible.',
        'Do not say colour contrast has been definitively checked — background stacking requires manual or browser review.',
        'Do not say dynamic interactions have been tested.',
      ],
    },
    limitations: [
      'Background colour stacking through the visual hierarchy is not computed. ' +
        'Colour contrast elements are surfaced in accessibility_mcp_handoff for the accessibility MCP to assess.',
      jsExecuted
        ? 'JavaScript was executed but some browser APIs (layout, IntersectionObserver, etc.) are absent in jsdom.'
        : 'JavaScript was not executed. Dynamic content injected by JS is not present in this evaluation.',
      'Focus order, keyboard navigation, and interaction states require manual or browser-based testing.',
    ],
  };
}

function selectorGovernance(matchCount) {
  return {
    scope: 'jsdom_selector_inspection',
    claim_boundary: {
      can_claim: [`Selector matched ${matchCount} node(s) in the stored evaluation.`],
      cannot_claim: [
        'Do not say interaction behaviour has been verified.',
        'Do not say layout dimensions are accurate — jsdom has no layout engine.',
      ],
    },
  };
}

function errorGovernance(scope) {
  return {
    finding_classification: 'not_tested',
    scope: scope || 'jsdom_dom_evaluation',
    claim_boundary: {
      can_claim: ['The evaluation did not complete.'],
      cannot_claim: ['Do not make accessibility claims from a failed evaluation.'],
    },
  };
}

module.exports = { evaluationGovernance, selectorGovernance, errorGovernance };
