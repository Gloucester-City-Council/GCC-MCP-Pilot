'use strict';

describe('mcpGitHub robots parser', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('keeps agent context across Allow directives and captures subsequent Disallow', () => {
        const httpMock = jest.fn();
        jest.doMock('@azure/functions', () => ({ app: { http: httpMock } }));

        const { _internals } = require('../src/functions/mcpGitHub');
        const rules = _internals.parseRobots([
            'User-agent: GitHubMCP',
            'Allow: /repos/',
            'Disallow: /repos/private/',
        ].join('\n'));

        expect(rules.agents.githubmcp.allow).toContain('/repos/');
        expect(rules.agents.githubmcp.disallow).toContain('/repos/private/');
    });

    it('applies longest-match precedence so Allow can override broader Disallow', () => {
        const httpMock = jest.fn();
        jest.doMock('@azure/functions', () => ({ app: { http: httpMock } }));

        const { _internals } = require('../src/functions/mcpGitHub');

        const blocked = _internals.isPathDisallowed('/repos/private/a', ['/repos/private/'], ['/repos/']);
        const allowed = _internals.isPathDisallowed('/repos/public/a', ['/repos/'], ['/repos/public/']);

        expect(blocked).toBe(true);
        expect(allowed).toBe(false);
    });
});
