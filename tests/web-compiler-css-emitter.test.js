'use strict';

const { emitCss } = require('../src/web-compiler/emitter/css-emitter');

describe('web-compiler css emitter', () => {
    it('emits body section typography rules from resolved token scales', () => {
        const renderPlan = {
            resolved_tokens: {
                theme_id: 'civic_blue',
                polish_profile_id: 'default',
            },
            pages: [
                {
                    regions: [
                        {
                            components: [
                                {
                                    dom: {
                                        root_class: 'c-body-section',
                                        slots: [],
                                    },
                                    styles: {
                                        tokens: {
                                            title_scale: '2rem',
                                            text_scale: '1.125rem',
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        const css = emitCss(renderPlan, {});

        expect(css).toContain('.c-body-section__heading {\n  font-size: 2rem;\n}');
        expect(css).toContain('.c-body-section__content {\n  font-size: 1.125rem;\n}');
    });
});
