/**
 * Tool: gcc_procurement_explain_rule
 *
 * Explains a constitutional rule, threshold, or known conflict in plain English
 * with full source citations. All content is derived from
 * procurement-contracts-schema-v0.9.1.json — nothing is inferred or invented.
 *
 * No external calls. Read-only.
 */

'use strict';

const { createError, createSuccess, validateRequired, ERROR_CODES } = require('../../util/errors');
const {
    MATRIX,
    WAIVER_MATRIX,
    THRESHOLDS,
    NOTICES,
    CONFLICTS,
    RISK_FLAGS,
    SOURCES,
    KD_TRIGGERS,
    EXECUTION_AUTHORITY,
    SCHEMA_VERSION,
    findNotice,
    findRiskFlag,
} = require('../schema-loader');

/**
 * Case-insensitive, partial-match topic test.
 */
function matches(topic, ...patterns) {
    const t = topic.toLowerCase();
    return patterns.some(p => t.includes(p.toLowerCase()));
}

/**
 * Format a source document entry as a citation string.
 */
function citeSource(docId) {
    const doc = SOURCES.find(s => s.doc_id === docId);
    return doc
        ? `[${docId}] ${doc.title}${doc.reference ? ' (' + doc.reference + ')' : ''}`
        : `[${docId}]`;
}

// ─── Topic handlers ────────────────────────────────────────────────────────

function explainTier(topic) {
    const numMatch = topic.match(/(\d)/);
    if (!numMatch) return null;
    const tierNum = parseInt(numMatch[1], 10);
    const tier = MATRIX.find(t => t.tier === tierNum);
    if (!tier) return null;

    return {
        topic: `Tier ${tier.tier}: ${tier.label}`,
        explanation: [
            `**Tier ${tier.tier}** covers contracts from £${(tier.min_value_gbp || 0).toLocaleString()} to ${tier.max_value_gbp ? '£' + tier.max_value_gbp.toLocaleString() : 'unlimited'} (whole-life inc. VAT).`,
            '',
            `**Award authority:** ${tier.award_authority_label}`,
            `**Key decision:** ${tier.key_decision ? 'YES — ' + (tier.key_decision_triggers || []).join(', ') : 'NO'}`,
            `**Forward Plan required:** ${tier.forward_plan_required ? 'YES' : 'NO'}`,
            tier.forward_plan_note ? `**Forward Plan note:** ${tier.forward_plan_note}` : null,
            `**One Legal contract:** ${tier.one_legal_contract_required ? 'YES' : 'NO'}`,
            `**Deed required:** ${tier.deed_normally_required ? 'YES (Council Solicitor may approve signature instead)' : 'NO'}`,
            tier.process ? `**Process:** ${tier.process}` : null,
            tier.compliance_note ? `**Compliance note:** ${tier.compliance_note}` : null,
            tier.cabinet_member_delegation_basis ? `**Delegation basis (lex specialis):** ${tier.cabinet_member_delegation_basis}` : null,
        ].filter(Boolean).join('\n'),
        sources: (tier.sources || []).map(s => ({ citation: s })),
    };
}

function explainKD(topic) {
    // Match KD1, KD2, KD3, KD4
    const kdMatch = topic.match(/kd\s*([1-4])/i);
    if (!kdMatch) return null;
    const kdId = `KD${kdMatch[1]}`;
    const kd = KD_TRIGGERS.find(t => t.trigger_id === kdId);
    if (!kd) return null;

    return {
        topic: `Key Decision Trigger ${kdId}`,
        explanation: [
            `**${kdId}:** ${kd.description}`,
            '',
            kd.procurement_note ? `**Procurement note:** ${kd.procurement_note}` : null,
            kd.threshold_gbp ? `**Monetary threshold:** £${kd.threshold_gbp.toLocaleString()}` : null,
            kd.contract_threshold_gbp ? `**Contract threshold:** £${kd.contract_threshold_gbp.toLocaleString()}` : null,
            '',
            'All key decisions must appear on the Forward Plan (Leader publishes monthly, 12-month rolling programme). Officers cannot take key decisions without specific Leader authorisation — the Forward Plan entry IS the authorisation mechanism (PART3E 3E.11).',
        ].filter(Boolean).join('\n'),
        sources: [
            { citation: citeSource('ART12') + ' — Article 12.03(b)' },
            { citation: citeSource('PART3E') + ' — 3E.11' },
        ],
    };
}

