'use strict';

const { analyzeMeetingDocument } = require('./analyze-meeting-document');

/**
 * Extract only the recommendations section from a committee report document.
 * @param {string} url
 * @param {number} maxItems
 * @returns {Promise<object>}
 */
async function getReportRecommendations(url, maxItems = 20) {
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
