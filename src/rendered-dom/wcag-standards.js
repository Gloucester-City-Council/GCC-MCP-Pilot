'use strict';

/**
 * Named evaluation standards. A standard selects the axe-core rule tags to
 * run AND produces an honest coverage statement: AAA in particular cannot
 * be reduced to axe tags, so the coverage object says what was automated,
 * what evidence was gathered for human/MCP interpretation, and what needs
 * manual review. The claim boundary is "evidence gathered", never "tested".
 */

const STANDARDS = {
  WCAG_2_1_AA: {
    tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  },
  WCAG_2_2_AA: {
    tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  },
  WCAG_2_2_AAA: {
    tags: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  },
};

function isKnownStandard(standard) {
  return Object.prototype.hasOwnProperty.call(STANDARDS, standard);
}

function tagsForStandard(standard) {
  return STANDARDS[standard] ? [...STANDARDS[standard].tags] : null;
}

/**
 * Builds the coverage object for a standard against an evaluated document.
 * Document is used for cheap applicability checks (e.g. media criteria are
 * not applicable when the page has no audio/video).
 */
function buildCoverage(standard, document) {
  const base = {
    statement: 'This static DOM evaluation has gathered evidence relevant to ' +
      `${standard.replace(/_/g, ' ')} review. It is not a compliance test.`,
    automated: [
      'axe-core rules for the selected tags (see axe.violations / axe.incomplete / axe.passes_count)',
    ],
    partially_automated: [],
    manual_required: [],
    not_applicable: [],
  };

  if (standard !== 'WCAG_2_2_AAA') {
    base.manual_required.push(
      'Keyboard interaction, focus order, dynamic state changes, and visual layout require browser-based or manual review.'
    );
    return base;
  }

  let hasMedia = false;
  try { hasMedia = document.querySelectorAll('video, audio').length > 0; } catch { /* default false */ }

  base.automated = [
    '1.4.6 Contrast (Enhanced) — axe color-contrast-enhanced runs; results land in axe.incomplete in jsdom, with declared colours surfaced in elements_for_contrast_review',
    '2.2.4 Interruptions — axe meta-refresh-no-exceptions',
    'All A/AA automatable rules for the included tags',
  ];

  base.partially_automated = [
    '1.4.8 Visual Presentation — css_font_declarations (line-height, letter/word spacing, font-size) and computed styles are gathered; column width and justification need visual review',
    '2.4.9 Link Purpose (Link Only) — every link\'s text and accessible name is in page_model.links for interpretation',
    '2.5.5 Target Size (Enhanced) — declared width/height retrievable via inspect_dom_selector; no layout engine, so rendered size is not computed',
  ];

  base.manual_required = [
    '1.3.6 Identify Purpose',
    '2.1.3 Keyboard (No Exception)',
    '2.2.3 No Timing',
    '2.3.2 Three Flashes / 2.3.3 Animation from Interactions',
    '2.4.8 Location',
    '3.1.3 Unusual Words / 3.1.4 Abbreviations / 3.1.5 Reading Level / 3.1.6 Pronunciation — visible_text_excerpt provides the text evidence',
    '3.3.5 Help',
    '3.3.6 Error Prevention (All)',
    '3.3.9 Accessible Authentication (Enhanced)',
  ];

  const mediaCriteria = '1.2.6 Sign Language / 1.2.7 Extended Audio Description / 1.2.8 Media Alternative / 1.2.9 Audio-only (Live)';
  if (hasMedia) {
    base.manual_required.push(`${mediaCriteria} — media elements present on this page`);
  } else {
    base.not_applicable.push(`${mediaCriteria} — no audio/video elements found in the evaluated DOM`);
  }

  return base;
}

module.exports = { STANDARDS, isKnownStandard, tagsForStandard, buildCoverage };
