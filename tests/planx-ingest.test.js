'use strict';

const { mapPlanxToGccFacts, resolveRoute, PLANX_TYPE_TO_ROUTE, UNSUPPORTED_PLANX_TYPES } = require('../src/gcc-planning/planx-mapper');
const { execute } = require('../src/gcc-planning/tools/planx-ingest');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal valid PlanX householder application */
const minimalHouseholder = {
    applicationType: { value: 'pp.full.householder', description: 'Householder planning permission' },
    data: {
        property: {
            address: { line1: '12 Main Street', town: 'Gloucester', postcode: 'GL1 1AA' },
        },
        proposal: {
            projectType: ['extension.rear.single'],
            description: 'Single storey rear extension',
        },
    },
};

/** Full PlanX application with designations and dimensions */
const fullHouseholder = {
    applicationType: { value: 'pp.full.householder' },
    metadata: { id: 'GCC-2026-0042' },
    data: {
        property: {
            address: { line1: '5 Cathedral Close', line2: '', town: 'Gloucester', postcode: 'GL1 2LR' },
            type: 'terraced',
            planning: {
                designations: [{ value: 'conservation-area' }, { value: 'listed-building-setting' }],
                flood: { zone: '1' },
            },
        },
        proposal: {
            description: 'Two storey side extension',
            projectType: ['extension.side.double'],
            extension: {
                depth: 4.2,
                height: { ridge: 7.5, eaves: 5.0 },
            },
            existing: {
                height: { ridge: 8.0, eaves: 5.2 },
            },
            garden: { remainingDepth: 12.5 },
            materials: { matchExisting: true },
        },
    },
};

/** PlanX prior notification application */
const priorNotification = {
    applicationType: { value: 'pa.part1.classA' },
    data: {
        property: {
            address: '22 Westgate Street, Gloucester, GL1 2NQ',
        },
        proposal: {
            projectType: ['extension.rear.single'],
            extension: { depth: 5.8 },
        },
    },
};

/** PlanX pre-application */
const preApplication = {
    applicationType: { value: 'preApp' },
    data: {
        property: {
            address: { line1: '7 Park Road', town: 'Gloucester', postcode: 'GL2 0AA' },
        },
        proposal: { description: 'Pre-application enquiry for rear dormer extension' },
    },
};

/** Unsupported PlanX application type */
const majorApplication = {
    applicationType: { value: 'pp.full.major' },
    data: { property: { address: '1 Commercial Way, Gloucester' } },
};

/** Missing applicationType */
const missingType = {
    data: { property: { address: '1 Test Street' } },
};

// ─── resolveRoute ─────────────────────────────────────────────────────────────

describe('resolveRoute', () => {
    it('maps pp.full.householder to householder_planning_permission', () => {
        const result = resolveRoute({ applicationType: { value: 'pp.full.householder' } });
        expect(result.route).toBe('householder_planning_permission');
        expect(result.consentTracks).toContain('planning_permission');
        expect(result.routeWarning).toBeNull();
    });

    it('maps lbc to householder_planning_permission_and_listed_building_consent', () => {
        const result = resolveRoute({ applicationType: { value: 'lbc' } });
        expect(result.route).toBe('householder_planning_permission_and_listed_building_consent');
        expect(result.consentTracks).toContain('planning_permission');
        expect(result.consentTracks).toContain('listed_building_consent');
    });

    it('maps pa.part1.classA to prior_notification_larger_home_extension', () => {
        const result = resolveRoute({ applicationType: { value: 'pa.part1.classA' } });
        expect(result.route).toBe('prior_notification_larger_home_extension');
        expect(result.consentTracks).toContain('prior_approval_larger_home_extension');
    });

    it('maps preApp to pre_application_householder', () => {
        const result = resolveRoute({ applicationType: { value: 'preApp' } });
        expect(result.route).toBe('pre_application_householder');
    });

    it('returns unsupported: true for pp.full.major', () => {
        const result = resolveRoute({ applicationType: { value: 'pp.full.major' } });
        expect(result.unsupported).toBe(true);
        expect(result.route).toBeNull();
        expect(result.routeWarning).toMatch(/not supported/);
    });

    it('returns warning when applicationType is missing', () => {
        const result = resolveRoute({});
        expect(result.route).toBeNull();
        expect(result.routeWarning).toMatch(/missing/);
    });
});

// ─── mapPlanxToGccFacts — minimal householder ─────────────────────────────────

