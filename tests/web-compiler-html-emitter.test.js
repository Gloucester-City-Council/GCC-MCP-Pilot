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

    test('renders repeated service_card items using collection mapping and child_mappings', () => {
        const siteDef = JSON.parse(JSON.stringify(samplePolicySite));
        siteDef.pages[0].page_type = 'homepage';
        siteDef.pages[0].template_id = 'template_homepage_child_map_test';
        siteDef.pages[0].content = {
            title: 'Homepage',
            service_cards: [
                { title: 'Bins and recycling', summary: 'Collection days and missed bins.', url: '/bins' },
                { title: 'Council tax', summary: 'Pay, view or report changes.', url: '/council-tax' },
            ],
        };

        const templateRegistry = {
            schema_version: 'template_registry_v5',
            templates: [{
                id: 'template_homepage_child_map_test',
                page_type: 'homepage',
                regions: [{
                    id: 'main',
                    order: 1,
                    layout: 'single_column',
                    components: [{ component: 'service_card', repeat: true, collection_id: 'service_cards' }],
                }],
                required_components: ['service_card'],
                forbidden_components: [],
                allowed_layout_overrides: [],
                content_mappings: [{
                    source_field: 'service_cards',
                    target_component: 'service_card',
                    target_slot: 'collection',
                    transform_id: 'identity',
                }],
                child_mappings: [
                    { target_component: 'service_card', source_field: 'item.title', target_slot: 'title' },
                    { target_component: 'service_card', source_field: 'item.summary', target_slot: 'summary' },
                    { target_component: 'service_card', source_field: 'item.url', target_slot: 'link' },
                ],
            }],
        };

        const result = compiler.run(siteDef, { templateRegistry });
        expect(result.ok).toBe(true);
        const html = result.bundle.html[0].content;
        expect(html).toContain('Bins and recycling');
        expect(html).toContain('Collection days and missed bins.');
        expect(html).toContain('href="/bins"');
        expect(html).toContain('Council tax');
        expect(html).toContain('href="/council-tax"');
    });

    test('renders arbitrary mapped slots for hero and alert_banner components', () => {
        const siteDef = JSON.parse(JSON.stringify(samplePolicySite));
        siteDef.pages[0].page_type = 'homepage';
        siteDef.pages[0].template_id = 'template_homepage_dynamic_slots_test';
        siteDef.pages[0].content = {
            title: 'Homepage',
            summary: 'Services and updates',
            hero_items: [{ title: 'Top service', url: '/top-service' }],
        };
        siteDef.globals.alert_banner = {
            message_html: '<strong>Planned maintenance</strong>',
            severity: 'warning',
        };

        const templateRegistry = {
            schema_version: 'template_registry_v5',
            templates: [{
                id: 'template_homepage_dynamic_slots_test',
                page_type: 'homepage',
                regions: [{
                    id: 'pre_main',
                    order: 1,
                    layout: 'single_column',
                    components: [{ component: 'alert_banner' }, { component: 'hero' }],
                }],
                required_components: ['alert_banner', 'hero'],
                forbidden_components: [],
                allowed_layout_overrides: [],
                content_mappings: [
                    { source_field: 'globals.alert_banner.message_html', target_component: 'alert_banner', target_slot: 'message' },
                    { source_field: 'globals.alert_banner.severity', target_component: 'alert_banner', target_slot: 'severity_label' },
                    { source_field: 'hero_items', target_component: 'hero', target_slot: 'items', transform_id: 'identity' },
                    { source_field: 'summary', target_component: 'hero', target_slot: 'supporting_copy' },
                ],
            }],
        };

        const result = compiler.run(siteDef, { templateRegistry });
        expect(result.ok).toBe(true);
        const html = result.bundle.html[0].content;
        expect(html).toContain('Planned maintenance');
        expect(html).toContain('c-alert-banner__severity_label');
        expect(html).toContain('warning');
        expect(html).toContain('c-hero__supporting_copy');
        expect(html).toContain('Services and updates');
    });
});
