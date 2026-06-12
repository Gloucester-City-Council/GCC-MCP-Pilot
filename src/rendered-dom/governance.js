'use strict';

function renderedSnapshotGovernance() {
  return {
    finding_classification: 'not_tested',
    scope: 'headless_browser_rendered_snapshot',
    claim_boundary: {
      can_claim: [
        'A headless Chromium rendered snapshot was captured for this URL.',
        'The page model summarises the rendered DOM state at capture time.',
      ],
      cannot_claim: [
        'Do not say this represents all users or browser environments.',
        'Do not say the page is accessible.',
        'Do not say a full accessibility audit has been completed.',
      ],
    },
    limitations: [
      'Captured in a fresh unauthenticated headless browser context.',
      'Dynamic content may vary by cookies, geography, time, feature flags, or network state.',
      'Not a substitute for manual keyboard or assistive technology testing.',
    ],
  };
}

function selectorFragmentGovernance(matchCount) {
  return {
    scope: 'rendered_selector_fragment',
    claim_boundary: {
      can_claim: [
        `This selector matched ${matchCount} rendered node(s) in the captured snapshot.`,
      ],
      cannot_claim: [
        'Do not say the whole page has been tested.',
        'Do not say interaction behaviour has been verified without an interaction trace.',
      ],
    },
  };
}

function ariaSnapshotGovernance() {
  return {
    scope: 'aria_snapshot',
    claim_boundary: {
      can_claim: ['An ARIA accessibility snapshot was captured for the selected rendered content.'],
      cannot_claim: [
        'Do not say a screen reader user experience has been fully tested.',
        'Do not say the component is accessible.',
      ],
    },
    next_evidence_required: [
      'Keyboard navigation test',
      'Screen reader smoke test',
      'Focus order verification',
    ],
  };
}

function accessibilityScanGovernance() {
  return {
    scope: 'automated_accessibility_scan',
    claim_boundary: {
      can_claim: [
        'axe-core reported the listed automatically detectable violations for this rendered snapshot.',
      ],
      cannot_claim: [
        'Do not say the page is WCAG compliant.',
        'Do not say the page is fully accessible.',
        'Do not say manual testing is unnecessary.',
        'Do not say no WCAG issues exist beyond the automated scan.',
      ],
    },
    limitations: [
      'Automated scans detect only a subset of WCAG violations.',
      'Manual keyboard, screen reader, and user testing are still required.',
    ],
  };
}

function interactionSnapshotGovernance() {
  return {
    scope: 'scripted_interaction_snapshot',
    claim_boundary: {
      can_claim: ['The scripted interaction completed in the headless browser.'],
      cannot_claim: [
        'Do not say all keyboard interactions work.',
        'Do not say assistive technology behaviour has been verified.',
      ],
    },
  };
}

function comparisonGovernance() {
  return {
    scope: 'static_rendered_comparison',
    claim_boundary: {
      can_claim: [
        'The comparison reflects differences between raw HTML source and browser-rendered state.',
      ],
      cannot_claim: [
        'Do not say JS-dependency is an accessibility failure without further testing.',
        'Do not say the page is inaccessible based on this comparison alone.',
      ],
    },
  };
}

function errorGovernance(scope) {
  return {
    finding_classification: 'not_tested',
    scope: scope || 'rendered_browser_snapshot',
    claim_boundary: {
      can_claim: ['The rendered capture did not complete.'],
      cannot_claim: ['Do not make accessibility claims from this failed capture.'],
    },
  };
}

module.exports = {
  renderedSnapshotGovernance,
  selectorFragmentGovernance,
  ariaSnapshotGovernance,
  accessibilityScanGovernance,
  interactionSnapshotGovernance,
  comparisonGovernance,
  errorGovernance,
};