function explainConflict(topic) {
    // Match C1, C2, C3, C4 or 'conflict C*'
    const cMatch = topic.match(/c([1-4])/i);
    if (!cMatch) return null;
    const conflictId = `C${cMatch[1]}`;
    const conflict = CONFLICTS.find(c => c.conflict_id === conflictId);
    if (!conflict) return null;

    return {
        topic: `Known Constitutional Conflict ${conflictId}`,
        explanation: [
            `**Conflict ${conflictId}**`,
            `**Documents in conflict:** ${(conflict.between || []).join(' vs ')}`,
            '',
            `**Issue:** ${conflict.issue}`,
            '',
            `**Resolution:** ${conflict.resolution}`,
            '',
            `**Action required:** ${conflict.action_required}`,
            conflict.risk_flag ? `**Associated risk flag:** ${conflict.risk_flag}` : null,
        ].filter(Boolean).join('\n'),
        sources: (conflict.between || []).map(docId => ({ citation: citeSource(docId) })),
    };
}

function explainForwardPlan(topic) {
    const tier4 = MATRIX.find(t => t.tier === 4);

    return {
        topic: 'Forward Plan obligation and 3E.11 officer restriction',
        explanation: [
            '**Forward Plan** is the mechanism by which the Council Leader authorises key executive decisions, including procurement awards above £100,000 (KD3).',
            '',
            '**3E.11 officer restriction:** Officers cannot take key decisions without specific authorisation from the Leader. The Forward Plan entry IS that authorisation — without it, the officer lacks authority to award even if the contract value is within their financial ceiling.',
            '',
            tier4 && tier4.forward_plan_note ? `**Application (Tier 4, £100k–£250k):** ${tier4.forward_plan_note}` : null,
            '',
            '**Compliance question (C3):** GCC may not currently be applying the Forward Plan requirement to contracts in the £100k–£250k range (Tier 4). This is a live governance issue — see conflict C3.',
            '',
            '**Forward Plan content:** Must be published by the Leader at least monthly, showing the 12-month programme of key decisions. Source: PART3E Appendix A para 2.',
        ].filter(Boolean).join('\n'),
        sources: [
            { citation: citeSource('PART3E') + ' — 3E.11 and Appendix A para 2' },
            { citation: citeSource('ART12') + ' — 12.03(b)' },
        ],
    };
}

function explainDeed() {
    const execAuth = EXECUTION_AUTHORITY;

    return {
        topic: 'Deed requirement and contract execution authority (Article 13)',
        explanation: [
            '**Deed required:** Contracts above £50,000 must be executed as deeds (by Common Seal). Source: ART13 13.02.',
            '',
            '**Council Solicitor discretion:** The Council Solicitor (Director of One Legal) may approve signature instead of Common Seal where appropriate.',
            '',
            execAuth ? `**Execution tiers (Article 13.02):**\n${(execAuth.tiers || []).map(t =>
                `- Up to £${t.max_value_gbp ? t.max_value_gbp.toLocaleString() : '∞'}: ${(t.signatories || []).join(', ')}`
            ).join('\n')}` : null,
            '',
            '**Conflict note:** Contract Rule 18 states the lower tier threshold as £30,000. Article 13.02 states £25,000. Article 13 takes precedence (conflict C1). See known_conflicts.C1.',
        ].filter(Boolean).join('\n'),
        sources: [
            { citation: citeSource('ART13') + ' — Article 13.02' },
            { citation: 'Conflict C1: ART13 vs CONTRACT-RULES Rule 18' },
        ],
    };
}

