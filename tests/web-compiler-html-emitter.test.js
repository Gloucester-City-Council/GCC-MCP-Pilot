const compiler = require('../src/web-compiler/index');
const samplePolicySite = require('../schemas/WebCompiler/sample-site-definition.policy-page.json');

describe('web-compiler html emitter', () => {
    test('renders body section body text for array items', () => {
        const siteDef = JSON.parse(JSON.stringify(samplePolicySite));
        siteDef.pages[0].content.body_sections = [
            { heading: 'Who can apply', body: 'Adults who live alone may qualify.' },
        ];

        const result = compiler.run(siteDef);
        expect(result.ok).toBe(true);
        const html = result.bundle.html[0].content;
        expect(html).toContain('<h2 class="c-body-section__heading">Who can apply</h2>');
        expect(html).toContain('<p class="c-body-section__content">Adults who live alone may qualify.</p>');
    });

    test('renders navigation and footer from globals when template has no explicit mapping', () => {
        const siteDef = JSON.parse(JSON.stringify(samplePolicySite));
        const result = compiler.run(siteDef);
        expect(result.ok).toBe(true);
        const html = result.bundle.html[0].content;
        expect(html).toContain('<nav');
        expect(html).toContain('>Home<');
        expect(html).toContain('<footer');
        expect(html).toContain('Pages');
    });
});
