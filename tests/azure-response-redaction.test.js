'use strict';

const { redact } = require('../src/gcc-azure-estate/lib/response');

describe('Azure Estate response redaction (lib/response.js)', () => {
    it('redacts keys that look like secrets, recursively', () => {
        const input = {
            name: 'mystorageacct',
            primaryKey: 'super-secret-value',
            nested: {
                connectionString: 'DefaultEndpointsProtocol=https;AccountKey=abc123',
                sasToken: 'sv=2021-01-01&sig=abc',
                safeField: 'keep-me',
            },
            list: [{ secondaryMasterKey: 'also-secret' }, { fine: 'value' }],
        };

        const out = redact(input);

        expect(out.primaryKey).toBe('[REDACTED]');
        expect(out.nested.connectionString).toBe('[REDACTED]');
        expect(out.nested.sasToken).toBe('[REDACTED]');
        expect(out.nested.safeField).toBe('keep-me');
        expect(out.list[0].secondaryMasterKey).toBe('[REDACTED]');
        expect(out.list[1].fine).toBe('value');
        expect(out.name).toBe('mystorageacct');
    });

    it('leaves primitives and non-secret fields untouched', () => {
        expect(redact('plain string')).toBe('plain string');
        expect(redact(42)).toBe(42);
        expect(redact(null)).toBe(null);
    });
});
