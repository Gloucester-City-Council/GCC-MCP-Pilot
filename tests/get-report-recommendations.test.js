'use strict';

jest.mock('../lib/tools/analyze-meeting-document', () => ({
    analyzeMeetingDocument: jest.fn()
}));

const { analyzeMeetingDocument } = require('../lib/tools/analyze-meeting-document');
const { getReportRecommendations } = require('../lib/tools/get-report-recommendations');

describe('getReportRecommendations', () => {
    it('returns only recommendation-focused payload when analysis succeeds', async () => {
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

        const result = await getReportRecommendations('https://example.com/report.pdf', 10);

        expect(analyzeMeetingDocument).toHaveBeenCalledWith('https://example.com/report.pdf', ['recommendations'], 10);
        expect(result.success).toBe(true);
        expect(result.recommendations).toEqual(['approve budget']);
        expect(result.cabinet_recommendation_text).toBe('That Cabinet approves budget.');
        expect(result.metadata.extraction_confidence).toBe('high');
    });

    it('passes through error payload from analyzeMeetingDocument', async () => {
        analyzeMeetingDocument.mockResolvedValueOnce({
            success: false,
            error: 'Document not found'
        });

        const result = await getReportRecommendations('https://example.com/missing.pdf');

        expect(result).toEqual({
            success: false,
            error: 'Document not found'
        });
    });
});
