'use strict';

jest.mock('../src/uk-tenders/mcp-client', () => ({
    callTool: jest.fn(),
}));

const { callTool } = require('../src/uk-tenders/mcp-client');
const ukTenders = require('../src/uk-tenders/index');

beforeEach(() => {
    callTool.mockReset();
});

describe('uk_tenders tool definitions', () => {
    test('exports four tools', () => {
        expect(ukTenders.TOOLS).toHaveLength(4);
    });

    test('all tool names are prefixed uk_tenders_', () => {
        ukTenders.TOOLS.forEach(t => {
            expect(t.name).toMatch(/^uk_tenders_/);
        });
    });

    test('all tools have handlers', () => {
        ukTenders.TOOLS.forEach(t => {
            expect(typeof ukTenders.TOOL_HANDLERS[t.name]).toBe('function');
        });
    });
});

describe('uk_tenders_search_frameworks handler', () => {
    test('calls search_tenders upstream with stage=award', async () => {
        callTool.mockResolvedValue({ count: 0, results: [] });
        await ukTenders.TOOL_HANDLERS.uk_tenders_search_frameworks({ keyword: 'cloud', cpv: '72', limit: 5 });
        expect(callTool).toHaveBeenCalledWith('search_tenders', expect.objectContaining({
            query: 'cloud',
            cpv: '72',
            stage: 'award',
            limit: 5,
        }));
    });
});

describe('uk_tenders_top_suppliers handler', () => {
    test('calls top_suppliers upstream', async () => {
        callTool.mockResolvedValue({ results: [] });
        await ukTenders.TOOL_HANDLERS.uk_tenders_top_suppliers({ cpv: '90' });
        expect(callTool).toHaveBeenCalledWith('top_suppliers', expect.objectContaining({ cpv: '90' }));
    });
});

describe('uk_tenders_data_status handler', () => {
    test('calls get_status upstream', async () => {
        callTool.mockResolvedValue({ sources: [] });
        await ukTenders.TOOL_HANDLERS.uk_tenders_data_status({});
        expect(callTool).toHaveBeenCalledWith('get_status', {});
    });
});

describe('mcp-client error handling', () => {
    test('propagates upstream tool errors', async () => {
        callTool.mockRejectedValue(new Error('UK Tenders tool error: QUERY_TOO_LARGE'));
        await expect(
            ukTenders.TOOL_HANDLERS.uk_tenders_search_frameworks({})
        ).rejects.toThrow('QUERY_TOO_LARGE');
    });
});
