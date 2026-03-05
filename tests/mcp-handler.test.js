'use strict';

// Mock all tool modules and council-config before requiring mcp-handler
jest.mock('../lib/council-config', () => ({
    getCouncilNames: () => ['Gloucester City Council', 'Cheltenham Borough Council'],
    getAllCouncilsSummary: () => [
        {
            name: 'Gloucester City Council',
            url: 'https://democracy.gloucester.gov.uk',
            has_committees: true,
            has_wards: true,
            committee_count: 18,
            ward_count: 34
        },
        {
            name: 'Cheltenham Borough Council',
            url: 'https://democracy.cheltenham.gov.uk',
            has_committees: true,
            has_wards: true,
            committee_count: 16,
            ward_count: 20
        }
    ]
}));

jest.mock('../lib/tools/list-committees', () => ({
    listCommittees: jest.fn().mockResolvedValue({ committees: [] })
}));
jest.mock('../lib/tools/get-councillors', () => ({
    getCouncillors: jest.fn().mockResolvedValue({ wards: [] })
}));
jest.mock('../lib/tools/get-councillors-by-ward', () => ({
    getCouncillorsByWard: jest.fn().mockResolvedValue({ ward_name: 'Test Ward', councillors: [] })
}));
jest.mock('../lib/tools/get-meetings', () => ({
    getMeetings: jest.fn().mockResolvedValue({ meetings: [] })
}));
jest.mock('../lib/tools/get-meeting-details', () => ({
    getMeetingDetails: jest.fn().mockResolvedValue({ details: {}, agenda: [], attendees: [] })
}));
jest.mock('../lib/tools/get-attachment', () => ({
    getAttachment: jest.fn().mockResolvedValue({ attachmentid: 1, title: 'Test Doc', url: 'https://example.com' })
}));
jest.mock('../lib/tools/analyze-meeting-document', () => ({
    analyzeMeetingDocument: jest.fn().mockResolvedValue({ success: true })
}));
jest.mock('../lib/tools/get-report-recommendations', () => ({
    getReportRecommendations: jest.fn().mockResolvedValue({ success: true, recommendations: [] })
}));

const { handleMcpRequest, TOOLS } = require('../lib/mcp-handler');

const mockContext = {
    log: Object.assign(jest.fn(), { error: jest.fn() })
};

describe('handleMcpRequest - protocol validation', () => {
    it('rejects non-2.0 jsonrpc version', async () => {
        const result = await handleMcpRequest(
            { jsonrpc: '1.0', method: 'initialize', id: 1 },
            mockContext
        );
        expect(result.error.code).toBe(-32600);
        expect(result.jsonrpc).toBe('2.0');
    });


    it('rejects non-object JSON-RPC payloads', async () => {
        const result = await handleMcpRequest(null, mockContext);
        expect(result.error.code).toBe(-32600);
        expect(result.error.message).toMatch(/body must be a JSON object/);
        expect(result.id).toBeNull();
    });

    it('returns null for notifications/initialized', async () => {
        const result = await handleMcpRequest(
            { jsonrpc: '2.0', method: 'notifications/initialized', id: null },
            mockContext
        );
        expect(result).toBeNull();
    });

    it('returns -32601 for unknown method', async () => {
        const result = await handleMcpRequest(
            { jsonrpc: '2.0', method: 'nonexistent/method', id: 5 },
            mockContext
        );
        expect(result.error.code).toBe(-32601);
        expect(result.id).toBe(5);
    });
});