describe('mapPlanxToGccFacts — minimal householder', () => {
    let result;
    beforeAll(() => { result = mapPlanxToGccFacts(minimalHouseholder); });

    it('succeeds without mapping_error', () => {
        expect(result.mapping_error).toBeNull();
        expect(result.not_supported).toBe(false);
    });

    it('sets application_route', () => {
        expect(result.mapped_facts.application.application_route).toBe('householder_planning_permission');
    });

    it('sets consent_tracks', () => {
        expect(result.mapped_facts.application.consent_tracks).toContain('planning_permission');
    });

    it('maps address from property.address object', () => {
        expect(result.mapped_facts.site.address).toContain('Main Street');
        expect(result.mapped_facts.site.address).toContain('GL1 1AA');
    });

    it('maps proposal_type from projectType', () => {
        expect(result.mapped_facts.proposal.proposal_type).toContain('single_storey_rear_extension');
    });

    it('reports high or partial mapping_confidence', () => {
        expect(['high', 'partial']).toContain(result.mapping_confidence);
    });

    it('warns about missing flood zone', () => {
        expect(result.mapping_warnings.some(w => /flood/i.test(w))).toBe(true);
        expect(result.unmapped_fields.some(f => /flood/i.test(f))).toBe(true);
    });
});

// ─── mapPlanxToGccFacts — full householder ────────────────────────────────────

describe('mapPlanxToGccFacts — full householder with designations and dimensions', () => {
    let result;
    beforeAll(() => { result = mapPlanxToGccFacts(fullHouseholder); });

    it('has high mapping confidence', () => {
        expect(result.mapping_confidence).toBe('high');
    });

    it('maps application_reference from metadata.id', () => {
        expect(result.mapped_facts.application.application_reference).toBe('GCC-2026-0042');
    });

    it('maps dwelling_type from property.type', () => {
        expect(result.mapped_facts.site.dwelling_type).toBe('terrace');
    });

    it('maps conservation_area from designations', () => {
        expect(result.mapped_facts.site.conservation_area).toBe(true);
    });

    it('maps listed_building_within_setting from designations', () => {
        expect(result.mapped_facts.site.listed_building_within_setting).toBe(true);
    });

    it('maps flood_zone from property.planning.flood.zone', () => {
        expect(result.mapped_facts.site.flood_zone).toBe('1');
    });

    it('maps proposal_type to two_storey_side_extension', () => {
        expect(result.mapped_facts.proposal.proposal_type).toContain('two_storey_side_extension');
    });

    it('converts extension depth from metres to mm', () => {
        expect(result.mapped_facts.proposal.extension_depth_from_existing_rear_wall_mm).toBe(4200);
    });

    it('converts ridge height from metres to mm', () => {
        expect(result.mapped_facts.proposal.extension_ridge_height_mm).toBe(7500);
        expect(result.mapped_facts.proposal.existing_ridge_height_mm).toBe(8000);
    });

    it('converts eaves height from metres to mm', () => {
        expect(result.mapped_facts.proposal.extension_eaves_height_mm).toBe(5000);
        expect(result.mapped_facts.proposal.existing_eaves_height_mm).toBe(5200);
    });

    it('maps remaining_rear_garden_depth_m', () => {
        expect(result.mapped_facts.proposal.remaining_rear_garden_depth_m).toBe(12.5);
    });

    it('maps materials_compatibility as matching', () => {
        expect(result.mapped_facts.proposal.materials_compatibility).toBe('matching');
    });

    it('has no flood zone warning when zone is provided', () => {
        expect(result.mapping_warnings.some(w => /flood/i.test(w))).toBe(false);
    });
});

// ─── mapPlanxToGccFacts — prior notification ──────────────────────────────────

describe('mapPlanxToGccFacts — prior notification (Class A)', () => {
    let result;
    beforeAll(() => { result = mapPlanxToGccFacts(priorNotification); });

    it('maps to prior_notification_larger_home_extension', () => {
        expect(result.suggested_route).toBe('prior_notification_larger_home_extension');
        expect(result.mapped_facts.application.application_route).toBe('prior_notification_larger_home_extension');
    });

    it('maps prior_approval consent track', () => {
        expect(result.mapped_facts.application.consent_tracks).toContain('prior_approval_larger_home_extension');
    });

    it('accepts string address', () => {
        expect(result.mapped_facts.site.address).toContain('Westgate Street');
    });

    it('converts depth to mm', () => {
        expect(result.mapped_facts.proposal.extension_depth_from_existing_rear_wall_mm).toBe(5800);
    });
});

// ─── mapPlanxToGccFacts — pre-application ────────────────────────────────────

