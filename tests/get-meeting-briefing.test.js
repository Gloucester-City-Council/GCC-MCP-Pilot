'use strict';

jest.mock('../lib/tools/get-meeting-details', () => ({
    getMeetingDetails: jest.fn()
}));

jest.mock('../lib/tools/analyze-meeting-document', () => ({
    analyzeMeetingDocument: jest.fn()
}));

jest.mock('../lib/tools/get-report-recommendations', () => ({
    getReportRecommendations: jest.fn()
}));

const { getMeetingDetails } = require('../lib/tools/get-meeting-details');
const { analyzeMeetingDocument } = require('../lib/tools/analyze-meeting-document');
const { getReportRecommendations } = require('../lib/tools/get-report-recommendations');
const { getMeetingBriefing, _internal } = require('../lib/tools/get-meeting-briefing');

describe('get-meeting-briefing internals', () => {
    it('classifies recommendation to council', () => {
        const status = _internal.classifyDecisionStatus({
            title: 'Housing Strategy',
            decision: '',
            recommendations: ['That Cabinet recommends to Council adoption of the strategy.'],
            reason: ''
        });
        expect(status).toBe('Recommendation to Council');
    });

    it('classifies appendices', () => {
        expect(_internal.classifyAppendixType('Appendix A - Draft Policy')).toBe('draft policy');
        expect(_internal.classifyAppendixType('Appendix B - Financial Impact')).toBe('financial schedule');
    });
});

describe('getMeetingBriefing', () => {
    it('builds item and meeting level outputs', async () => {
        getMeetingDetails.mockResolvedValue({
            council: 'Gloucester City Council',
            meeting_id: 100,
            details: { date: '01/01/2026' },
            agenda: [
                {
                    id: 1,
                    number: '5',
                    title: 'Budget update report',
                    decision: '<p>Approve the budget update.</p>',
                    linked_documents: [
                        { title: 'Main report', url: 'https://example.com/report.pdf' },
                        { title: 'Appendix A - Financial schedule', url: 'https://example.com/a.pdf' }
                    ]
                }
            ],
            links: { web_page: 'https://example.com/meeting' }
        });

        analyzeMeetingDocument.mockResolvedValue({
            success: true,
            summary: 'Sets out budget changes for 2026/27.',
            author: 'Jane Officer',
            sections: {
                reason_for_report: 'To seek approval for revised revenue and capital budgets.',
                financial_implications: 'The report identifies a net pressure of £1.2m.',
                legal_implications: 'The authority must set a balanced budget under the Local Government Finance Act 1992.',
                risk_assessment: 'Failure to approve mitigation could increase in-year overspend.'
            },
            metadata: { extraction_confidence: 'high' }
        });

        getReportRecommendations.mockResolvedValue({
            success: true,
            recommendations: [{ text: 'That Cabinet approve the revised budget.' }],
            metadata: { extraction_confidence: 'high' }
        });

        const result = await getMeetingBriefing('Gloucester City Council', 100, true);
        expect(result.agenda_item_briefings).toHaveLength(1);
        expect(result.agenda_item_briefings[0].official_recommendation).toMatch(/That Cabinet approve the revised budget/);
        expect(result.meeting_level_briefing.meeting_overview).toMatch(/Meeting contains 1 agenda items/);
    });
});