function explainWaiver() {
    return {
        topic: 'Waiver approval authority',
        explanation: [
            'A waiver disapplies one or more Contract Rules for a specific procurement. Grounds and authority are set out in CONTRACT-RULES Rule 6.3 and PART3E Table 4.',
            '',
            '**Waiver approval authority matrix:**',
            (WAIVER_MATRIX || []).map(w =>
                `- **${w.value_range}:** ${w.approver}${w.consultation ? ' (consultation: ' + w.consultation.join(', ') + ')' : ''}`
            ).join('\n'),
            '',
            '**Key point:** Waivers do not waive constitutional or legislative requirements — only the procedural Contract Rules. A waiver cannot disapply PA2023 threshold procedures.',
            '',
            '**Source:** PART3E Table 4; CONTRACT-RULES Rule 6.3',
        ].filter(Boolean).join('\n'),
        sources: [
            { citation: citeSource('PART3E') + ' — Table 4' },
            { citation: citeSource('CONTRACT-RULES') + ' — Rule 6.3' },
        ],
    };
}

function explainThreshold() {
    return {
        topic: 'PA2023 procurement thresholds (sub-central authorities)',
        explanation: [
            '**GCC is a sub-central authority.** The following thresholds apply:',
            '',
            `- Goods and services: £${THRESHOLDS.goods_and_services.toLocaleString()}`,
            `- Works: £${THRESHOLDS.works.toLocaleString()}`,
            `- Light-touch services: £${THRESHOLDS.light_touch.toLocaleString()}`,
            '',
            'These are whole-life values, inclusive of VAT (CONTRACT-RULES Rule 3).',
            '',
            'Above these thresholds, PA2023 procurement procedures apply (UK notices, standstill periods, exclusion grounds, etc.).',
            '',
            `**Source:** ${THRESHOLDS.source || 'SI 2025/1200, Schedule 1 PA2023'}`,
        ].join('\n'),
        sources: [
            { citation: citeSource('PA2023-REGS') + ' — SI 2025/1200 Schedule 1' },
            { citation: citeSource('PA2023') },
        ],
    };
}

function explainNotice(topic) {
    const ukMatch = topic.match(/uk\s*(\d+)/i);
    if (!ukMatch) return null;
    const code = `UK${ukMatch[1]}`;
    const notice = findNotice(code);
    if (!notice) return null;

    return {
        topic: `Notice ${notice.code}: ${notice.name}`,
        explanation: [
            `**${notice.code} — ${notice.name}**`,
            '',
            `**Trigger:** ${notice.trigger}`,
            `**Timing:** ${notice.timing}`,
            `**Mandatory:** ${typeof notice.mandatory === 'boolean' ? (notice.mandatory ? 'YES' : 'NO') : notice.mandatory}`,
            `**Legal basis:** ${notice.section}`,
            notice.notes ? `**Notes:** ${notice.notes}` : null,
            '',
            '**Platform:** Find a Tender (find-tender.service.gov.uk)',
        ].filter(Boolean).join('\n'),
        sources: [
            { citation: citeSource('PA2023') + ' — ' + notice.section },
        ],
    };
}

function explainRiskFlag(topic) {
    const rMatch = topic.match(/r\s*(\d+)/i);
    if (!rMatch) return null;
    const flagId = `R${rMatch[1].padStart(2, '0')}`;
    const flag = findRiskFlag(flagId);
    if (!flag) return null;

    return {
        topic: `Risk Flag ${flag.flag_id}: ${flag.label}`,
        explanation: [
            `**${flag.flag_id} — ${flag.label}**`,
            '',
            `**Trigger logic:** ${flag.logic}`,
            `**Severity:** ${flag.severity}`,
            flag.source ? `**Source:** ${flag.source}` : null,
            flag.note ? `**Note:** ${flag.note}` : null,
        ].filter(Boolean).join('\n'),
        sources: flag.source
            ? [{ citation: flag.source }]
            : [{ citation: 'procurement-contracts-schema-v0.9.1.json — risk_flags.flags' }],
    };
}

