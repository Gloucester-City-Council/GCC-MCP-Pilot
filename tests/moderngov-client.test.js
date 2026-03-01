'use strict';

jest.mock('axios');
jest.mock('../lib/council-config', () => ({
    getEndpoint: (name) => name === 'Gloucester City Council'
        ? 'https://democracy.gloucester.gov.uk/mgWebService.asmx'
        : null,
    getCouncilNames: () => ['Gloucester City Council'],
    getCouncil: (name) => name === 'Gloucester City Council'
        ? { name, url: 'https://democracy.gloucester.gov.uk', endpoint: 'https://democracy.gloucester.gov.uk/mgWebService.asmx' }
        : null
}));

const axios = require('axios');
const client = require('../lib/moderngov-client');

// Minimal valid SOAP XML for GetCommittees
const COMMITTEES_XML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetCommitteesResponse xmlns="http://moderngov.co.uk/namespaces">
      <GetCommitteesResult>
        <committees>
          <committee>
            <committeeid>42</committeeid>
            <committeetitle>Planning Committee</committeetitle>
            <committeedeleted>False</committeedeleted>
            <committeeexpired>False</committeeexpired>
          </committee>
        </committees>
      </GetCommitteesResult>
    </GetCommitteesResponse>
  </soap:Body>
</soap:Envelope>`;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('_getEndpoint', () => {
    it('throws for an unknown council', () => {
        expect(() => client._getEndpoint('Fake Council')).toThrow('Unknown council: Fake Council');
    });

    it('returns endpoint for a known council', () => {
        const endpoint = client._getEndpoint('Gloucester City Council');
        expect(endpoint).toBe('https://democracy.gloucester.gov.uk/mgWebService.asmx');
    });
});

describe('_buildSoapEnvelope', () => {
    it('wraps operation and body content in a SOAP envelope', () => {
        const envelope = client._buildSoapEnvelope('GetCommittees', '<lCommitteeId>1</lCommitteeId>');
        expect(envelope).toContain('<soap:Envelope');
        expect(envelope).toContain('<GetCommittees');
        expect(envelope).toContain('<lCommitteeId>1</lCommitteeId>');
        expect(envelope).toContain('</GetCommittees>');
        expect(envelope).toContain('</soap:Envelope>');
    });

    it('works with empty body content', () => {
        const envelope = client._buildSoapEnvelope('GetCommittees');
        expect(envelope).toContain('<GetCommittees');
        expect(envelope).toContain('</GetCommittees>');
    });
});

describe('DOCTYPE stripping', () => {
    it('succeeds when response contains a DOCTYPE declaration', async () => {
        const xmlWithDoctype = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe "test">]>
${COMMITTEES_XML.replace('<?xml version="1.0" encoding="utf-8"?>\n', '')}`;

        axios.post.mockResolvedValueOnce({ data: xmlWithDoctype });

        const result = await client.getCommittees('Gloucester City Council');
        expect(result).toBeDefined();
        expect(axios.post).toHaveBeenCalledTimes(1);
    });
});

describe('retry logic', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('retries up to 3 times on network errors then throws', async () => {
        const networkError = new Error('ECONNRESET');
        axios.post.mockRejectedValue(networkError);

        const promise = client.getCommittees('Gloucester City Council');
        // Suppress the unhandled rejection so Jest doesn't fail on it before our assertion
        promise.catch(() => {});
        await jest.runAllTimersAsync();

        await expect(promise).rejects.toThrow('SOAP request failed for Gloucester City Council: ECONNRESET');
        expect(axios.post).toHaveBeenCalledTimes(3);
    });

    it('retries on 5xx server errors', async () => {
        const serverError = Object.assign(new Error('Internal Server Error'), {
            response: { status: 500, data: 'Internal Server Error' }
        });
        axios.post.mockRejectedValue(serverError);

        const promise = client.getCommittees('Gloucester City Council');
        promise.catch(() => {});
        await jest.runAllTimersAsync();

        await expect(promise).rejects.toThrow('500');
        expect(axios.post).toHaveBeenCalledTimes(3);
    });

    it('does not retry on 4xx client errors', async () => {
        const clientError = Object.assign(new Error('Not Found'), {
            response: { status: 404, data: 'Not Found' }
        });
        axios.post.mockRejectedValue(clientError);

        // No timers needed — 4xx throws immediately without waiting
        await expect(client.getCommittees('Gloucester City Council')).rejects.toThrow('404');
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('succeeds on third attempt after two transient failures', async () => {
        const networkError = new Error('ECONNRESET');
        axios.post
            .mockRejectedValueOnce(networkError)
            .mockRejectedValueOnce(networkError)
            .mockResolvedValueOnce({ data: COMMITTEES_XML });

        const promise = client.getCommittees('Gloucester City Council');
        await jest.runAllTimersAsync();

        const result = await promise;
        expect(axios.post).toHaveBeenCalledTimes(3);
        expect(result).toBeDefined();
    });
});

describe('getCommittees', () => {
    it('parses committee data from a successful response', async () => {
        axios.post.mockResolvedValueOnce({ data: COMMITTEES_XML });

        const result = await client.getCommittees('Gloucester City Council');

        expect(Array.isArray(result)).toBe(true);
        expect(result[0].id).toBe(42);
        expect(result[0].name).toBe('Planning Committee');
        expect(result[0].deleted).toBe(false);
    });

    it('sends the correct SOAP action header', async () => {
        axios.post.mockResolvedValueOnce({ data: COMMITTEES_XML });

        await client.getCommittees('Gloucester City Council');

        const callArgs = axios.post.mock.calls[0];
        expect(callArgs[2].headers['SOAPAction']).toContain('GetCommittees');
        expect(callArgs[2].headers['Content-Type']).toContain('text/xml');
    });

    it('uses a 30 second timeout', async () => {
        axios.post.mockResolvedValueOnce({ data: COMMITTEES_XML });

        await client.getCommittees('Gloucester City Council');

        const callArgs = axios.post.mock.calls[0];
        expect(callArgs[2].timeout).toBe(30000);
    });

    it('throws a clean error for an unknown council', async () => {
        await expect(client.getCommittees('Unknown Council')).rejects.toThrow('Unknown council: Unknown Council');
        expect(axios.post).not.toHaveBeenCalled();
    });
});
