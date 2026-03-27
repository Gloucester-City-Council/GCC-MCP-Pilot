/**
 * PlanX → GCC Householder Facts Mapper
 *
 * Maps a PlanX digital planning application JSON (conforming to
 * theopensystemslab/digital-planning-data-schemas application.json or
 * preApplication.json) to the Gloucester Householder Application Facts
 * structure (gloucester-householder-application-facts.v2.2.schema.json).
 *
 * The returned `mapped_facts` object is directly usable as input to all
 * planning assessment tools in this MCP (planning_validate_application_facts,
 * planning_detect_case_route, planning_build_assessment_result, etc.).
 *
 * Scope: Householder routes only. Non-householder PlanX application types
 * return a mapping_error with the unsupported type identified.
 *
 * PlanX schemas: https://github.com/theopensystemslab/digital-planning-data-schemas
 */

'use strict';

// ─── Application type routing ─────────────────────────────────────────────────

/**
 * PlanX application type values that map to GCC householder routes.
 * Key = PlanX applicationType.value, Value = GCC application_route.
 */
const PLANX_TYPE_TO_ROUTE = {
    // Householder planning permission
    'pp.full.householder':          'householder_planning_permission',
    'pp.full':                      'householder_planning_permission',   // fallback if more specific type not used
    // Listed building consent — combined route if accompanied by householder PP
    'lbc':                          'householder_planning_permission_and_listed_building_consent',
    // Prior approval — larger home extension (Class A)
    'pa.part1.classA':              'prior_notification_larger_home_extension',
    'pa.part1.classA.rear':        'prior_notification_larger_home_extension',
    // Pre-application advice
    'preApp':                       'pre_application_householder',
    'preApp.householder':           'pre_application_householder',
};

/**
 * PlanX application type values explicitly NOT supported by GCC householder pipeline.
 * These get a clear not_supported response rather than a silent mapping failure.
 */
const UNSUPPORTED_PLANX_TYPES = new Set([
    'pp.full.major', 'pp.full.minor', 'pp.outline', 'pp.outline.major',
    'pp.pip', 'pp.lwpa', 'approval.conditions', 'approval.reservedMatters',
    'amendment.minorMaterial', 'amendment.nonMaterial',
    'listed', 'listed.works', 'landDrainageConsent',
    'hazardousSubstanceConsent', 'advertisementConsent',
    'hedgerowRemovalNotice', 'rightOfWayOrder',
    'pa.part3', 'pa.part4', 'pa.part6', 'pa.part11', 'pa.part14',
    'pa.part16', 'pa.part20',
    'eia', 'minerals', 'onshoreExtractionOilGas',
    'enforcement', 'ldc.existing', 'ldc.proposed',
]);

// ─── PlanX project type → GCC proposal_type mapping ──────────────────────────

/**
 * Maps PlanX projectType values to GCC proposal_type enum values.
 * PlanX may use different terminology; this normalises to GCC's enum.
 */
const PLANX_PROJECT_TYPE_MAP = {
    // Direct matches / near-matches
    'extension.rear.single':        'single_storey_rear_extension',
    'extension.rear.double':        'two_storey_rear_extension',
    'extension.side.single':        'single_storey_side_extension',
    'extension.side.double':        'two_storey_side_extension',
    'extension.front':              'front_extension',
    'extension.porch':              'front_porch',
    'extension.roof':               'roof_extension',
    'extension.conservatory':       'conservatory',
    'extension.wraparound':         'wraparound_extension',
    'extension.outbuilding':        'outbuilding',
    'extension.garage':             'garage',
    'alteration.roof.dormer':       'dormer',
    'alteration.roof.loft':         'loft_conversion',
    'alteration.roof':              'loft_conversion',
    'addition.balcony':             'balcony_or_roof_terrace',
    'addition.roofTerrace':         'balcony_or_roof_terrace',
    'addition.annexe':              'annexe',
    // Broader PlanX categories — map to most likely GCC type, flag as warning
    'extension':                    'single_storey_rear_extension',
    'alteration':                   null,   // too vague — flagged as unmapped
    'new.dwelling':                 null,   // not a householder extension
};

