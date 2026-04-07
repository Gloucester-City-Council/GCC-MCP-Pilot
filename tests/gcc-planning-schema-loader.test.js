'use strict';

const loader = require('../src/gcc-planning/schema-loader');

describe('gcc-planning schema-loader lookup helpers', () => {
    test('findRule supports padded identifiers and rejects empty input', () => {
        expect(loader.findRule(' A1.2.1 ')).toEqual(loader.findRule('A1.2.1'));
        expect(loader.findRule('   ')).toBeNull();
        expect(loader.findRule(null)).toBeNull();
    });

    test('findValidationRequirement supports padded identifiers', () => {
        expect(loader.findValidationRequirement(' B8 ')).toEqual(loader.findValidationRequirement('B8'));
        expect(loader.findValidationRequirement(undefined)).toBeNull();
    });

    test('isMaterialRule uses normalized matching and guards invalid values', () => {
        expect(loader.isMaterialRule(' A1.2.1 ')).toBe(true);
        expect(loader.isMaterialRule('NOT-A-RULE')).toBe(false);
        expect(loader.isMaterialRule(null)).toBe(false);
    });
});
