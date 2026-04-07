'use strict';

const { emitCss } = require('../src/web-compiler/emitter/css-emitter');

describe('web-compiler css emitter', () => {
    it('emits body section typography rules from resolved token scales', () => {
        const renderPlan = {
            resolved_tokens: {
                theme_id: 'civic_blue',
                polish_profile_id: 'default',
                values: {
                    'typography.scale.h2': '2rem',
                    'typography.scale.body': '1.125rem',
                },
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

        expect(css).toContain('.c-body-section__heading {\n  font-size: var(--sb-typography-scale-h2);\n}');
        expect(css).toContain('.c-body-section__content {\n  font-size: var(--sb-typography-scale-body);\n}');
    });

    it('prefers semantic token families when multiple token paths share the same value', () => {
        const renderPlan = {
            resolved_tokens: {
                theme_id: 'civic_blue',
                polish_profile_id: 'default',
                values: {
                    'radius.sm': '8px',
                    'spacing.scale.1': '8px',
                    'radius.none': '0',
                    'spacing.scale.0': '0',
                    'typography.scale.body': '18px',
                },
            },
            pages: [
                {
                    regions: [
                        {
                            components: [
                                {
                                    dom: {
                                        root_class: 'c-page-header',
                                        slots: [],
                                    },
                                    styles: {
                                        tokens: {
                                            gap: '8px',
                                            padding: '0',
                                            text_scale: '18px',
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

        expect(css).toContain('gap: var(--sb-spacing-scale-1);');
        expect(css).toContain('padding: var(--sb-spacing-scale-0);');
        expect(css).not.toContain('gap: var(--sb-radius-sm);');
        expect(css).not.toContain('padding: var(--sb-radius-none);');
    });

    it('does not emit a root font-size for non-typographic container rules', () => {
        const renderPlan = {
            resolved_tokens: {
                theme_id: 'civic_blue',
                polish_profile_id: 'default',
                values: {
                    'typography.scale.body': '18px',
                },
            },
            pages: [
                {
                    regions: [
                        {
                            components: [
                                {
                                    dom: {
                                        root_class: 'c-page-header',
                                        slots: [],
                                    },
                                    styles: {
                                        tokens: {
                                            text_scale: '18px',
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
        const rootRule = css.match(/\.c-page-header \{[^}]+\}/);

        expect(rootRule).toBeTruthy();
        expect(rootRule[0]).not.toContain('font-size:');
    });
});