// ─── Dwelling type mapping ────────────────────────────────────────────────────

const PLANX_DWELLING_TYPE_MAP = {
    // Simple string form (application.json)
    'detached':     'detached',
    'semiDetached': 'semi_detached',
    'semi-detached':'semi_detached',
    'terraced':     'terrace',
    'endTerrace':   'end_terrace',
    'end-terrace':  'end_terrace',
    'terrace':      'terrace',
    'flat':         'flat',
    'bungalow':     'bungalow',
    'maisonette':   'flat',
    // Full dot-notation paths (preApplication.json property.type.value)
    'residential.dwelling.house.detached':          'detached',
    'residential.dwelling.house.semiDetached':      'semi_detached',
    'residential.dwelling.house.terraced':          'terrace',
    'residential.dwelling.house.endTerrace':        'end_terrace',
    'residential.dwelling.house.bungalow':          'bungalow',
    'residential.dwelling.flat':                    'flat',
    'residential.dwelling.flat.maisonette':         'flat',
    'residential.dwelling':                         'detached',   // generic fallback
};

// ─── Flood zone mapping ───────────────────────────────────────────────────────

const PLANX_FLOOD_ZONE_MAP = {
    '1':    '1',
    'zone1':'1',
    '2':    '2',
    'zone2':'2',
    '3':    '3a',
    '3a':   '3a',
    'zone3':'3a',
    '3b':   '3b',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Safely access a nested property path on an object.
 * @param {object} obj
 * @param {string[]} path
 * @returns {*} value or undefined
 */
function get(obj, path) {
    return path.reduce((acc, key) => (acc != null && typeof acc === 'object' ? acc[key] : undefined), obj);
}

/**
 * Return the first defined non-null value from a list of candidates.
 * @param {...*} candidates
 * @returns {*}
 */
function coalesce(...candidates) {
    return candidates.find(v => v !== undefined && v !== null);
}

// ─── Application section mapping ─────────────────────────────────────────────

/**
 * Determine GCC application_route from a PlanX application.
 * Handles compound routes (e.g. householder PP + LBC).
 *
 * @param {object} planx - Top-level PlanX application object
 * @returns {{ route: string|null, consentTracks: string[], routeWarning: string|null }}
 */
function resolveRoute(planx) {
    // applicationType.value is the standard path (application.json).
    // preApplication.json stores the type at data.application.type.value instead.
    const typeValue = coalesce(
        get(planx, ['applicationType', 'value']),
        get(planx, ['data', 'application', 'type', 'value']),
    );

    if (!typeValue) {
        return { route: null, consentTracks: [], routeWarning: 'PlanX applicationType.value and data.application.type.value are both missing' };
    }

    if (UNSUPPORTED_PLANX_TYPES.has(typeValue)) {
        return {
            route: null,
            consentTracks: [],
            routeWarning: `PlanX application type "${typeValue}" is not supported by the GCC householder pipeline. Only householder PP, prior notification (Class A), and pre-application routes are supported.`,
            unsupported: true,
            unsupportedType: typeValue,
        };
    }

    const route = PLANX_TYPE_TO_ROUTE[typeValue];
    if (!route) {
        return {
            route: null,
            consentTracks: [],
            routeWarning: `PlanX application type "${typeValue}" could not be mapped to a GCC route. Supported PlanX types: ${Object.keys(PLANX_TYPE_TO_ROUTE).join(', ')}`,
        };
    }

    // Determine consent tracks
    const consentTracks = [];
    if (route === 'householder_planning_permission' || route === 'householder_planning_permission_and_listed_building_consent') {
        consentTracks.push('planning_permission');
    }
    if (route === 'householder_planning_permission_and_listed_building_consent') {
        consentTracks.push('listed_building_consent');
    }
    if (route === 'prior_notification_larger_home_extension') {
        consentTracks.push('prior_approval_larger_home_extension');
    }

    return { route, consentTracks, routeWarning: null };
}

/**
 * Map the PlanX application-level data to GCC application section.
 * @param {object} planx
 * @param {{ route, consentTracks }} routeInfo
 * @returns {object} GCC application section
 */
function mapApplicationSection(planx, routeInfo) {
    const data = planx.data || {};

    // Application reference — may be in metadata, planningApp, or preApp
    const reference = coalesce(
        get(planx, ['metadata', 'id']),
        get(data, ['planningApp', 'reference']),
        get(data, ['preApp', 'reference']),
    );

    // Description — may be on data directly or on proposal
    const description = coalesce(
        get(data, ['description']),
        get(data, ['proposal', 'description']),
        get(planx, ['applicationType', 'description']),
    );

    const application = {};

    if (reference)              application.application_reference = String(reference);
    if (routeInfo.route)        application.application_route = routeInfo.route;
    if (routeInfo.consentTracks.length > 0) application.consent_tracks = routeInfo.consentTracks;
    if (description)            application.description = description;

    // Submitted documents — PlanX stores these in data.documents array
    const docs = get(data, ['documents']);
    if (Array.isArray(docs) && docs.length > 0) {
        application.submitted_documents = docs
            .map(d => d.description || d.title || d.type || d.url)
            .filter(Boolean);
    }

    return application;
}

// ─── Site section mapping ─────────────────────────────────────────────────────

/**
 * Map PlanX planning designations to GCC site boolean flags.
 * PlanX stores designations as an array of { value: string, intersects: boolean } objects.
 * Only designations where intersects is not explicitly false are treated as active.
 * @param {Array} designations
 * @returns {object} partial site object
 */
function mapDesignations(designations) {
    if (!Array.isArray(designations)) return {};

    // Only include designations that actually intersect with the site.
    // intersects may be boolean or string; absent means unknown (include).
    const vals = new Set(
        designations
            .filter(d => d.intersects !== false && d.intersects !== 'false')
            .map(d => (d.value || d).toLowerCase())
    );
    const site = {};

    if (vals.has('listed') || vals.has('listed-building') || vals.has('listedbuilding') ||
        vals.has('designated.listed')) {
        site.listed_building = true;
    }
    // PlanX canonical value: "designated.conservationArea" → after toLowerCase: "designated.conservationarea"
    if (vals.has('designated.conservationarea') ||
        vals.has('conservation-area') || vals.has('conservation_area') ||
        vals.has('conservationarea') || vals.has('conservation area')) {
        site.conservation_area = true;
    }
    if (vals.has('listed-building-setting') || vals.has('setting-of-listed-building') ||
        vals.has('designated.listed.setting')) {
        site.listed_building_within_setting = true;
    }
    // PlanX canonical: "articleFour" / "articleFour.caz" → "articlefour" / "articlefour.caz"
    if (vals.has('articlefour') || vals.has('article-4') || vals.has('article4') ||
        vals.has('article_4_direction') || [...vals].some(v => v.startsWith('articlefour.'))) {
        site._article_4_detected = true;
    }
    // PlanX canonical: "monument" → scheduled monument / archaeological interest
    if (vals.has('monument') || vals.has('scheduled-monument') || vals.has('archaeological-priority')) {
        site.known_or_potential_archaeological_interest = true;
    }
    if (vals.has('aqma') || vals.has('air-quality-management-area')) {
        site.within_aqma = true;
    }
    // PlanX canonical: "road.classified"
    if (vals.has('road.classified') || vals.has('classified_road') || vals.has('classified-road')) {
        site.classified_road = true;
    }

    return site;
}

/**
 * Map PlanX flood risk data to GCC flood_zone enum.
 * @param {object} data - PlanX data object
 * @returns {string|undefined} GCC flood_zone value or undefined
 */
function mapFloodZone(data) {
    // PlanX may store flood zone in data.flood.zone, data.property.planning.flood,
    // or data.proposal.flood
    const candidates = [
        get(data, ['flood', 'zone']),
        get(data, ['property', 'planning', 'flood', 'zone']),
        get(data, ['proposal', 'flood', 'zone']),
        get(data, ['property', 'flood', 'zone']),
    ];

    for (const raw of candidates) {
        if (raw == null) continue;
        const normalised = String(raw).toLowerCase().trim();
        const mapped = PLANX_FLOOD_ZONE_MAP[normalised];
        if (mapped) return mapped;
    }

    return undefined;
}

/**
 * Map the PlanX property/site data to GCC site section.
 * @param {object} planx
 * @param {string[]} warnings - accumulator for data quality warnings
 * @returns {object} GCC site section
 */
function mapSiteSection(planx, warnings) {
    const data = planx.data || {};
    const property = data.property || {};
    const planning = property.planning || {};

    const site = {};

    // Address — PlanX stores as data.property.address or data.applicant.address
    const propAddress = property.address;
    const applicantAddress = get(data, ['applicant', 'address']);
    const addr = propAddress || applicantAddress;

    if (addr) {
        // PlanX address may be a string or an object.
        // Prefer singleLine (full formatted address) over constructing from parts,
        // as PlanX commonly omits line1 and only populates title + town + postcode.
        if (typeof addr === 'string') {
            site.address = addr;
        } else if (addr.singleLine) {
            site.address = addr.singleLine;
        } else {
            const parts = [
                addr.line1 || addr.title, addr.line2, addr.town, addr.county, addr.postcode,
            ].filter(Boolean);
            if (parts.length > 0) site.address = parts.join(', ');
        }
    }

    // Dwelling type.
    // preApplication.json stores type as { value: string } under data.property.type.value.
    // application.json stores it as a plain string under data.property.type.
    const dwellingRaw = coalesce(
        get(property, ['type', 'value']),   // preApp object form
        get(property, ['type']),            // application string form
        get(data, ['property', 'dwellingType']),
        get(data, ['proposal', 'existingUse', 'dwellingType']),
    );
    if (dwellingRaw) {
        const dwellingStr = String(dwellingRaw).toLowerCase();

        // Commercial property type — known residential/commercial misclassification risk.
        // Flag as data quality warning rather than silently dropping the value.
        if (dwellingStr.startsWith('commercial.') || dwellingStr === 'commercial') {
            warnings.push(
                `PlanX data.property.type is "${dwellingRaw}" — this appears to be a commercial use class. ` +
                'The householder pipeline applies only to dwellings. Check whether the property is lawfully used as a single dwelling before proceeding. ' +
                'If the lawful use is uncertain, set application.lawful_use_as_single_dwelling_confirmed to "unknown" in mapped_facts.'
            );
            // Do not set dwelling_type — leave unset so validation flags it
        } else {
            const mapped = PLANX_DWELLING_TYPE_MAP[dwellingStr] || PLANX_DWELLING_TYPE_MAP[dwellingRaw];
            if (mapped) site.dwelling_type = mapped;
        }
    }

    // Planning designations
    const designations = coalesce(
        planning.designations,
        get(property, ['designations']),
    );
    const designationFlags = mapDesignations(designations);
    Object.assign(site, designationFlags);

    // Listed building — check property.planning.designated.listed.intersects
    // and the legacy direct property.planning.listed path.
    // Must check intersects explicitly — a truthy object with intersects:false is NOT listed.
    if (!site.listed_building) {
        const listedObj = coalesce(
            get(planning, ['designated', 'listed']),
            get(planning, ['listed']),
            get(property, ['listed']),
        );
        if (listedObj != null) {
            if (typeof listedObj === 'object') {
                // { intersects: true/false } form
                if (listedObj.intersects === true || listedObj.intersects === 'true') {
                    site.listed_building = true;
                }
            } else if (listedObj !== false && listedObj !== 'false') {
                // plain boolean/string form
                site.listed_building = true;
            }
        }
    }

    // Conservation area — check property.planning.designated.conservationArea.intersects
    // and legacy direct paths.
    if (!site.conservation_area) {
        const caObj = coalesce(
            get(planning, ['designated', 'conservationArea']),
            get(planning, ['conservationArea']),
            get(planning, ['conservation_area']),
        );
        if (caObj != null) {
            if (typeof caObj === 'object') {
                if (caObj.intersects === true || caObj.intersects === 'true') {
                    site.conservation_area = true;
                }
            } else if (caObj !== false && caObj !== 'false') {
                site.conservation_area = true;
            }
        }
    }

    // Flood zone
    const floodZone = mapFloodZone(data);
    if (floodZone) {
        site.flood_zone = floodZone;
    }

    // Watercourse — PlanX may expose this via constraints
    const watercourse = coalesce(
        get(data, ['proposal', 'flood', 'nearWatercourse']),
        get(property, ['planning', 'watercourse']),
    );
    if (watercourse === true || watercourse === 'yes') {
        site.within_8m_of_watercourse = true;
    } else if (watercourse === false || watercourse === 'no') {
        site.within_8m_of_watercourse = false;
    }

    // Classified road — PlanX may store in property.planning.highwaysDedication
    const classifiedRoad = get(property, ['planning', 'classifiedRoad']);
    if (classifiedRoad != null) {
        site.classified_road = Boolean(classifiedRoad);
    }

    return site;
}

// ─── Proposal section mapping ─────────────────────────────────────────────────

/**
 * Map PlanX projectType array to GCC proposal_type array.
 * @param {Array} projectTypes - PlanX projectType array
 * @param {string[]} unmapped - accumulator for unmapped fields
 * @param {string[]} warnings - accumulator for warnings
 * @returns {string[]} GCC proposal_type array
 */
function mapProjectTypes(projectTypes, unmapped, warnings) {
    if (!Array.isArray(projectTypes) || projectTypes.length === 0) return [];

    const gccTypes = new Set();

    for (const pt of projectTypes) {
        const ptValue = typeof pt === 'object' ? (pt.value || pt.type) : pt;
        if (!ptValue) continue;

        const mapped = PLANX_PROJECT_TYPE_MAP[ptValue];

        if (mapped === null) {
            // Too vague or not a householder extension
            unmapped.push(`data.proposal.projectType[${ptValue}]`);
            warnings.push(`PlanX projectType "${ptValue}" is too broad to map automatically — review the submitted drawings to confirm the specific proposal type and set proposal.proposal_type accordingly.`);
        } else if (mapped === undefined) {
            unmapped.push(`data.proposal.projectType[${ptValue}]`);
            warnings.push(`PlanX projectType "${ptValue}" has no GCC proposal_type equivalent. Known types: ${Object.keys(PLANX_PROJECT_TYPE_MAP).join(', ')}.`);
        } else {
            gccTypes.add(mapped);
        }
    }

    return [...gccTypes];
}

/**
 * Map the PlanX proposal data to GCC proposal section.
 * @param {object} planx
 * @param {string[]} unmapped - accumulator for unmapped fields
 * @param {string[]} warnings - accumulator for warnings
 * @returns {object} GCC proposal section
 */
function mapProposalSection(planx, unmapped, warnings) {
    const data = planx.data || {};
    const proposal = data.proposal || {};

    const gcc = {};

    // Project / proposal types
    const projectTypes = coalesce(
        proposal.projectType,
        data.projectType,
    );
    const mappedTypes = mapProjectTypes(projectTypes, unmapped, warnings);
    if (mappedTypes.length > 0) {
        gcc.proposal_type = mappedTypes;
    }

    // Extension depth from rear wall (mm)
    // PlanX stores extension dimensions in data.proposal.extension or similar
    const extensionDepthM = coalesce(
        get(proposal, ['extension', 'depth']),
        get(proposal, ['measurements', 'extension', 'depth']),
        get(data, ['extension', 'depth']),
    );
    if (typeof extensionDepthM === 'number') {
        // PlanX often stores in metres; GCC uses mm
        gcc.extension_depth_from_existing_rear_wall_mm = Math.round(extensionDepthM * 1000);
    }

    // Extension ridge height (mm)
    const ridgeHeightM = coalesce(
        get(proposal, ['extension', 'height', 'ridge']),
        get(proposal, ['measurements', 'height', 'ridge']),
        get(data, ['extension', 'height', 'ridge']),
    );
    if (typeof ridgeHeightM === 'number') {
        gcc.extension_ridge_height_mm = Math.round(ridgeHeightM * 1000);
    }

    // Existing ridge height (mm)
    const existingRidgeM = coalesce(
        get(proposal, ['existing', 'height', 'ridge']),
        get(data, ['existing', 'height', 'ridge']),
    );
    if (typeof existingRidgeM === 'number') {
        gcc.existing_ridge_height_mm = Math.round(existingRidgeM * 1000);
    }

    // Extension eaves height (mm)
    const eavesHeightM = coalesce(
        get(proposal, ['extension', 'height', 'eaves']),
        get(proposal, ['measurements', 'height', 'eaves']),
    );
    if (typeof eavesHeightM === 'number') {
        gcc.extension_eaves_height_mm = Math.round(eavesHeightM * 1000);
    }

    // Existing eaves height (mm)
    const existingEavesM = coalesce(
        get(proposal, ['existing', 'height', 'eaves']),
        get(data, ['existing', 'height', 'eaves']),
    );
    if (typeof existingEavesM === 'number') {
        gcc.existing_eaves_height_mm = Math.round(existingEavesM * 1000);
    }

    // Remaining rear garden depth
    const gardenDepthM = coalesce(
        get(proposal, ['garden', 'remainingDepth']),
        get(data, ['garden', 'remainingDepth']),
        get(proposal, ['measurements', 'garden', 'depth']),
    );
    if (typeof gardenDepthM === 'number') {
        gcc.remaining_rear_garden_depth_m = gardenDepthM;
    }

    // Distance to boundary (mm)
    const boundaryDistM = coalesce(
        get(proposal, ['extension', 'boundary', 'distance']),
        get(proposal, ['distanceToBoundary']),
    );
    if (typeof boundaryDistM === 'number') {
        gcc.distance_to_boundary_mm = Math.round(boundaryDistM * 1000);
    }

    // Materials compatibility — PlanX stores in data.proposal.materials
    const materials = proposal.materials;
    if (materials) {
        const matchesExisting = coalesce(
            get(materials, ['matchExisting']),
            get(materials, ['match_existing']),
        );
        if (matchesExisting === true || matchesExisting === 'yes') {
            gcc.materials_compatibility = 'matching';
        } else if (matchesExisting === false || matchesExisting === 'no') {
            gcc.materials_compatibility = 'contrasting';
        }
    }

    // Additional bedrooms
    const newBedrooms = coalesce(
        get(proposal, ['units', 'residential', 'new']),
        get(data, ['units', 'residential', 'new']),
    );
    if (typeof newBedrooms === 'number' && newBedrooms > 0) {
        gcc.additional_bedrooms_created = newBedrooms;
    }

    // Parking — PlanX proposal.parking.spaces
    const parkingSpacesProposed = get(proposal, ['parking', 'spaces', 'proposed']);
    const parkingSpacesExisting = get(proposal, ['parking', 'spaces', 'existing']);
    if (typeof parkingSpacesProposed === 'number' && typeof parkingSpacesExisting === 'number') {
        if (parkingSpacesProposed < parkingSpacesExisting) {
            gcc.parking_affected = true;
            gcc.parking_spaces_retained = parkingSpacesProposed;
        } else {
            gcc.parking_affected = false;
        }
    }

    return gcc;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Map a PlanX application JSON to GCC householder application facts.
 *
 * @param {object} planx - Top-level PlanX application object
 * @returns {{
 *   mapped_facts: object,
 *   planx_application_type: string|null,
 *   suggested_route: string|null,
 *   mapping_confidence: 'high'|'partial'|'low',
 *   unmapped_fields: string[],
 *   mapping_warnings: string[],
 *   mapping_error: string|null,
 *   not_supported: boolean,
 *   planx_schema_note: string
 * }}
 */
function mapPlanxToGccFacts(planx) {
    const unmapped = [];
    const warnings = [];

    if (!planx || typeof planx !== 'object') {
        return {
            mapped_facts: null,
            planx_application_type: null,
            suggested_route: null,
            mapping_confidence: 'low',
            unmapped_fields: [],
            mapping_warnings: [],
            mapping_error: 'Input must be a PlanX application JSON object.',
            not_supported: false,
            planx_schema_note: 'theopensystemslab/digital-planning-data-schemas application.json',
        };
    }

    // Resolve route first — if unsupported, return early
    const routeInfo = resolveRoute(planx);

    if (routeInfo.unsupported) {
        return {
            mapped_facts: null,
            planx_application_type: routeInfo.unsupportedType,
            suggested_route: null,
            mapping_confidence: 'low',
            unmapped_fields: [],
            mapping_warnings: [],
            mapping_error: routeInfo.routeWarning,
            not_supported: true,
            planx_schema_note: 'theopensystemslab/digital-planning-data-schemas application.json',
        };
    }

    if (!routeInfo.route) {
        warnings.push(routeInfo.routeWarning || 'Could not determine GCC route from PlanX application type.');
    }

    // Map each section
    const application = mapApplicationSection(planx, routeInfo);
    const site        = mapSiteSection(planx, warnings);
    const proposal    = mapProposalSection(planx, unmapped, warnings);

    const mappedFacts = { application, site, proposal };

    // Assess mapping confidence
    const hasRoute    = Boolean(routeInfo.route);
    const hasAddress  = Boolean(site.address);
    const hasProposal = proposal.proposal_type && proposal.proposal_type.length > 0;

    let confidence;
    if (hasRoute && hasAddress && hasProposal) {
        confidence = 'high';
    } else if (hasRoute && (hasAddress || hasProposal)) {
        confidence = 'partial';
    } else {
        confidence = 'low';
        warnings.push('Mapping confidence is low — route, address, or proposal type could not be determined. Review the mapped_facts before passing to assessment tools.');
    }

    // Flood zone default warning
    if (!site.flood_zone) {
        warnings.push('Flood zone not found in PlanX data — site.flood_zone is not set. Check the submitted site location plan or the Environment Agency flood map for the site address.');
        unmapped.push('data.property.planning.flood.zone');
    }

    return {
        mapped_facts: mappedFacts,
        planx_application_type: get(planx, ['applicationType', 'value']) || null,
        suggested_route: routeInfo.route,
        mapping_confidence: confidence,
        unmapped_fields: unmapped,
        mapping_warnings: warnings,
        mapping_error: null,
        not_supported: false,
        planx_schema_note: 'theopensystemslab/digital-planning-data-schemas application.json — https://github.com/theopensystemslab/digital-planning-data-schemas',
    };
}

module.exports = {
    mapPlanxToGccFacts,
    // Exposed for testing
    resolveRoute,
    mapApplicationSection,
    mapSiteSection,
    mapProposalSection,
    PLANX_TYPE_TO_ROUTE,
    UNSUPPORTED_PLANX_TYPES,
    PLANX_PROJECT_TYPE_MAP,
};
