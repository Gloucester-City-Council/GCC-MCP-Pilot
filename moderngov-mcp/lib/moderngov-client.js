/**
 * ModernGov SOAP Client
 *
 * IMPORTANT: This is currently a STUB implementation.
 * We need to explore the actual SOAP responses before implementing proper parsing.
 *
 * Use the test-soap endpoint to see actual XML responses:
 *   curl http://localhost:7071/api/test-soap/GetCommittees
 */

const axios = require('axios');
const xml2js = require('xml2js');

const MODERNGOV_ENDPOINT = process.env.MODERNGOV_ENDPOINT ||
    'https://democracy.gloucester.gov.uk/mgWebService.asmx';

const SOAP_NAMESPACE = 'http://moderngov.co.uk/namespaces';

class ModernGovClient {
    constructor() {
        this.endpoint = MODERNGOV_ENDPOINT;
        this.parser = new xml2js.Parser({
            explicitArray: false,
            ignoreAttrs: false,
            tagNameProcessors: [xml2js.processors.stripPrefix]
        });
    }

    /**
     * Get all committees
     *
     * TODO: Once we see the actual SOAP response structure, implement proper parsing
     */
    async getCommittees() {
        // STUB: Return placeholder data
        // The actual implementation will call _callSoap('GetCommittees', '')
        return [
            {
                id: 0,
                name: 'STUB_DATA_PENDING_SOAP_RESPONSE',
                note: 'Use /api/test-soap/GetCommittees to see actual response structure'
            }
        ];
    }

    /**
     * Get councillors by postcode
     *
     * @param {string} postcode - UK postcode to look up
     */
    async getCouncillorsByPostcode(postcode) {
        // STUB: Return placeholder data
        // The actual implementation will build SOAP envelope with postcode parameter
        return {
            postcode,
            councillors: [],
            note: 'STUB_DATA_PENDING_SOAP_RESPONSE - Use /api/test-soap/GetCouncillorsByPostcode to explore'
        };
    }

    /**
     * Get meetings for a committee
     *
     * @param {number} committeeId - Committee ID
     * @param {string} fromDate - Start date (optional)
     * @param {string} toDate - End date (optional)
     */
    async getMeetings(committeeId, fromDate, toDate) {
        // STUB: Return placeholder data
        // The actual implementation will build SOAP envelope with parameters
        return {
            committeeId,
            fromDate: fromDate || null,
            toDate: toDate || null,
            meetings: [],
            note: 'STUB_DATA_PENDING_SOAP_RESPONSE - Use /api/test-soap/GetMeetings to explore'
        };
    }

    /**
     * Get details for a specific meeting
     *
     * @param {number} meetingId - Meeting ID
     */
    async getMeeting(meetingId) {
        // STUB: Return placeholder data
        // The actual implementation will build SOAP envelope with meetingId parameter
        return {
            meetingId,
            details: null,
            agenda: [],
            documents: [],
            note: 'STUB_DATA_PENDING_SOAP_RESPONSE - Use /api/test-soap/GetMeeting to explore'
        };
    }

    /**
     * Build a SOAP envelope for a request
     *
     * @param {string} operation - SOAP operation name
     * @param {string} bodyContent - Inner body XML content
     * @returns {string} Complete SOAP envelope
     */
    _buildSoapEnvelope(operation, bodyContent = '') {
        return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <${operation} xmlns="${SOAP_NAMESPACE}">
      ${bodyContent}
    </${operation}>
  </soap:Body>
</soap:Envelope>`;
    }

    /**
     * Make a SOAP request to ModernGov
     *
     * @param {string} operation - SOAP operation name
     * @param {string} bodyContent - Inner body XML content
     * @returns {Promise<object>} Parsed response
     */
    async _callSoap(operation, bodyContent = '') {
        const soapEnvelope = this._buildSoapEnvelope(operation, bodyContent);

        try {
            const response = await axios.post(this.endpoint, soapEnvelope, {
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'SOAPAction': `${SOAP_NAMESPACE}/${operation}`
                },
                timeout: 30000
            });

            // Parse XML response
            const parsed = await this.parser.parseStringPromise(response.data);
            return parsed;
        } catch (error) {
            if (error.response) {
                throw new Error(`SOAP request failed: ${error.response.status} - ${error.response.data}`);
            }
            throw new Error(`SOAP request failed: ${error.message}`);
        }
    }

    /**
     * Get raw SOAP response for debugging/exploration
     *
     * @param {string} operation - SOAP operation name
     * @param {string} bodyContent - Inner body XML content
     * @returns {Promise<string>} Raw XML response
     */
    async _callSoapRaw(operation, bodyContent = '') {
        const soapEnvelope = this._buildSoapEnvelope(operation, bodyContent);

        const response = await axios.post(this.endpoint, soapEnvelope, {
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': `${SOAP_NAMESPACE}/${operation}`
            },
            timeout: 30000
        });

        return response.data;
    }
}

module.exports = new ModernGovClient();