function explainOfficerAuthority() {
    const subDel = SOURCES.find(s => s.doc_id === 'SUB-DELEGATION');

    return {
        topic: 'Officer award authority and scheme of sub-delegation',
        explanation: [
            '**Managing Director (MD) and Directors** may accept tenders up to £250,000 (within budget).',
            '',
            '**Sub-delegation to Heads of Service:** All Heads of Service may accept tenders and quotations within budget and not exceeding £250,000.',
            '',
            '**Head of Finance and Resources** only: may also approve waivers to Contract Rules where value does not exceed £250,000.',
            '',
            '**Above £250,000:** Cabinet Member must accept (PART3E Table 4). Above £500,000: Full Cabinet.',
            '',
            '**Key point:** Officer authority requires the Forward Plan entry as Leader authorisation for key decisions (value > £100,000, KD3). Without it, the officer lacks authority even within the financial ceiling. See 3E.11.',
            '',
            subDel ? `**Source document:** ${subDel.title} (${subDel.reference || 'GCC Constitution Part 3'})` : null,
            `**Key provisions:** ${subDel && subDel.key_provisions ? JSON.stringify(subDel.key_provisions) : 'see SUB-DELEGATION'}`,
        ].filter(Boolean).join('\n'),
        sources: [
            { citation: citeSource('SUB-DELEGATION') },
            { citation: citeSource('PART3E') + ' — Table 4' },
        ],
    };
}

function explainLexSpecialis() {
    const c4 = CONFLICTS.find(c => c.conflict_id === 'C4');
    const tier5 = MATRIX.find(t => t.tier === 5);

    return {
        topic: 'Lex specialis — Cabinet Member authority above £250,000 (Conflict C4)',
        explanation: [
            '**Lex specialis** is the constitutional principle that a specific rule overrides a general rule.',
            '',
            '**The apparent conflict:**',
            '- PART3E Table 4 delegates tender acceptance above £250,000 to Cabinet Member.',
            '- PART3E Appendix A para 2(3) states Cabinet Members cannot make decisions involving expenditure exceeding £250,000.',
            '',
            '**Resolution:**',
            c4 ? c4.resolution : 'Table 4 specific delegation governs; Appendix A ceiling applies to other Cabinet Member decisions.',
            '',
            tier5 && tier5.cabinet_member_delegation_basis
                ? `**Tier 5 delegation basis:** ${tier5.cabinet_member_delegation_basis}`
                : null,
            '',
            c4 ? `**Action required:** ${c4.action_required}` : null,
        ].filter(Boolean).join('\n'),
        sources: [
            { citation: citeSource('PART3E') + ' — Table 4 and Appendix A para 2(3)' },
            { citation: 'Conflict C4: lex specialis resolution' },
        ],
    };
}

function explainSourceDocument(topic) {
    // Check if topic matches a known doc_id
    const docIds = SOURCES.map(s => s.doc_id.toLowerCase());
    const topicLower = topic.toLowerCase();
    const matchedDoc = SOURCES.find(s => topicLower.includes(s.doc_id.toLowerCase()));
    if (!matchedDoc) return null;

    return {
        topic: `Source document: ${matchedDoc.doc_id}`,
        explanation: [
            `**${matchedDoc.doc_id} — ${matchedDoc.title}**`,
            matchedDoc.reference ? `**Reference:** ${matchedDoc.reference}` : null,
            matchedDoc.authority_level ? `**Authority level:** ${matchedDoc.authority_level}` : null,
            matchedDoc.in_force ? `**In force:** ${matchedDoc.in_force}` : null,
            matchedDoc.effective_date ? `**Effective date:** ${matchedDoc.effective_date}` : null,
            matchedDoc.notes ? `**Notes:** ${matchedDoc.notes}` : null,
            matchedDoc.key_sections
                ? `**Key sections:** ${Object.entries(matchedDoc.key_sections).map(([k, v]) => `${k}: ${v}`).join('; ')}`
                : null,
            matchedDoc.key_provisions
                ? `**Key provisions:** ${JSON.stringify(matchedDoc.key_provisions)}`
                : null,
        ].filter(Boolean).join('\n'),
        sources: [{ citation: citeSource(matchedDoc.doc_id) }],
    };
}

const AVAILABLE_TOPICS = [
    'tiers 1–6 (e.g. "tier 4", "tier 3")',
    'key decision triggers KD1–KD4 (e.g. "KD3")',
    'known conflicts C1–C4 (e.g. "conflict C3", "C4")',
    'forward plan / 3E.11',
    'deed requirements / ART13',
    'waiver approval',
    'lex specialis',
    'officer authority / sub-delegation',
    'thresholds',
    'UK notices UK1–UK17 (e.g. "UK4", "UK5")',
    'risk flags R01–R13 (e.g. "R11")',
    'source documents (e.g. "PA2023", "CONTRACT-RULES", "ART12")',
];

