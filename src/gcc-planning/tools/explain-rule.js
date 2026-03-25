/**
 * Tool: planning_explain_rule (Phase 2)
 *
 * Explains a planning policy rule, validation requirement, or concept in plain English.
 * Read-only. No recommendation. No facts needed.
 * Per plan Section 5.
 *
 * Supports:
 *   - Rule IDs: A1.1.1, A1.2.1, A1.7.2, etc.
 *   - Requirement IDs: A1, A2, A7, A8, B8, B11, B28, etc.
 *   - Concepts: "45-degree rule", "conservation area", "prior notification", "decision mode", etc.
 *   - Enum types: "processing_state", "decision_mode", "module", etc.
 *   - Assessment tests: "A1.1", "A1.2", etc.
 */

'use strict';

const {
    RULES_BY_ID,
    VALIDATION_REQUIREMENTS_BY_ID,
    ASSESSMENT_TESTS,
    ENUMS,
    MATERIAL_RULES_REGISTER,
    SCHEMA_VERSIONS,
    RULESET,
} = require('../schema-loader');

/**
 * @param {object} args  { topic: string }
 * @returns {object}
 */
function execute(args) {
    const { topic } = args;

    if (!topic || typeof topic !== 'string' || topic.trim().length < 2) {
        return {
            error: 'A "topic" string of at least 2 characters is required.',
            examples: ['A1.2.1', '45-degree rule', 'conservation area', 'decision_mode', 'B28', 'prior notification'],
            schema_versions: SCHEMA_VERSIONS,
        };
    }

    const t = topic.trim();

    // Try exact rule ID match (e.g. A1.2.1)
    const ruleMatch = RULES_BY_ID.get(t);
    if (ruleMatch) return explainAssessmentRule(ruleMatch);

    // Try assessment test ID (e.g. A1.1, A1.2)
    const testMatch = ASSESSMENT_TESTS.find(t2 => t2.test_id === t);
    if (testMatch) return explainAssessmentTest(testMatch);

    // Try validation requirement ID (e.g. A1, B28)
    const reqMatch = VALIDATION_REQUIREMENTS_BY_ID.get(t);
    if (reqMatch) return explainValidationRequirement(t, reqMatch);

    // Try enum type
    if (ENUMS.properties && ENUMS.properties[t]) {
        return explainEnum(t, ENUMS.properties[t]);
    }

    // Try topic keyword matching
    return explainByKeyword(t);
}

// ─── Explainers ───────────────────────────────────────────────────────────────

function explainAssessmentRule(entry) {
    const { rule, test_id, test_name } = entry;
    const isMaterial = MATERIAL_RULES_REGISTER.includes(rule.rule_id);

    const lines = [
        `**Rule ${rule.rule_id}** — ${rule.rule_name}`,
        `*Part of Assessment Test ${test_id}: ${test_name}*`,
        '',
        `**Policy Rationale:** ${rule.policy_rationale || 'Not specified.'}`,
        '',
        `**Severity:** \`${rule.severity}\` — ${severityExplanation(rule.severity)}`,
        `**Legal Basis:** ${rule.legal_basis || 'Not specified'}`,
        `**Effect Type:** ${rule.effect_type || 'planning_merit'}`,
        `**Threshold Status:** ${rule.threshold_status || 'Not specified'}`,
        `**Policy Source Status:** ${rule.policy_source_status || 'Not specified'}`,
    ];

    if (rule.assessment_guidance) {
        lines.push('', `**Assessment Guidance:** ${rule.assessment_guidance}`);
    }

    if (rule.evaluation) {
        lines.push('', '**Automated Evaluation:**');
        lines.push(formatEvaluation(rule.evaluation));
    }

    if (rule.exceptions && rule.exceptions.length > 0) {
        lines.push('', `**Exceptions (${rule.exceptions.length}):**`);
        for (const ex of rule.exceptions) {
            lines.push(`- ${ex.exception_id}: ${ex.description}`);
        }
    }

    if (isMaterial) {
        lines.push('', '⚠️ **Material Rule:** This rule is in the material-rule register. If it returns `cannot_assess`, the overall planning merits status is forced to `cannot_assess` regardless of other rule outcomes.');
    }

    if (rule.suggested_condition_templates && rule.suggested_condition_templates.length > 0) {
        lines.push('', '**Example Condition Template:**');
        lines.push(`> ${rule.suggested_condition_templates[0]}`);
    }

    return {
        rule_id: rule.rule_id,
        rule_name: rule.rule_name,
        test_id,
        test_name,
        explanation: lines.join('\n'),
        is_material_rule: isMaterial,
        severity: rule.severity,
        legal_basis: rule.legal_basis,
        threshold_status: rule.threshold_status,
        schema_versions: SCHEMA_VERSIONS,
    };
}