describe('mapPlanxToGccFacts — pre-application', () => {
    let result;
    beforeAll(() => { result = mapPlanxToGccFacts(preApplication); });

    it('maps to pre_application_householder', () => {
        expect(result.suggested_route).toBe('pre_application_householder');
    });

    it('maps description', () => {
        expect(result.mapped_facts.application.description).toContain('dormer');
    });
});

// ─── mapPlanxToGccFacts — unsupported type ────────────────────────────────────

describe('mapPlanxToGccFacts — unsupported application type', () => {
    let result;
    beforeAll(() => { result = mapPlanxToGccFacts(majorApplication); });

    it('sets not_supported to true', () => {
        expect(result.not_supported).toBe(true);
    });

    it('returns null mapped_facts', () => {
        expect(result.mapped_facts).toBeNull();
    });

    it('includes the unsupported type in the error', () => {
        expect(result.mapping_error).toContain('pp.full.major');
    });
});

// ─── mapPlanxToGccFacts — invalid inputs ─────────────────────────────────────

describe('mapPlanxToGccFacts — invalid inputs', () => {
    it('handles null input', () => {
        const r = mapPlanxToGccFacts(null);
        expect(r.mapping_error).toBeTruthy();
        expect(r.mapped_facts).toBeNull();
    });

    it('handles missing applicationType gracefully', () => {
        const r = mapPlanxToGccFacts(missingType);
        expect(r.mapping_error).toBeNull();   // not an error, just a warning
        expect(r.mapping_confidence).toBe('low');
        expect(r.mapping_warnings.length).toBeGreaterThan(0);
    });
});

// ─── execute (tool wrapper) ───────────────────────────────────────────────────

describe('execute — tool wrapper', () => {
    it('returns success: true for a valid householder application', () => {
        const result = execute({ planx_application: minimalHouseholder });
        expect(result.success).toBe(true);
        expect(result.mapped_facts).toBeTruthy();
        expect(result.suggested_route).toBe('householder_planning_permission');
    });

    it('includes next_steps by default', () => {
        const result = execute({ planx_application: minimalHouseholder });
        expect(result.next_steps).toBeTruthy();
        expect(result.next_steps.tools.length).toBeGreaterThan(0);
    });

    it('omits next_steps when include_next_steps is false', () => {
        const result = execute({ planx_application: minimalHouseholder, include_next_steps: false });
        expect(result.next_steps).toBeUndefined();
    });

    it('returns success: false and not_supported: true for unsupported type', () => {
        const result = execute({ planx_application: majorApplication });
        expect(result.success).toBe(false);
        expect(result.not_supported).toBe(true);
        expect(result.planx_application_type).toBe('pp.full.major');
    });

    it('returns an error for missing planx_application param', () => {
        const result = execute({});
        expect(result.success).toBe(false);
        expect(result.mapping_error).toMatch(/planx_application/);
    });

    it('returns an error for non-object planx_application', () => {
        const result = execute({ planx_application: 'not an object' });
        expect(result.success).toBe(false);
    });

    it('includes schema_versions in all responses', () => {
        expect(execute({ planx_application: minimalHouseholder }).schema_versions).toBeTruthy();
        expect(execute({ planx_application: majorApplication }).schema_versions).toBeTruthy();
        expect(execute({}).schema_versions).toBeTruthy();
    });

    it('mapped_facts is directly usable — has application, site, proposal sections', () => {
        const result = execute({ planx_application: fullHouseholder });
        const facts = result.mapped_facts;
        expect(facts).toHaveProperty('application');
        expect(facts).toHaveProperty('site');
        expect(facts).toHaveProperty('proposal');
    });
});

// ─── Bug regression: designation intersects handling ─────────────────────────

