'use strict';

jest.mock('../lib/tools/analyze-meeting-document', () => ({
    analyzeMeetingDocument: jest.fn(),
    _internal: {
        extractCabinetRecommendationData: jest.fn()
    }
}));

const { analyzeMeetingDocument, _internal } = require('../lib/tools/analyze-meeting-document');
const { getReportRecommendations } = require('../lib/tools/get-report-recommendations');

describe('getReportRecommendations', () => {
    it('extracts recommendations from report_text input', async () => {
        _internal.extractCabinetRecommendationData.mockReturnValueOnce({
            recommendations: ['the review findings be noted'],
            cabinet_recommendation_text: '(1) the review findings be noted',
            extraction: { confidence: 'high', heading_detected: '2.0 Recommendations' }
        });

        const result = await getReportRecommendations({
            report_text: '2.0 Recommendations\n(1) the review findings be noted',
            max_items: 10
        });

        expect(_internal.extractCabinetRecommendationData).toHaveBeenCalledWith('2.0 Recommendations\n(1) the review findings be noted', 10);
        expect(result.success).toBe(true);
        expect(result.recommendations).toEqual(['the review findings be noted']);
        expect(result.metadata.extraction_confidence).toBe('high');
    });

    it('uses URL analysis path when url is provided', async () => {
        analyzeMeetingDocument.mockResolvedValueOnce({
            success: true,
            title: 'Finance Report',
            document_type: 'committee_report',
            sections: {
                recommendations: ['approve budget'],
                cabinet_recommendation_text: 'That Cabinet approves budget.',
                recommendation_extraction: { confidence: 'high' }
            },
            warnings: [],
            metadata: {
                page_count: 4,
                source_url: 'https://example.com/report.pdf',
                extraction_confidence: 'high',
                section_confidence: { recommendations: 'high' }
            },
            data_classification: 'official_record',
            is_official_record: true
        });

        const result = await getReportRecommendations({ url: 'https://example.com/report.pdf', max_items: 10 });

        expect(analyzeMeetingDocument).toHaveBeenCalledWith('https://example.com/report.pdf', ['recommendations'], 10);
        expect(result.success).toBe(true);
        expect(result.recommendations).toEqual(['approve budget']);
        expect(result.cabinet_recommendation_text).toBe('That Cabinet approves budget.');
        expect(result.metadata.extraction_confidence).toBe('high');
    });

    it('returns invalid input when neither report_text nor url is provided', async () => {
        const result = await getReportRecommendations({ max_items: 10 });

        expect(result.success).toBe(false);
        expect(result.error_type).toBe('invalid_input');
    });
});