function explainAssessmentTest(test) {
    const lines = [
        `**Assessment Test ${test.test_id}** — ${test.test_name}`,
        '',
        test.description,
        '',
        `**Assessment Type:** ${test.assessment_type}`,
        `**Rules in this test:** ${test.rules.length}`,
        '',
        '**Rules:**',
        ...test.rules.map(r =>
            `- \`${r.rule_id}\` (${r.severity}): ${r.rule_name}${MATERIAL_RULES_REGISTER.includes(r.rule_id) ? ' ⚠️ [material rule]' : ''}`
        ),
    ];

    return {
        test_id: test.test_id,
        test_name: test.test_name,
        explanation: lines.join('\n'),
        rules: test.rules.map(r => ({ rule_id: r.rule_id, rule_name: r.rule_name, severity: r.severity })),
        schema_versions: SCHEMA_VERSIONS,
    };
}

function explainValidationRequirement(reqId, req) {
    const lines = [
        `**Validation Requirement ${reqId}** — ${req.name || reqId}`,
        '',
    ];

    if (req.policy_driver) lines.push(`**Policy Driver:** ${req.policy_driver}`);
    if (req.policy_drivers) lines.push(`**Policy Drivers:** ${req.policy_drivers.join(', ')}`);
    if (req.legal_basis)    lines.push(`**Legal Basis:** ${req.legal_basis}`);
    if (req.effect_type)    lines.push(`**Effect Type:** ${req.effect_type}`);

    if (req.applies_to)     lines.push('', `**Applies To:** ${req.applies_to}`);
    if (req.trigger)        lines.push('', `**Trigger:** ${JSON.stringify(req.trigger)}`);
    if (req.mandatory !== undefined) lines.push(`**Mandatory:** ${req.mandatory}`);
    if (req.mandatory_when_triggered) lines.push(`**Mandatory When Triggered:** yes`);

    if (req.required_content) {
        lines.push('', '**Required Content:**');
        if (Array.isArray(req.required_content)) {
            for (const item of req.required_content) lines.push(`- ${item}`);
        } else {
            lines.push(req.required_content);
        }
    }

    if (req.notes) {
        lines.push('', '**Notes:**');
        if (Array.isArray(req.notes)) {
            for (const n of req.notes) lines.push(`- ${n}`);
        }
    }

    return {
        requirement_id: reqId,
        name: req.name,
        explanation: lines.join('\n'),
        legal_basis: req.legal_basis,
        effect_type: req.effect_type,
        schema_versions: SCHEMA_VERSIONS,
    };
}

function explainEnum(enumType, def) {
    const lines = [
        `**Enum: \`${enumType}\`**`,
        '',
        def.description || '',
        '',
        `**Allowed values (${def.enum.length}):**`,
        ...def.enum.map(v => `- \`${v}\``),
    ];

    return {
        enum_type: enumType,
        allowed_values: def.enum,
        explanation: lines.join('\n'),
        schema_versions: SCHEMA_VERSIONS,
    };
}

function explainByKeyword(topic) {
    const tl = topic.toLowerCase();
    const matches = [];

    // Search assessment rules
    for (const [ruleId, entry] of RULES_BY_ID) {
        const { rule } = entry;
        const text = `${rule.rule_id} ${rule.rule_name} ${rule.policy_rationale || ''} ${rule.assessment_guidance || ''}`.toLowerCase();
        if (text.includes(tl)) {
            matches.push({ type: 'rule', id: ruleId, name: rule.rule_name, test_id: entry.test_id });
        }
    }

    // Search validation requirements
    for (const [reqId, req] of VALIDATION_REQUIREMENTS_BY_ID) {
        const text = `${reqId} ${req.name || ''} ${req.policy_driver || ''}`.toLowerCase();
        if (text.includes(tl)) {
            matches.push({ type: 'requirement', id: reqId, name: req.name });
        }
    }

    // Search enum types
    if (ENUMS.properties) {
        for (const [enumType, def] of Object.entries(ENUMS.properties)) {
            if (enumType.includes(tl) || (def.description || '').toLowerCase().includes(tl)) {
                matches.push({ type: 'enum', id: enumType, description: def.description });
            }
        }
    }

    // Known concept shortcuts
    const concept = explainConcept(tl);

    if (matches.length === 0 && !concept) {
        return {
            found: false,
            topic,
            message: `No matching rule, requirement, or concept found for "${topic}". Try a rule ID (e.g. A1.2.1), requirement ID (e.g. B28), enum type (e.g. decision_mode), or keyword.`,
            schema_versions: SCHEMA_VERSIONS,
        };
    }

    return {
        found: true,
        topic,
        concept_explanation: concept,
        matches: matches.slice(0, 10), // limit to first 10
        total_matches: matches.length,
        hint: matches.length > 0 ? `Use the exact ID (e.g. "${matches[0].id}") to get a full explanation.` : null,
        schema_versions: SCHEMA_VERSIONS,
    };
}

