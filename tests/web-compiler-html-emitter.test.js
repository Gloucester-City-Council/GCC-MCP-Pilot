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

    test('renders navigation brand and links when global_nav uses string brand and links field', () => {
        const siteDef = JSON.parse(JSON.stringify(samplePolicySite));
        siteDef.globals = {};
        siteDef.site.global_nav = {
            brand: 'Gloucester City Council',
            links: [
                { href: '/council-tax/', label: 'Council Tax' },
                { href: '/council-tax/discounts/', label: 'Discounts' },
            ],
        };
        siteDef.site.global_footer = {
            body: 'Gloucester City Council, Gloucester, GL1 2TG',
            links: [
                { href: '/accessibility/', label: 'Accessibility' },
                { href: '/privacy/', label: 'Privacy' },
            ],
        };

        const result = compiler.run(siteDef);
        expect(result.ok).toBe(true);
        const html = result.bundle.html[0].content;

        // nav brand label rendered
        expect(html).toContain('Gloucester City Council');
        // nav links rendered via links alias
        expect(html).toContain('/council-tax/');
        expect(html).toContain('Council Tax');
        expect(html).toContain('Discounts');
        // footer body text rendered
        expect(html).toContain('GL1 2TG');
        // footer links rendered via body+links synthesis
        expect(html).toContain('/accessibility/');
        expect(html).toContain('Accessibility');
    });

    test('renders navigation and footer when provided via site.global_nav/global_footer aliases', () => {
        const siteDef = JSON.parse(JSON.stringify(samplePolicySite));
        siteDef.globals = {};
        siteDef.site.global_nav = {
            brand: { name: 'Council', url: '/' },
            items: [{ text: 'Council Tax', href: '/council-tax' }],
        };
        siteDef.site.global_footer = {
            groups: [{ heading: 'Support', links: [{ label: 'Help', url: '/help' }] }],
        };

        const result = compiler.run(siteDef);
        expect(result.ok).toBe(true);
        const html = result.bundle.html[0].content;
        expect(html).toContain('Council');
        expect(html).toContain('/council-tax');
        expect(html).toContain('Support');
        expect(html).toContain('/help');
    });
});
