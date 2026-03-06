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

    it('accepts relative date keywords and expands inclusive end date', async () => {
        const fixed = new Date('2026-02-15T10:00:00.000Z'); // today => 15/02/2026
        jest.useFakeTimers().setSystemTime(fixed);

        moderngovClient.getMeetings.mockResolvedValueOnce({ meetings: [] });

        const result = await getMeetings('Gloucester City Council', 544, 'yesterday', 'today');

        expect(moderngovClient.getMeetings).toHaveBeenCalledWith(
            'Gloucester City Council',
            544,
            '14/02/2026',
            '16/02/2026' // inclusive-to exclusive conversion (+1 day)
        );
        expect(result.date_range.from).toBe('14/02/2026');
        expect(result.date_range.to).toBe('16/02/2026');

        jest.useRealTimers();
    });

    it('expands a normal to_date by one day for inclusive behavior', async () => {
        moderngovClient.getMeetings.mockResolvedValueOnce({ meetings: [] });

        await getMeetings('Gloucester City Council', 544, '01/03/2026', '31/03/2026');

        expect(moderngovClient.getMeetings).toHaveBeenCalledWith(
            'Gloucester City Council',
            544,
            '01/03/2026',
            '01/04/2026'
        );
    });
});
