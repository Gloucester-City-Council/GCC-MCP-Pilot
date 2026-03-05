'use strict';

const { analyzeMeetingDocument, _internal } = require('./analyze-meeting-document');

/**
 * Extract only the recommendations section from a committee report document.
 * Accepts either a report URL or raw report text (e.g. from a get reports response).
 *
 * @param {object} params
 * @param {string} [params.url]
 * @param {string} [params.report_text]
 * @param {number} [params.max_items=20]
 * @returns {Promise<object>}
 */
async function getReportRecommendations(params = {}) {
    const url = params.url;
    const reportText = params.report_text;
    const maxItems = params.max_items || 20;

    if (typeof reportText === 'string' && reportText.trim().length > 0) {
        const extraction = _internal.extractCabinetRecommendationData(reportText, maxItems);

        return {
            success: true,
            title: null,
            document_type: 'committee_report',
            recommendations: extraction.recommendations,
            cabinet_recommendation_text: extraction.cabinet_recommendation_text,
            recommendation_extraction: extraction.extraction,
            warnings: extraction.recommendations.length === 0 ? ['No formal recommendations detected in supplied report text'] : [],
            metadata: {
                page_count: null,
                source_url: null,
                extraction_confidence: extraction.extraction?.confidence || 'low'
            },
            data_classification: 'official_record',
            is_official_record: true,
            official_sections: ['recommendations', 'cabinet_recommendation_text']
        };
    }

    if (!url || typeof url !== 'string') {
        return {
            success: false,
            error: 'Either url or report_text is required',
            error_type: 'invalid_input',
            suggestion: 'Pass report_text from get reports, or provide a report PDF URL from get_attachment.'
        };
    }

    const analysis = await analyzeMeetingDocument(url, ['recommendations'], maxItems);

    if (!analysis.success) {
        return analysis;
    }

    return {
        success: true,
        title: analysis.title || null,
        document_type: analysis.document_type,
        recommendations: analysis.sections?.recommendations || [],
        cabinet_recommendation_text: analysis.sections?.cabinet_recommendation_text || null,
        recommendation_extraction: analysis.sections?.recommendation_extraction || null,
        warnings: analysis.warnings || [],
        metadata: {
            page_count: analysis.metadata?.page_count || null,
            source_url: analysis.metadata?.source_url || url,
            extraction_confidence: analysis.metadata?.section_confidence?.recommendations || analysis.metadata?.extraction_confidence || 'low'
        },
        data_classification: analysis.data_classification,
        is_official_record: analysis.is_official_record,
        official_sections: ['recommendations', 'cabinet_recommendation_text']
    };
}

module.exports = {
    getReportRecommendations
};