function explainConcept(tl) {
    if (tl.includes('45') || tl.includes('45-degree') || tl.includes('forty-five')) {
        return 'The **45-degree rule** (A1.2.1) is a locally-applied guideline used by Gloucester City Council to assess impact on neighbour daylight and sunlight. A line at 45° is drawn from the nearest affected neighbour window. Extensions that breach this line may cause harm. threshold_status = "case_by_case" — officer judgement required. This is **not** a statutory rule but is material (in the material-rule register).';
    }
    if (tl.includes('garden depth') || tl.includes('remaining rear garden') || tl.includes('a1.2.7')) {
        return 'Rule **A1.2.7** (Remaining Rear Garden Depth): locally-applied guideline that extensions should not reduce the rear garden depth below a locally-expected minimum. threshold_status = "unconfirmed" — this is a locally-applied threshold without a formally adopted published source. The narrative must state "Locally applied" and NOT "adopted standard".';
    }
    if (tl.includes('prior notification') || tl.includes('larger home extension')) {
        return '**Prior Notification for Larger Home Extensions**: A separate permitted development regime under Class A Part 1 Schedule 2 GPDO 2015 for single-storey rear extensions beyond normal PD limits. The process requires neighbour notification (not a planning permission), and the LPA considers impact on amenity of adjoining premises. Policy A1 (design and amenity rules) does NOT apply to this route.';
    }
    if (tl.includes('decision_mode') || tl.includes('decision mode')) {
        return `**decision_mode** is computed exclusively by build_assessment_result (ResultAssembler). It follows a strict 10-row precedence table. Values: invalid | insufficient_information | manual_officer_review | likely_support | balanced_judgement | likely_refusal | prior_approval_not_required | prior_approval_granted | prior_approval_refused | unknown.`;
    }
    if (tl.includes('data_compromised') || tl.includes('data compromised')) {
        return '**data_compromised** processing state: schema-valid facts but with blocking data quality issues. Authority scope: route detection is authoritative for the submitted route; validation is authoritative; planning merits are ADVISORY ONLY with confidence = "low".';
    }
    if (tl.includes('material rule') || tl.includes('material-rule register')) {
        return `**Material-rule register** (plan Section 3.6): rules that, when returning cannot_assess, force planning_merits.status = cannot_assess overall. Current Gloucester register: ${MATERIAL_RULES_REGISTER.join(', ')}. Gloucester-specific — other councils must review against their own policy context.`;
    }
    if (tl.includes('bng') || tl.includes('biodiversity net gain')) {
        return '**BNG (Biodiversity Net Gain)**: Householder applications are EXEMPT from the statutory mandatory BNG regime (TCPA 1990 Sch 7A as inserted by Environment Act 2021). However, the local **B11 Biodiversity Small Sites Statement** is still required as a local validation expectation (GCP A1, E1–E3). These are two separate requirements — do not conflate them.';
    }
    if (tl.includes('conservation area')) {
        return '**Conservation Area**: Designation triggers: (1) DAS requirement (A7); (2) Heritage Review module; (3) B28 Historic Impact Statement; (4) Conservation Officer consultation (mandatory). Rule A1.7.2 is a material rule — if it cannot_assess for a CA site, merits status is forced to cannot_assess.';
    }
    return null;
}

function severityExplanation(severity) {
    const map = {
        must:          'Mandatory requirement or strong legal/policy constraint. Non-compliance = FAIL.',
        must_not:      'Outcome should be treated as non-compliant unless strong contrary basis exists. Non-compliance = FAIL.',
        should:        'Normal policy expectation; departures need justification and officer judgement. Non-compliance = CONCERN.',
        should_not:    'Normally unacceptable; departures need strong justification. Non-compliance = CONCERN.',
        may:           'Potentially acceptable factor requiring context-based judgement. = MANUAL REVIEW.',
        informative_only: 'Not a decision rule; information or good practice only.',
    };
    return map[severity] || severity;
}

function formatEvaluation(evaluation) {
    if (evaluation.kind === 'measurement' && evaluation.metric) {
        const m = evaluation.metric;
        return `Measurement: \`${m.parameter}\` ${m.operator} ${m.threshold}${m.unit || ''}${m.preferred ? ` (preferred: ${m.preferred}${m.unit || ''})` : ''}`;
    }
    return `Kind: ${evaluation.kind}`;
}

module.exports = { execute };
