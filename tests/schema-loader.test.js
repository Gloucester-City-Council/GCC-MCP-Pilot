'use strict';

const path = require('path');

describe('council tax schema loader pack discovery', () => {
    afterEach(() => {
        delete process.env.MCP_SCHEMA_VERSION;
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('discoverSchemaPack prefers highest complete version by default', () => {
        let discoverSchemaPack;
        jest.isolateModules(() => {
            jest.doMock('fs', () => ({
                readdirSync: jest.fn(() => [
                    'council_tax_facts.v2.5.3.json',
                    'council_tax_rules.v2.5.3.json',
                    'council_tax_taxonomy.v2.5.3.json',
                    'council_tax_results.v2.5.3.json',
                    'council_tax_facts.v2.5.6.json',
                    'council_tax_rules.v2.5.6.json',
                    'council_tax_taxonomy.v2.5.6.json',
                    'council_tax_results.v2.5.6.json'
                ])
            }));

            ({ discoverSchemaPack } = require('../src/schema/loader'));
        });

        const result = discoverSchemaPack(path.resolve(process.cwd(), 'schemas/CouncilTax'));
        expect(result.version).toBe('2.5.6');
        expect(result.files.facts).toBe('council_tax_facts.v2.5.6.json');
    });

    test('discoverSchemaPack falls back when preferred version is incomplete', () => {
        process.env.MCP_SCHEMA_VERSION = '2.5.6';

        let discoverSchemaPack;
        jest.isolateModules(() => {
            jest.doMock('fs', () => ({
                readdirSync: jest.fn(() => [
                    'council_tax_facts.v2.5.3.json',
                    'council_tax_rules.v2.5.3.json',
                    'council_tax_taxonomy.v2.5.3.json',
                    'council_tax_results.v2.5.3.json',
                    'council_tax_facts.v2.5.6.json',
                    'council_tax_rules.v2.5.6.json',
                    'council_tax_taxonomy.v2.5.6.json'
                ])
            }));

            ({ discoverSchemaPack } = require('../src/schema/loader'));
        });

        const result = discoverSchemaPack(path.resolve(process.cwd(), 'schemas/CouncilTax'));
        expect(result.version).toBe('2.5.3');
        expect(result.files.results).toBe('council_tax_results.v2.5.3.json');
    });
});
