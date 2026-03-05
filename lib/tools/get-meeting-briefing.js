'use strict';

const { getMeetingDetails } = require('./get-meeting-details');
const { analyzeMeetingDocument } = require('./analyze-meeting-document');
const { getReportRecommendations } = require('./get-report-recommendations');

const DECISION_STATUS_VALUES = new Set([
    'Decision required',
    'Recommendation to Council',
    'Consultation approval',
    'For noting',
    'Delegated authority',
    'Information item',
    'Unclear from available papers'
]);

function stripHtml(value) {
    if (!value || typeof value !== 'string') return '';
    return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function toSentence(value) {
    if (!value) return null;
    return value.replace(/\s+/g, ' ').trim();
}

function classifyDecisionStatus({ title, decision, recommendations, reason }) {
    const haystack = `${title || ''} ${decision || ''} ${(recommendations || []).join(' ')} ${reason || ''}`.toLowerCase();
    if (/recommend(?:ed|ation|s)?\s+(?:to\s+)?(?:full\s+)?council/.test(haystack)) return 'Recommendation to Council';
    if (/consultation|approve\s+(?:the\s+)?consultation|public consultation/.test(haystack)) return 'Consultation approval';
    if (/delegate|delegated authority|authoris(?:e|ation).*officer/.test(haystack)) return 'Delegated authority';
    if (/note\b|for information|information report|receive\s+the\s+report/.test(haystack)) return 'For noting';
    if (/monitor|performance/.test(haystack)) return 'Information item';
    if (/approve|adopt|award|agree|resolve|vary\s+policy|statutory/.test(haystack)) return 'Decision required';
    return 'Unclear from available papers';
}

function classifyCategory(text) {
    const t = (text || '').toLowerCase();
    if (/budget|capital|revenue|mtfs|s151|financial|spend/.test(t)) return 'Finance';
    if (/legal|constitution|member conduct|standards|audit|governance/.test(t)) return 'Governance';
    if (/housing|homeless|tenant/.test(t)) return 'Housing';
    if (/planning|development control/.test(t)) return 'Planning';
    if (/parking|traffic|permit/.test(t)) return 'Parking';
    if (/regeneration|town centre|levelling up/.test(t)) return 'Regeneration';
    if (/consultation/.test(t)) return 'Consultation';
    if (/policy|strategy|framework|plan/.test(t)) return 'Policy';
    if (/staff|workforce|hr|employment/.test(t)) return 'Staffing';
    if (/treasury|borrowing|investment|prudential/.test(t)) return 'Treasury';
    if (/performance|kpi/.test(t)) return 'Performance';
    return 'Other';
}

function classifyAppendixType(title) {
    const t = (title || '').toLowerCase();
    if (/draft policy|draft strategy|draft plan/.test(t)) return 'draft policy';
    if (/tracked changes|track changes|mark-up/.test(t)) return 'tracked changes';
    if (/consultation response|you said we did/.test(t)) return 'consultation responses';
    if (/technical|methodology|impact assessment/.test(t)) return 'technical appendix';
    if (/financial|budget|schedule of costs/.test(t)) return 'financial schedule';
    if (/legal|equality duty|statutory/.test(t)) return 'legal appendix';
    if (/options appraisal|options/.test(t)) return 'options appraisal';
    if (/scrutiny/.test(t)) return 'scrutiny recommendations';
    if (/implementation|delivery plan|timeline/.test(t)) return 'implementation plan';
    return 'evidence paper';
}

function classifyPublicInterest(item) {
    const t = `${item.item_title || ''} ${item.category || ''} ${item.what_this_item_is_about || ''}`.toLowerCase();
    if (/budget|council tax|housing|planning|regeneration|contract|consultation/.test(t)) {
        return { level: 'High', reason: 'Likely to affect a large number of residents, service delivery, or public spending.' };
    }
    if (/policy|governance|performance|parking/.test(t)) {
        return { level: 'Medium', reason: 'Material public relevance, but likely narrower direct impact than major budget or service decisions.' };
    }
    return { level: 'Low', reason: 'Limited direct resident impact evident from available papers.' };
}

function buildOfficialSection(value) {
    if (!value) return { official_record: null, plain_english: null };
    return {
        official_record: value,
        plain_english: toSentence(stripHtml(value))
    };
}

async function buildAgendaItemBriefing(meeting, item, includeDocumentAnalysis) {
    const reportDoc = (item.linked_documents || []).find(d => /report|agenda|cabinet|committee/i.test(d.title || '')) || (item.linked_documents || [])[0] || null;

    let reportAnalysis = null;
    let recommendationAnalysis = null;
    const evidenceGaps = [];

    if (includeDocumentAnalysis && reportDoc && reportDoc.url) {
        reportAnalysis = await analyzeMeetingDocument(reportDoc.url, ['all'], 20);
        recommendationAnalysis = await getReportRecommendations({ url: reportDoc.url, max_items: 20 });
        if (!reportAnalysis?.success) evidenceGaps.push(`Could not analyse main report document (${reportDoc.url}).`);
        if (!recommendationAnalysis?.success) evidenceGaps.push(`Could not extract formal recommendations (${reportDoc.url}).`);
    } else {
        evidenceGaps.push('No accessible main report document identified for deep extraction.');
    }

    const officialRecommendation = recommendationAnalysis?.success && recommendationAnalysis.recommendations?.length
        ? recommendationAnalysis.recommendations.map((r, index) => `${index + 1}. ${r.text || r}`).join('\n')
        : 'No formal recommendation text extracted from the available papers.';

    const reasonFromReport = reportAnalysis?.sections?.reason_for_report || reportAnalysis?.sections?.background || null;
    const summaryText = reportAnalysis?.summary || stripHtml(item.title) || null;
    const decisionText = stripHtml(item.decision || '');

    const decisionStatus = classifyDecisionStatus({
        title: item.title,
        decision: decisionText,
        recommendations: recommendationAnalysis?.recommendations?.map(r => r.text || String(r)) || [],
        reason: reasonFromReport
    });

    const category = classifyCategory(`${item.title || ''} ${reasonFromReport || ''} ${summaryText || ''}`);
    const pii = classifyPublicInterest({ item_title: item.title, category, what_this_item_is_about: summaryText });

    const appendices = (item.linked_documents || []).slice(1).map(doc => ({
        title: doc.title,
        url: doc.url,
        appendix_type: classifyAppendixType(doc.title)
    }));

    const processContext = [];
    const processHaystack = `${reasonFromReport || ''} ${officialRecommendation}`.toLowerCase();
    if (/scrutiny/.test(processHaystack)) processContext.push('Follows scrutiny activity (identified in papers).');
    if (/full council|council approval/.test(processHaystack) || decisionStatus === 'Recommendation to Council') processContext.push('Likely to proceed to Full Council for final determination.');
    if (/consultation/.test(processHaystack) && /draft|proposed/.test(processHaystack)) processContext.push('Appears to be a first-stage consultation item.');
    if (/adopt|final/.test(processHaystack)) processContext.push('Appears to be at final adoption stage.');
    if (/previous decision|earlier decision|implemented/.test(processHaystack)) processContext.push('Appears to implement an earlier committee or Council decision.');

    return {
        item_number: item.number || String(item.id),
        item_title: item.title || 'Untitled agenda item',
        meeting_date: meeting.details?.date || null,
        committee_name: meeting.details?.committee || meeting.council,
        decision_status: DECISION_STATUS_VALUES.has(decisionStatus) ? decisionStatus : 'Unclear from available papers',
        category,
        what_this_item_is_about: toSentence(summaryText) || 'Unable to confidently extract a concise summary from available papers.',
        why_it_is_on_the_agenda: reasonFromReport ? toSentence(reasonFromReport) : 'Inference: The papers do not contain a clearly extractable “reason for report” section; this item appears to be included for routine committee consideration based on the agenda heading and linked documents.',
        official_recommendation: officialRecommendation,
        plain_english_decision: decisionStatus === 'For noting' ? 'The committee is being asked to note the report.' : (decisionStatus === 'Recommendation to Council' ? 'The committee is asked to recommend a course of action to Full Council.' : 'The committee is being asked to take a formal decision or provide approval as set out in the official recommendation wording.'),
        key_points: [
            toSentence(reasonFromReport),
            recommendationAnalysis?.recommendations?.[0]?.text,
            reportAnalysis?.sections?.background,
            reportAnalysis?.sections?.risk_assessment,
            decisionText || null
        ].filter(Boolean).slice(0, 7),
        background_context: [
            reasonFromReport ? `Official record: ${toSentence(reasonFromReport)}` : null,
            reportAnalysis?.sections?.background ? `Plain English: ${toSentence(reportAnalysis.sections.background)}` : null,
            processContext.length ? `Inference: ${processContext.join(' ')}` : null
        ].filter(Boolean).join(' '),
        financial_implications_official: reportAnalysis?.sections?.financial_implications || 'No formal financial implications text extracted from the available papers.',
        financial_implications_summary: reportAnalysis?.sections?.financial_implications ? toSentence(stripHtml(reportAnalysis.sections.financial_implications)) : 'Financial implications could not be confidently extracted from available papers.',
        legal_implications_official: reportAnalysis?.sections?.legal_implications || 'No formal legal implications text extracted from the available papers.',
        legal_implications_summary: reportAnalysis?.sections?.legal_implications ? toSentence(stripHtml(reportAnalysis.sections.legal_implications)) : 'Legal implications could not be confidently extracted from available papers.',
        risks_stated: reportAnalysis?.sections?.risk_assessment ? [toSentence(reportAnalysis.sections.risk_assessment)] : [],
        risks_inferred: [
            'Inference: If implementation relies on later Council approval, delay risk may apply.',
            decisionStatus === 'Consultation approval' ? 'Inference: Consultation outcomes may materially alter the final policy position.' : null
        ].filter(Boolean),
        public_interest_level: pii.level,
        public_interest_reason: pii.reason,
        lead_officer: reportAnalysis?.author || null,
        lead_member_if_identifiable: null,
        main_report: reportDoc ? { title: reportDoc.title, url: reportDoc.url } : null,
        appendices,
        related_documents: (item.linked_documents || []).map(d => ({ title: d.title, url: d.url })),
        source_links: [
            meeting.links?.web_page,
            ...(item.linked_documents || []).map(d => d.url).filter(Boolean)
        ].filter(Boolean),
        extraction_confidence: recommendationAnalysis?.metadata?.extraction_confidence || reportAnalysis?.metadata?.extraction_confidence || 'low',
        evidence_gaps: evidenceGaps,
        presentation_structure: {
            official_record: {
                recommendation: officialRecommendation,
                financial_implications: reportAnalysis?.sections?.financial_implications || null,
                legal_implications: reportAnalysis?.sections?.legal_implications || null
            },
            plain_english: {
                summary: toSentence(summaryText),
                decision: decisionText || null
            },
            inference: {
                process_context: processContext
            }
        }
    };
}

function buildMeetingLevelBriefing(items) {
    const significant = items.filter(i => ['High'].includes(i.public_interest_level));
    const routine = items.filter(i => ['For noting', 'Information item'].includes(i.decision_status));
    const contentious = items.filter(i => i.decision_status === 'Recommendation to Council' || i.risks_inferred.length > 0);

    return {
        meeting_overview: `Meeting contains ${items.length} agenda items. ${significant.length} item(s) are likely high public interest.`,
        most_significant_items: significant.map(i => ({ item_number: i.item_number, item_title: i.item_title, reason: i.public_interest_reason })),
        routine_or_statutory_items: routine.map(i => ({ item_number: i.item_number, item_title: i.item_title, decision_status: i.decision_status })),
        likely_high_public_interest_items: significant.map(i => ({ item_number: i.item_number, item_title: i.item_title })),
        likely_contentious_items: contentious.map(i => ({ item_number: i.item_number, item_title: i.item_title })),
        key_financial_decisions: items.filter(i => i.financial_implications_official && !i.financial_implications_official.startsWith('No formal')).map(i => ({ item_number: i.item_number, item_title: i.item_title })),
        key_policy_decisions: items.filter(i => ['Policy', 'Consultation', 'Governance'].includes(i.category)).map(i => ({ item_number: i.item_number, item_title: i.item_title })),
        evidence_gaps_across_meeting: items.flatMap(i => i.evidence_gaps.map(g => `Item ${i.item_number}: ${g}`))
    };
}

async function getMeetingBriefing(councilName, meetingId, includeDocumentAnalysis = true) {
    const meeting = await getMeetingDetails(councilName, meetingId);
    if (meeting.error) {
        return meeting;
    }

    const items = [];
    for (const item of (meeting.agenda || [])) {
        // Sequential extraction to avoid overloading council endpoints.
        // eslint-disable-next-line no-await-in-loop
        const briefing = await buildAgendaItemBriefing(meeting, item, includeDocumentAnalysis);
        items.push(briefing);
    }

    return {
        council: meeting.council,
        meeting_id: meeting.meeting_id,
        meeting_date: meeting.details?.date || null,
        committee_name: meeting.council,
        agenda_item_briefings: items,
        meeting_level_briefing: buildMeetingLevelBriefing(items),
        record_handling_guidance: {
            official_record: 'Use official_recommendation, financial_implications_official, and legal_implications_official as verbatim source text.',
            plain_english: 'Use summary fields for explanatory narrative.',
            inference: 'Any inferred point is labelled explicitly as Inference.'
        }
    };
}

module.exports = {
    getMeetingBriefing,
    _internal: {
        classifyDecisionStatus,
        classifyCategory,
        classifyAppendixType,
        buildMeetingLevelBriefing,
        buildOfficialSection
    }
};
