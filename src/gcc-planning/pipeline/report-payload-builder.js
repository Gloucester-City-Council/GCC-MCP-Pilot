/**
 * ReportPayloadBuilder
 *
 * Builds a structured narrative payload from a completed assessment result.
 * Output is consumed by an AI client to render a grounded report.
 * Per plan Section 8: client-agnostic payload with grounding rules.
 *
 * Report styles (plan Section 8.1):
 *   officer_determination | preapp_advice | validation_request | officer_note | committee_summary
 *
 * Grounding rules (plan Section 8.3):
 *   1. Only state outcomes present in the result.
 *   2. Attribute thresholds using threshold_status.
 *   3. Calibrate language to legal_basis.
 *   4. Separate validation from merits.
 *   5. Lead with data quality issues if conflicted or insufficient.
 *   6. Where officer_judgement_required = true, describe; do not conclude.
 *   7. Distinguish statutory BNG exemption from local B11.
 *   8. When merits are advisory-only, do not use settled-outcome language.
 */

'use strict';

// ─── Style templates ──────────────────────────────────────────────────────────
const STYLE_TEMPLATES = {
    officer_determination: {
        sections: [
            'data_quality_preamble',
            'site_and_proposal',
            'validation_summary',
            'planning_merits_summary',
            'heritage_section',
            'consultations',
            'cil_note',
            'recommendation',
            'conditions_and_informatives',
        ],
        language_register: 'formal_officer',
        include_rule_citations: true,
    },
    preapp_advice: {
        sections: [
            'data_quality_preamble',
            'site_and_proposal',
            'validation_summary',
            'planning_merits_summary',
            'heritage_section',
            'consultations',
            'pre_application_caveats',
        ],
        language_register: 'advisory',
        include_rule_citations: true,
    },
    validation_request: {
        sections: [
            'validation_summary',
            'missing_documents',
            'next_steps',
        ],
        language_register: 'administrative',
        include_rule_citations: false,
    },
    officer_note: {
        sections: [
            'data_quality_preamble',
            'planning_merits_summary',
            'manual_review_items',
        ],
        language_register: 'internal_note',
        include_rule_citations: true,
    },
    committee_summary: {
        sections: [
            'site_and_proposal',
            'planning_merits_summary',
            'heritage_section',
            'consultations',
            'recommendation',
        ],
        language_register: 'committee',
        include_rule_citations: false,
    },
};

// ─── Grounding rules (plan Section 8.3) ──────────────────────────────────────
const GROUNDING_RULES = [
    'Only state outcomes and conclusions that are present in the result object. Do not infer, extrapolate, or add planning judgement beyond what the result records.',
    'When stating thresholds, cite the threshold_status field: confirmed, unconfirmed, or case_by_case. Never present a locally-applied threshold as if it were an adopted standard unless policy_source_status = "adopted".',
    'Calibrate language to the legal_basis of each rule or requirement: statutory constraints use mandatory language; development_plan_policy uses strong policy language; local_practice uses cautionary language.',
    'Keep validation outcomes and planning merits in separate, clearly labelled sections. Do not conflate the two.',
    'If data_quality.status is conflicted or insufficient, the report must open with a prominent advisory note about data limitations before any merits content.',
    'Where officer_judgement_required = true for any rule, describe the issue and the applicable policy test. Do not conclude on the outcome.',
    'When referring to biodiversity: distinguish the statutory mandatory BNG regime (which householder applications are exempt from) from the local B11 Biodiversity Small Sites Statement requirement (which applies to householder applications as a local validation expectation).',
    'When planning_merits.advisory_only = true: do not use settled-outcome language. Do not say "the proposal complies" or "the extension is acceptable". Use: "based on the available information (noting [issue]), the proposal would appear to [outcome]". Prefix any merits section with a caveat paragraph.',
];

const ANTI_PATTERNS_ADVISORY = [
    '"the proposal complies" → use "the proposal would appear to comply, noting [caveat]"',
    '"the extension is acceptable" → use "the extension would appear to be acceptable, subject to [caveat]"',
    '"likely to be approved" → use "likely_support is indicated, noting advisory-only status"',
    '"will be refused" → use "likely_refusal is indicated based on available information"',
];

/**
 * Build a report payload from a completed assessment result.
 *
 * @param {object} result       Complete assessment result object
 * @param {string} reportStyle  One of the five style values
 * @param {object} overrides    Optional: { include_rule_citations, language_register }
 * @returns {object}  Payload for AI client consumption
 */