describe('handleMcpRequest - initialize', () => {
    it('returns protocol version and server info', async () => {
        const result = await handleMcpRequest(
            { jsonrpc: '2.0', method: 'initialize', id: 1 },
            mockContext
        );
        expect(result.result.protocolVersion).toBe('2024-11-05');
        expect(result.result.serverInfo.name).toBe('gloucestershire-moderngov-mcp');
        expect(result.result.serverInfo.councils).toContain('Gloucester City Council');
        expect(result.id).toBe(1);
    });

    it('includes date context in server info', async () => {
        const result = await handleMcpRequest(
            { jsonrpc: '2.0', method: 'initialize', id: 2 },
            mockContext
        );
        expect(result.result.serverInfo.current_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(result.result.serverInfo.current_date_uk).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    });
});

describe('handleMcpRequest - ping', () => {
    it('returns empty result', async () => {
        const result = await handleMcpRequest(
            { jsonrpc: '2.0', method: 'ping', id: 99 },
            mockContext
        );
        expect(result.result).toEqual({});
        expect(result.id).toBe(99);
    });
});

describe('handleMcpRequest - tools/list', () => {
    it('returns the tools array', async () => {
        const result = await handleMcpRequest(
            { jsonrpc: '2.0', method: 'tools/list', id: 3 },
            mockContext
        );
        expect(Array.isArray(result.result.tools)).toBe(true);
        expect(result.result.tools.length).toBe(9);
    });

    it('each tool has name, description, and inputSchema', () => {
        for (const tool of TOOLS) {
            expect(typeof tool.name).toBe('string');
            expect(typeof tool.description).toBe('string');
            expect(tool.inputSchema).toBeDefined();
            expect(tool.inputSchema.type).toBe('object');
        }
    });

    it('analyze_meeting_document requires url', () => {
        const tool = TOOLS.find(t => t.name === 'analyze_meeting_document');
        expect(tool.inputSchema.required).toContain('url');
    });

    it('get_report_recommendations requires url', () => {
        const tool = TOOLS.find(t => t.name === 'get_report_recommendations');
        expect(tool.inputSchema.required).toContain('url');
    });

    it('get_meetings requires council_name and committee_id', () => {
        const tool = TOOLS.find(t => t.name === 'get_meetings');
        expect(tool.inputSchema.required).toContain('council_name');
        expect(tool.inputSchema.required).toContain('committee_id');
    });
});

describe('handleMcpRequest - tools/call', () => {
    it('returns -32602 when tool name is missing', async () => {
        const result = await handleMcpRequest(
            { jsonrpc: '2.0', method: 'tools/call', params: {}, id: 4 },
            mockContext
        );
        expect(result.error.code).toBe(-32602);
    });

    it('returns -32602 for an unknown tool name', async () => {
        const result = await handleMcpRequest(
            { jsonrpc: '2.0', method: 'tools/call', params: { name: 'does_not_exist' }, id: 5 },
            mockContext
        );
        expect(result.error.code).toBe(-32602);
        expect(result.error.message).toMatch(/Unknown tool/);
    });

    it('returns data wrapped with date context on success', async () => {
        const result = await handleMcpRequest(
            {
                jsonrpc: '2.0',
                method: 'tools/call',
                params: { name: 'list_available_councils', arguments: {} },
                id: 6
            },
            mockContext
        );
        const payload = JSON.parse(result.result.content[0].text);
        expect(payload.current_date).toBeDefined();
        expect(payload.data.councils).toBeDefined();
        expect(payload.data.total_count).toBe(2);
    });

    it('returns sanitized error when tool throws', async () => {
        const { listCommittees } = require('../lib/tools/list-committees');
        listCommittees.mockRejectedValueOnce(new Error('TypeError: Cannot read properties of null'));

        const result = await handleMcpRequest(
            {
                jsonrpc: '2.0',
                method: 'tools/call',
                params: { name: 'list_committees', arguments: {} },
                id: 7
            },
            mockContext
        );
        expect(result.result.isError).toBe(true);
        const payload = JSON.parse(result.result.content[0].text);
        // Should sanitize internal JS error patterns
        expect(payload.error).toBe('An internal error occurred during tool execution');
    });

    it('strips XML/SOAP from error messages', async () => {
        const { getMeetings } = require('../lib/tools/get-meetings');
        getMeetings.mockRejectedValueOnce(
            new Error('SOAP request failed for Gloucester City Council: 500 - <?xml version="1.0"?><Fault>boom</Fault>')
        );

        const result = await handleMcpRequest(
            {
                jsonrpc: '2.0',
                method: 'tools/call',
                params: { name: 'get_meetings', arguments: { council_name: 'Gloucester City Council', committee_id: 1 } },
                id: 8
            },
            mockContext
        );
        const payload = JSON.parse(result.result.content[0].text);
        expect(payload.error).not.toContain('<?xml');
        expect(payload.error).toContain('SOAP request failed');
    });


    it('routes get_report_recommendations tool calls', async () => {
        const { getReportRecommendations } = require('../lib/tools/get-report-recommendations');
        getReportRecommendations.mockResolvedValueOnce({ success: true, recommendations: ['a'] });

        const result = await handleMcpRequest(
            {
                jsonrpc: '2.0',
                method: 'tools/call',
                params: { name: 'get_report_recommendations', arguments: { url: 'https://example.com/report.pdf' } },
                id: 41
            },
            mockContext
        );

        const payload = JSON.parse(result.result.content[0].text);
        expect(payload.data.recommendations).toEqual(['a']);
        expect(getReportRecommendations).toHaveBeenCalledWith('https://example.com/report.pdf', 20);
    });

    it('preserves request id in response', async () => {
        const result = await handleMcpRequest(
            {
                jsonrpc: '2.0',
                method: 'tools/call',
                params: { name: 'list_available_councils', arguments: {} },
                id: 42
            },
            mockContext
        );
        expect(result.id).toBe(42);
    });
});