/**
 * Main dispatcher — try each handler in order.
 */
function dispatch(topic) {
    // Tier
    if (matches(topic, 'tier') && /\d/.test(topic)) {
        const result = explainTier(topic);
        if (result) return result;
    }

    // KD triggers
    if (matches(topic, 'kd', 'key decision', 'key-decision')) {
        const result = explainKD(topic);
        if (result) return result;
    }

    // Conflict
    if (matches(topic, 'conflict', ' c1', ' c2', ' c3', ' c4') || /\bc[1-4]\b/i.test(topic)) {
        const result = explainConflict(topic);
        if (result) return result;
    }

    // Lex specialis (before C4 conflict handler can catch it)
    if (matches(topic, 'lex specialis', 'lex-specialis')) {
        return explainLexSpecialis();
    }

    // Forward plan / 3E.11
    if (matches(topic, 'forward plan', 'forward-plan', '3e.11', '3e11')) {
        return explainForwardPlan(topic);
    }

    // Deed / ART13
    if (matches(topic, 'deed', 'art13', 'execution authority', 'common seal', 'art 13')) {
        return explainDeed();
    }

    // Waiver
    if (matches(topic, 'waiver')) {
        return explainWaiver();
    }

    // Threshold
    if (matches(topic, 'threshold', 'thresholds', 'pa2023 limit')) {
        return explainThreshold();
    }

    // UK notices
    if (matches(topic, 'uk') && /uk\s*\d+/i.test(topic)) {
        const result = explainNotice(topic);
        if (result) return result;
    }

    // Risk flags
    if (/\br\s*\d+\b/i.test(topic)) {
        const result = explainRiskFlag(topic);
        if (result) return result;
    }

    // Officer authority
    if (matches(topic, 'officer authority', 'sub-delegation', 'sub delegation', 'officer award')) {
        return explainOfficerAuthority();
    }

    // Source documents by doc_id
    const docResult = explainSourceDocument(topic);
    if (docResult) return docResult;

    // No match
    return null;
}

/**
 * Render markdown output.
 */
function renderMarkdown(result) {
    const lines = [
        `## ${result.topic}`,
        '',
        result.explanation,
        '',
        '---',
        '**Sources:**',
        ...result.sources.map(s => `- ${s.citation}`),
        '',
        `*Schema version: ${result.schema_version}*`,
    ];
    return lines.join('\n');
}

/**
 * Execute the gcc_procurement_explain_rule tool.
 * @param {object} input
 * @returns {object}
 */
function execute(input = {}) {
    const missing = validateRequired(input, ['topic']);
    if (missing) {
        return createError(ERROR_CODES.BAD_REQUEST, missing);
    }

    const topic = String(input.topic || '').trim();
    if (topic.length < 2) {
        return createError(ERROR_CODES.BAD_REQUEST, 'topic must be at least 2 characters');
    }

    const responseFormat = (input.response_format || 'markdown').toLowerCase();

    const found = dispatch(topic);

    if (!found) {
        const notFound = {
            topic,
            explanation: `Topic "${topic}" is not covered in the schema.`,
            available_topics: AVAILABLE_TOPICS,
            schema_version: SCHEMA_VERSION,
        };

        if (responseFormat === 'json') return createSuccess(notFound);

        return createSuccess({
            text: [
                `## Topic not found in schema`,
                '',
                `"${topic}" did not match any rule, threshold, or conflict in the procurement schema.`,
                '',
                '**Available topics:**',
                AVAILABLE_TOPICS.map(t => `- ${t}`).join('\n'),
                '',
                `*Schema version: ${SCHEMA_VERSION}*`,
            ].join('\n'),
            raw: notFound,
        });
    }

    found.schema_version = SCHEMA_VERSION;

    if (responseFormat === 'json') {
        return createSuccess(found);
    }

    return createSuccess({ text: renderMarkdown(found), raw: found });
}

module.exports = { execute };
