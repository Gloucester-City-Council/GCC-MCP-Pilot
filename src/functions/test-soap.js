/**
 * Test SOAP Endpoint
 *
 * This function is for exploring ModernGov SOAP API responses.
 * Use it to discover the actual XML structure before implementing proper parsing.
 *
 * Examples:
 *   curl http://localhost:7071/api/test-soap/GetCommittees
 *   curl "http://localhost:7071/api/test-soap/GetCouncillorsByPostcode?postcode=GL1%201AA"
 *   curl http://localhost:7071/api/test-soap/GetMeetings
 */

const { app } = require('@azure/functions');
const axios = require('axios');

const MODERNGOV_ENDPOINT = process.env.MODERNGOV_ENDPOINT ||
    'https://democracy.gloucester.gov.uk/mgWebService.asmx';

const SOAP_NAMESPACE = 'http://moderngov.co.uk/namespaces';

// Known operations to try
const KNOWN_OPERATIONS = {
    'GetCommittees': '',
    'GetCouncillorsByPostcode': '<postcode>{postcode}</postcode>',
    'GetMeetings': '<committeeId>{committeeId}</committeeId>',
    'GetMeeting': '<meetingId>{meetingId}</meetingId>',
    'GetCouncillors': '',
    'GetWards': '',
    'GetDocuments': '<meetingId>{meetingId}</meetingId>',
    'GetAgendaItems': '<meetingId>{meetingId}</meetingId>'
};

app.http('testSoap', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'test-soap/{operation?}',
    handler: async (request, context) => {
        const operation = request.params.operation;

        // If no operation specified, return help
        if (!operation) {
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'ModernGov SOAP API Test Endpoint',
                    usage: '/api/test-soap/{operation}',
                    known_operations: Object.keys(KNOWN_OPERATIONS),
                    examples: [
                        '/api/test-soap/GetCommittees',
                        '/api/test-soap/GetCouncillorsByPostcode?postcode=GL1%201AA',
                        '/api/test-soap/GetMeetings?committeeId=123',
                        '/api/test-soap/GetMeeting?meetingId=456'
                    ],
                    note: 'Use this endpoint to explore SOAP response structures before implementing parsing'
                }, null, 2)
            };
        }

        // Get query parameters
        const url = new URL(request.url);
        const postcode = url.searchParams.get('postcode') || 'GL1 1AA';
        const committeeId = url.searchParams.get('committeeId') || '0';
        const meetingId = url.searchParams.get('meetingId') || '0';

        // Build body content with parameters
        let bodyContent = KNOWN_OPERATIONS[operation] || '';
        bodyContent = bodyContent
            .replace('{postcode}', postcode)
            .replace('{committeeId}', committeeId)
            .replace('{meetingId}', meetingId);

        // Build SOAP envelope
        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <${operation} xmlns="${SOAP_NAMESPACE}">
      ${bodyContent}
    </${operation}>
  </soap:Body>
</soap:Envelope>`;

        context.log(`Testing SOAP operation: ${operation}`);
        context.log(`Endpoint: ${MODERNGOV_ENDPOINT}`);
        context.log(`SOAP Envelope: ${soapEnvelope}`);

        try {
            const response = await axios.post(
                MODERNGOV_ENDPOINT,
                soapEnvelope,
                {
                    headers: {
                        'Content-Type': 'text/xml; charset=utf-8',
                        'SOAPAction': `${SOAP_NAMESPACE}/${operation}`
                    },
                    timeout: 30000
                }
            );

            context.log('SOAP response received successfully');

            // Return raw XML for inspection
            return {
                status: 200,
                headers: {
                    'Content-Type': 'application/xml',
                    'X-SOAP-Operation': operation,
                    'X-ModernGov-Endpoint': MODERNGOV_ENDPOINT
                },
                body: response.data
            };
        } catch (error) {
            context.log.error('SOAP test error:', error.message);

            // Try to extract useful error info
            const errorDetails = {
                operation,
                endpoint: MODERNGOV_ENDPOINT,
                error: error.message,
                soap_envelope_sent: soapEnvelope
            };

            if (error.response) {
                errorDetails.status = error.response.status;
                errorDetails.response_data = error.response.data;
            }

            if (error.code) {
                errorDetails.error_code = error.code;
            }

            return {
                status: error.response?.status || 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(errorDetails, null, 2)
            };
        }
    }
});
