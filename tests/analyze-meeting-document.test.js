'use strict';

jest.mock('axios');
jest.mock('pdf-parse');
jest.mock('../lib/council-config', () => ({
    getCouncilNames: () => ['Gloucester City Council'],
    getCouncil: () => ({ name: 'Gloucester City Council', url: 'https://democracy.gloucester.gov.uk' })
}));

const axios = require('axios');
const pdfParse = require('pdf-parse');
const { analyzeMeetingDocument } = require('../lib/tools/analyze-meeting-document');

describe('analyzeMeetingDocument recommendation extraction', () => {
    it('extracts formal cabinet recommendation text and evidence', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 3,
            text: [
                'Cabinet Report',
                'Reason for Report',
                'To set out options for the parking review.',
                '1.0 Recommendations',
                '1.1. That Cabinet approves the updated parking tariffs.',
                '1.2. That Cabinet notes the consultation feedback.',
                '\f',
                '7.0 Future Work and Conclusions',
                '7.1 Officers will continue monitoring city centre usage.'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=1', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.cabinet_recommendation_text).toMatch(/That Cabinet approves/i);
        expect(result.sections.report_recommendations_or_conclusions).toMatch(/Officers will continue monitoring/i);
        expect(result.sections.recommendation_extraction.confidence).toBe('high');
        expect(result.sections.recommendation_extraction.evidence_pages).toContain(1);
    });

    it('returns low confidence and null cabinet recommendation text when no formal wording exists', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 2,
            text: [
                'Policy Report',
                'Reason for Report',
                'To update Cabinet on policy work.',
                '7.0 Future Work and Conclusions',
                '7.1 Officers will continue engaging with stakeholders.',
                '7.2 Further review is recommended.'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=2', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.cabinet_recommendation_text).toBeNull();
        expect(result.sections.recommendation_extraction.confidence).toBe('low');
        expect(result.sections.recommendation_extraction.message).toMatch(/No formal Cabinet recommendation wording detected/i);
        expect(result.warnings).toContain('No formal Cabinet recommendation wording detected');
    });
});
