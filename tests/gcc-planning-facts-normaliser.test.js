'use strict';

const { normalise } = require('../src/gcc-planning/pipeline/facts-normaliser');

describe('facts-normaliser', () => {
    test('does not mutate the original facts object', () => {
        const rawFacts = {
            proposal: {
                proposal_type: 'rear_extension',
            },
        };

        const result = normalise(rawFacts);

        expect(result.canonicalFacts.proposal.proposal_type).toEqual(['rear_extension']);
        expect(rawFacts.proposal.proposal_type).toBe('rear_extension');
    });

    test('preserves Date values in canonical facts', () => {
        const submittedAt = new Date('2026-01-20T10:15:30Z');
        const rawFacts = {
            metadata: {
                submittedAt,
            },
        };

        const result = normalise(rawFacts);

        expect(Object.prototype.toString.call(result.canonicalFacts.metadata.submittedAt)).toBe('[object Date]');
        expect(result.canonicalFacts.metadata.submittedAt.toISOString()).toBe('2026-01-20T10:15:30.000Z');
    });
});
