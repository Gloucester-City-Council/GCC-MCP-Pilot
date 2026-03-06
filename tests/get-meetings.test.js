'use strict';

jest.mock('../lib/moderngov-client', () => ({
    getMeetings: jest.fn()
}));

jest.mock('../lib/council-config', () => ({
    getCouncilNames: () => ['Gloucester City Council'],
    getCouncil: (name) => (name === 'Gloucester City Council'
        ? { name, url: 'https://democracy.gloucester.gov.uk' }
        : null)
}));

const moderngovClient = require('../lib/moderngov-client');
const { getMeetings } = require('../lib/tools/get-meetings');

describe('getMeetings', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('accepts relative date keywords; range queries pass to_date unchanged', async () => {
        const fixed = new Date('2026-02-15T10:00:00.000Z'); // today => 15/02/2026
        jest.useFakeTimers().setSystemTime(fixed);

        moderngovClient.getMeetings.mockResolvedValueOnce({ meetings: [] });

        const result = await getMeetings('Gloucester City Council', 544, 'yesterday', 'today');

        // yesterday=14/02, today=15/02 — different dates so no +1 extension
        expect(moderngovClient.getMeetings).toHaveBeenCalledWith(
            'Gloucester City Council',
            544,
            '14/02/2026',
            '15/02/2026'
        );
        expect(result.date_range.from).toBe('14/02/2026');
        expect(result.date_range.to).toBe('15/02/2026');

        jest.useRealTimers();
    });

    it('extends to_date by one day when from and to are the same (single-day query)', async () => {
        const fixed = new Date('2026-02-15T10:00:00.000Z'); // today => 15/02/2026
        jest.useFakeTimers().setSystemTime(fixed);

        moderngovClient.getMeetings.mockResolvedValueOnce({ meetings: [] });

        const result = await getMeetings('Gloucester City Council', 544, 'today', 'today');

        // Same-day: ModernGov treats end as exclusive when from==to, so extend by 1
        expect(moderngovClient.getMeetings).toHaveBeenCalledWith(
            'Gloucester City Council',
            544,
            '15/02/2026',
            '16/02/2026'
        );
        expect(result.date_range.from).toBe('15/02/2026');
        expect(result.date_range.to).toBe('15/02/2026');

        jest.useRealTimers();
    });

    it('does not extend to_date when from and to differ (range queries are inclusive)', async () => {
        moderngovClient.getMeetings.mockResolvedValueOnce({ meetings: [] });

        await getMeetings('Gloucester City Council', 544, '01/03/2026', '31/03/2026');

        expect(moderngovClient.getMeetings).toHaveBeenCalledWith(
            'Gloucester City Council',
            544,
            '01/03/2026',
            '31/03/2026' // no extension — range end date is inclusive
        );
    });

    it('supports "last day" alias and validates impossible calendar dates', async () => {
        const fixed = new Date('2026-02-15T10:00:00.000Z');
        jest.useFakeTimers().setSystemTime(fixed);

        moderngovClient.getMeetings.mockResolvedValueOnce({ meetings: [] });
        await getMeetings('Gloucester City Council', 544, 'last day', 'today');

        // last day=14/02, today=15/02 — different dates, no extension
        expect(moderngovClient.getMeetings).toHaveBeenLastCalledWith(
            'Gloucester City Council',
            544,
            '14/02/2026',
            '15/02/2026'
        );

        const invalid = await getMeetings('Gloucester City Council', 544, '31/02/2026', '01/03/2026');
        expect(invalid.error).toBe('Invalid from_date format');

        jest.useRealTimers();
    });
});