function build(result, reportStyle, overrides) {
    reportStyle = reportStyle || 'officer_determination';
    const template = STYLE_TEMPLATES[reportStyle] || STYLE_TEMPLATES.officer_determination;

    const isAdvisory = result.planning_merits && result.planning_merits.advisory_only;
    const dqStatus   = result.data_quality && result.data_quality.status;
    const dm         = result.recommendation && result.recommendation.decision_mode;

    // System instruction (constant across all styles)
    const systemInstruction = buildSystemInstruction(isAdvisory, dqStatus, reportStyle);

    // Style template (sections to include)
    const styleTemplate = {
        report_style: reportStyle,
        sections: template.sections,
        language_register: (overrides && overrides.language_register) || template.language_register,
        include_rule_citations: (overrides && overrides.include_rule_citations !== undefined)
            ? overrides.include_rule_citations
            : template.include_rule_citations,
    };

    // Assessment data (grounded in the result)
    const assessmentData = buildAssessmentData(result);

    // Formatting rules
    const formattingRules = buildFormattingRules(reportStyle, isAdvisory, dm);

    return {
        system_instruction: systemInstruction,
        style_template:     styleTemplate,
        assessment_data:    assessmentData,
        formatting_rules:   formattingRules,
        grounding_rules:    GROUNDING_RULES,
        advisory_anti_patterns: isAdvisory ? ANTI_PATTERNS_ADVISORY : [],
        generated_at: new Date().toISOString(),
        schema_versions: result._schema_versions || {},
    };
}

// ─── Payload section builders ─────────────────────────────────────────────────

function buildSystemInstruction(isAdvisory, dqStatus, reportStyle) {
    const base = `You are a planning officer assistant generating a structured planning assessment report for Gloucester City Council.
Your report must be grounded exclusively in the assessment_data provided. Do not add planning judgement, cite policies not referenced in the data, or speculate about outcomes.
Apply the grounding_rules exactly. Apply the formatting_rules for the ${reportStyle} report style.`;

    const advisoryNote = isAdvisory
        ? `\nIMPORTANT: The planning merits assessment is ADVISORY ONLY. Data quality issues were detected. You MUST NOT use settled-outcome language (see advisory_anti_patterns). Every merits section must be prefaced with a caveat paragraph.`
        : '';

    const dqNote = (dqStatus === 'conflicted' || dqStatus === 'insufficient')
        ? `\nWARNING: Data quality status is "${dqStatus}". The report must open with a prominent advisory note about data limitations.`
        : '';

    return base + advisoryNote + dqNote;
}

function buildAssessmentData(result) {
    return {
        case_reference:  result.case_reference,
        address:         result.address,
        assessment_date: result.assessment_date,
        route:           result.scope && result.scope.application_route,
        modules_applied: result.scope && result.scope.modules_applied,
        data_quality: {
            status: result.data_quality && result.data_quality.status,
            issues: result.data_quality && result.data_quality.issues,
        },
        validation: {
            status:          result.validation && result.validation.status,
            requirements:    result.validation && result.validation.requirements,
            blocking_issues: result.validation && result.validation.blocking_issues,
        },
        planning_merits: {
            status:              result.planning_merits && result.planning_merits.status,
            advisory_only:       result.planning_merits && result.planning_merits.advisory_only,
            advisory_caveat:     result.planning_merits && result.planning_merits.advisory_caveat,
            rule_outcomes:       result.planning_merits && result.planning_merits.rule_outcomes,
            manual_review_flags: result.planning_merits && result.planning_merits.manual_review_flags,
        },
        consultations: result.consultations,
        cil_screening: result.cil_screening,
        recommendation: result.recommendation,
    };
}

function buildFormattingRules(reportStyle, isAdvisory, decisionMode) {
    const rules = [
        'Use clear section headings corresponding to the style_template.sections list.',
        'Include requirement_id / rule_id references where include_rule_citations = true.',
        'State threshold_status alongside any numeric threshold (confirmed / unconfirmed / case_by_case).',
        'Use the decision_mode value from recommendation to frame the overall outcome.',
    ];

    if (reportStyle === 'officer_determination') {
        rules.push('Format as a formal delegated officer report. Use passive or third-person constructions.');
        rules.push('Conditions section: use only conditions from the result. Do not invent conditions.');
    }

    if (reportStyle === 'preapp_advice') {
        rules.push('Frame as pre-application advice. Use constructive, forward-looking language.');
        rules.push('Note that outcomes are advisory and that a formal application is required for a binding decision.');
    }

    if (reportStyle === 'validation_request') {
        rules.push('Focus on missing documents and information only. Do not discuss planning merits.');
        rules.push('List each missing requirement by requirement_id and name with a clear action for the applicant.');
    }

    if (reportStyle === 'committee_summary') {
        rules.push('Format as a committee report summary. Be concise. Use bullet points for key issues.');
    }

    if (isAdvisory) {
        rules.push('ADVISORY MERITS: Prefix every merits section with: "The following assessment is based on currently available information. Data quality limitations mean this assessment is advisory only. A more reliable assessment is possible once [list blocking issues]."');
    }

    if (decisionMode === 'likely_refusal') {
        rules.push('Lead with the refusal reason. Cite the specific rule_id(s) and policy basis for each must/must_not failure.');
    }

    return rules;
}

module.exports = { build };