describe('designation intersects handling (bug regressions)', () => {

    // Bug 1: listed:false false positive
    it('does NOT set listed_building when designations has listed with intersects:false', () => {
        const planx = {
            applicationType: { value: 'pp.full.householder' },
            data: {
                property: {
                    address: '1 Test St, Gloucester, GL1 1AA',
                    planning: {
                        designations: [
                            { value: 'listed', intersects: false },
                            { value: 'conservation-area', intersects: true },
                        ],
                    },
                },
            },
        };
        const result = mapPlanxToGccFacts(planx);
        expect(result.mapped_facts.site.listed_building).toBeUndefined();
        expect(result.mapped_facts.site.conservation_area).toBe(true);
    });

    // Bug 1: secondary listed check — planning.designated.listed.intersects:false
    it('does NOT set listed_building when planning.designated.listed.intersects is false', () => {
        const planx = {
            applicationType: { value: 'pp.full.householder' },
            data: {
                property: {
                    address: '1 Test St, Gloucester, GL1 1AA',
                    planning: {
                        designated: {
                            listed: { intersects: false },
                            conservationArea: { intersects: true, entities: [{ name: 'Eastgate' }] },
                        },
                    },
                },
            },
        };
        const result = mapPlanxToGccFacts(planx);
        expect(result.mapped_facts.site.listed_building).toBeUndefined();
    });

    // Bug 1: should set listed_building when intersects is true
    it('sets listed_building when planning.designated.listed.intersects is true', () => {
        const planx = {
            applicationType: { value: 'pp.full.householder' },
            data: {
                property: {
                    address: '1 Test St, Gloucester, GL1 1AA',
                    planning: {
                        designated: {
                            listed: { intersects: true },
                        },
                    },
                },
            },
        };
        const result = mapPlanxToGccFacts(planx);
        expect(result.mapped_facts.site.listed_building).toBe(true);
    });

    // Bug 2: conservation area miss — planning.designated.conservationArea.intersects
    it('sets conservation_area when planning.designated.conservationArea.intersects is true', () => {
        const planx = {
            applicationType: { value: 'pp.full.householder' },
            data: {
                property: {
                    address: '1 Test St, Gloucester, GL1 1AA',
                    planning: {
                        designated: {
                            listed: { intersects: false },
                            conservationArea: {
                                intersects: true,
                                entities: [{ name: 'Eastgate and St Michaels' }],
                            },
                        },
                    },
                },
            },
        };
        const result = mapPlanxToGccFacts(planx);
        expect(result.mapped_facts.site.conservation_area).toBe(true);
        expect(result.mapped_facts.site.listed_building).toBeUndefined();
    });

    // Bug 2: no false positive when conservationArea.intersects is false
    it('does NOT set conservation_area when planning.designated.conservationArea.intersects is false', () => {
        const planx = {
            applicationType: { value: 'pp.full.householder' },
            data: {
                property: {
                    address: '1 Test St, Gloucester, GL1 1AA',
                    planning: {
                        designated: {
                            conservationArea: { intersects: false },
                        },
                    },
                },
            },
        };
        const result = mapPlanxToGccFacts(planx);
        expect(result.mapped_facts.site.conservation_area).toBeUndefined();
    });
});

// ─── Bug regression: address singleLine ──────────────────────────────────────

describe('address singleLine handling (bug regression)', () => {

    // Bug 3: address truncated — singleLine not used
    it('uses singleLine when present instead of constructing from parts', () => {
        const planx = {
            applicationType: { value: 'pp.full.householder' },
            data: {
                property: {
                    address: {
                        singleLine: '12 Eastgate Street, Gloucester, GL1 1HG',
                        title: '12 Eastgate Street',
                        town: 'GLOUCESTER',
                        postcode: 'GL1 1HG',
                    },
                },
            },
        };
        const result = mapPlanxToGccFacts(planx);
        expect(result.mapped_facts.site.address).toBe('12 Eastgate Street, Gloucester, GL1 1HG');
    });

    // Fallback: no singleLine — uses title + town + postcode
    it('falls back to title + town + postcode when singleLine is absent', () => {
        const planx = {
            applicationType: { value: 'pp.full.householder' },
            data: {
                property: {
                    address: {
                        title: '5 Cathedral Close',
                        town: 'GLOUCESTER',
                        postcode: 'GL1 2LR',
                    },
                },
            },
        };
        const result = mapPlanxToGccFacts(planx);
        expect(result.mapped_facts.site.address).toContain('Cathedral Close');
        expect(result.mapped_facts.site.address).toContain('GL1 2LR');
    });
});

// ─── PLANX_TYPE_TO_ROUTE completeness ────────────────────────────────────────

describe('PLANX_TYPE_TO_ROUTE coverage', () => {
    const expectedRoutes = new Set([
        'householder_planning_permission',
        'householder_planning_permission_and_listed_building_consent',
        'prior_notification_larger_home_extension',
        'pre_application_householder',
    ]);

    it('covers all four GCC householder routes', () => {
        const coveredRoutes = new Set(Object.values(PLANX_TYPE_TO_ROUTE));
        for (const route of expectedRoutes) {
            expect(coveredRoutes).toContain(route);
        }
    });

    it('all mapped routes are valid GCC route enum values', () => {
        const validRoutes = [
            'householder_planning_permission',
            'householder_planning_permission_and_listed_building_consent',
            'prior_notification_larger_home_extension',
            'pre_application_householder',
        ];
        for (const route of Object.values(PLANX_TYPE_TO_ROUTE)) {
            expect(validRoutes).toContain(route);
        }
    });
});
