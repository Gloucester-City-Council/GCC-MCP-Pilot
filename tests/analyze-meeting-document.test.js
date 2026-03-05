'use strict';

jest.mock('axios');
jest.mock('pdf-parse');
jest.mock('../lib/council-config', () => ({
    getCouncilNames: () => ['Gloucester City Council'],
    getCouncil: () => ({ name: 'Gloucester City Council', url: 'https://democracy.gloucester.gov.uk' })
}));

const axios = require('axios');
const pdfParse = require('pdf-parse');
const { analyzeMeetingDocument, _internal } = require('../lib/tools/analyze-meeting-document');

describe('analyzeMeetingDocument recommendation extraction', () => {
    it('extracts formal cabinet recommendation text and narrative lines from Recommendations section', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 2,
            text: [
                'Cabinet Report',
                'Reason for Report',
                'To set out options for the parking review.',
                '1.0 Recommendations',
                '1.1. That Cabinet approves the updated parking tariffs.',
                '1.2. That Cabinet notes the consultation feedback.',
                '1.3. Officers will continue monitoring city centre usage.',
                '2.0 Financial Implications',
                'The proposals are cost neutral.'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=1', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.cabinet_recommendation_text).toMatch(/That Cabinet approves/i);
        expect(result.sections.report_recommendations_or_conclusions).toMatch(/Officers will continue monitoring/i);
        expect(result.sections.recommendation_extraction.confidence).toBe('high');
        expect(result.sections.recommendation_extraction.evidence_pages).toContain(1);
    });

    it('supports formal Council recommendation wording under Recommendations heading', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 1,
            text: [
                'Council Report',
                'Recommendations',
                '1. That Council adopts the updated Unauthorised Camping Policy.',
                '2. That Council notes the implementation plan.',
                'Background',
                'Additional context.'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=3', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.cabinet_recommendation_text).toMatch(/That Council adopts/i);
        expect(result.sections.recommendations.length).toBeGreaterThan(0);
        expect(result.sections.recommendation_extraction.confidence).toBe('high');
    });

    it('extracts RESOLVE decision list under Recommendations heading', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 1,
            text: [
                'Resource Requirements for GCC Finance Team',
                '2.0 Recommendations',
                'Cabinet is asked to RESOLVE that:',
                '(1) the review findings be noted, and officers be supported to address the recommendations therein;',
                '(2) the recommended new structure for the Finance Team in Appendix 2 be noted.',
                '3.0 Background and Key Issues'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=4', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.cabinet_recommendation_text).toContain('the review findings be noted');
        expect(result.sections.cabinet_recommendation_text).toContain('the recommended new structure for the Finance Team in Appendix 2 be noted');
        expect(result.sections.recommendation_extraction.confidence).toBe('high');
        expect(result.sections.recommendation_extraction.heading_detected).toBe('2.0 Recommendations');
        expect(result.sections.recommendation_extraction.decision_trigger).toMatch(/Cabinet\s+is\s+asked\s+to\s+RESOLVE\s+that/i);
        expect(result.sections.recommendation_extraction.evidence_pages).toContain(1);
    });


    it('extracts recommendations when blank lines separate trigger and list items', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 1,
            text: [
                'Resource Requirements for GCC Finance Team',
                '2.0 Recommendations',
                '',
                '2.1 Cabinet is asked to RESOLVE that:',
                '',
                '(1) the review findings be noted, and officers be supported to address the recommendations therein;',
                '',
                '(2) the recommended new structure for the Finance Team in Appendix 2 be noted.',
                '3.0 Background and Key Issues'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=4', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.recommendations).toHaveLength(2);
        expect(result.sections.recommendations[0]).toContain('the review findings be noted');
        expect(result.sections.recommendations[1]).toContain('the recommended new structure for the Finance Team in Appendix 2 be noted');
    });

    it('matches trigger text split across lines and non-breaking spaces', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 1,
            text: [
                'Resource Requirements for GCC Finance Team',
                '2.0   Recommendations',
                'Cabinet\u00A0is asked',
                'to   RESOLVE',
                'that:',
                '(1) the review findings be noted;',
                '(2) the recommended structure be noted.',
                '3.0 Background and Key Issues'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=5', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.recommendations).toHaveLength(2);
        expect(result.sections.cabinet_recommendation_text).toContain('the review findings be noted');
        expect(result.sections.recommendation_extraction.confidence).toBe('high');
        expect(result.sections.recommendation_extraction.decision_trigger).toMatch(/cabinet is asked to resolve that/i);
    });


    it('matches Council is asked to RESOLVE that trigger across line breaks', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 1,
            text: [
                'Council Report',
                'Recommendations',
                'Council is asked to',
                'RESOLVE that:',
                '1. the policy be approved.',
                '2. the delivery plan be noted.',
                'Background',
                'Context'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=7', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.recommendations).toHaveLength(2);
        expect(result.sections.recommendation_extraction.decision_trigger).toMatch(/council\s+is\s+asked\s+to\s+resolve\s+that/i);
        expect(result.sections.recommendation_extraction.confidence).toBe('high');
    });

    it('matches Committee is asked to resolve trigger with messy spacing', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 1,
            text: [
                'Committee Report',
                '2.0 Recommendations',
                'Committee\u00A0is asked   to',
                'resolve   that:',
                '(1) the draft action plan be endorsed;',
                '(2) officers proceed with procurement.',
                '3.0 Financial Implications',
                'Contained within existing budget.'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=8', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.recommendations).toHaveLength(2);
        expect(result.sections.recommendation_extraction.decision_trigger).toMatch(/committee\s+is\s+asked\s+to\s+resolve\s+that/i);
        expect(result.sections.recommendation_extraction.confidence).toBe('high');
    });
    it('supports RESOLVED that trigger under Recommendations heading', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 1,
            text: [
                'Cabinet Report',
                'Recommendations',
                'RESOLVED',
                'that:',
                '1. the strategy be approved.',
                '2. officers report back in six months.',
                'Background',
                'Context'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=6', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.recommendations).toHaveLength(2);
        expect(result.sections.recommendation_extraction.decision_trigger).toMatch(/resolved that/i);
        expect(result.sections.recommendation_extraction.confidence).toBe('high');
    });

    it('supports The Committee is recommended to trigger', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 1,
            text: [
                'Committee Report',
                '2.0 Recommendations',
                'The Committee is recommended to:',
                'a) approve the draft scheme;',
                'b) delegate final wording to officers.',
                '3.0 Legal Implications'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=9', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.recommendations).toHaveLength(2);
        expect(result.sections.recommendation_extraction.decision_trigger).toMatch(/the\s+committee\s+is\s+recommended\s+to/i);
        expect(result.sections.recommendation_extraction.confidence).toBe('high');
    });

    it('supports RECOMMENDED that trigger with control characters and tight bullets', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 1,
            text: [
                'Council Report',
                'Recommendations',
                'RECOMMENDED\u0007 that:',
                '(1)the budget be approved;',
                '(2)the implementation plan be noted.',
                'Background',
                'Context'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=10', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.recommendations).toHaveLength(2);
        expect(result.sections.recommendation_extraction.decision_trigger).toMatch(/recommended\s+that/i);
        expect(result.sections.recommendation_extraction.confidence).toBe('high');
    });

    it('returns low confidence and null cabinet recommendation text when no formal wording exists', async () => {
        axios.get.mockResolvedValue({ data: Buffer.from('fake pdf') });
        pdfParse.mockResolvedValue({
            numpages: 2,
            text: [
                'Policy Report',
                'Reason for Report',
                'To update Cabinet on policy work.',
                '7.0 Recommendations',
                '7.1 Officers will continue engaging with stakeholders.',
                '7.2 Further review is recommended.',
                '8.0 Financial Implications',
                'No additional budget requested.'
            ].join('\n')
        });

        const result = await analyzeMeetingDocument('https://democracy.gloucester.gov.uk/mgConvert2PDF.aspx?ID=2', ['recommendations'], 20);

        expect(result.success).toBe(true);
        expect(result.sections.cabinet_recommendation_text).toBeNull();
        expect(result.sections.recommendation_extraction.confidence).toBe('low');
        expect(result.sections.recommendation_extraction.message).toMatch(/No formal Cabinet\/Council recommendation wording detected/i);
        expect(result.warnings).toContain('No formal Cabinet/Council recommendation wording detected');
    });
});


describe('extractCabinetRecommendationData input hardening', () => {
    it('handles non-string extracted text inputs without throwing', () => {
        const result = _internal.extractCabinetRecommendationData(Buffer.from([
            0x52, 0x65, 0x63, 0x6f, 0x6d, 0x6d, 0x65, 0x6e, 0x64, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x73, 0x0a,
            0x52, 0x45, 0x43, 0x4f, 0x4d, 0x4d, 0x45, 0x4e, 0x44, 0x45, 0x44, 0x20, 0x74, 0x68, 0x61, 0x74, 0x3a, 0x0a,
            0x31, 0x2e, 0x20, 0x54, 0x68, 0x61, 0x74, 0x20, 0x43, 0x6f, 0x75, 0x6e, 0x63, 0x69, 0x6c, 0x20, 0x61, 0x70, 0x70, 0x72, 0x6f, 0x76, 0x65, 0x73
        ]), 10);

        expect(result.recommendations).toHaveLength(1);
        expect(result.recommendations[0]).toMatch(/That Council approves/i);
        expect(result.extraction.confidence).toBe('high');
    });
});
