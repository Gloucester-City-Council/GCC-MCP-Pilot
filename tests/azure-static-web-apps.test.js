'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

function asyncIterable(items) {
    return {
        [Symbol.asyncIterator]: async function* () {
            for (const item of items) yield item;
        },
    };
}

/** A poller-like object mimicking the LRO methods (create/link/domain) return. */
function poller(result) {
    return { pollUntilDone: async () => result };
}

describe('Azure Estate static-web-apps family', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function mockWebSiteClient({
        sites = {}, // key: `${rg}::${name}` -> site object
        sitesByRg = {}, // key: rg -> [site,...]
        customDomains = {}, // key: `${rg}::${name}` -> [domain,...]
        builds = {}, // key -> [build,...]
        linkedBackends = {}, // key -> [backend,...]
        appSettings = {}, // key -> { properties: {...} }
        configuredRoles = {}, // key -> { properties: [...] }
        webApps = {}, // key: `${rg}::${name}` -> app object
        createOrUpdateStaticSiteImpl,
        createOrUpdateStaticSiteAppSettingsImpl,
        createOrUpdateStaticSiteCustomDomainImpl,
        linkBackendImpl,
    } = {}) {
        const getStaticSite = jest.fn(async (rg, name) => {
            const found = sites[`${rg}::${name}`];
            if (!found) {
                const err = new Error('not found');
                err.statusCode = 404;
                throw err;
            }
            return found;
        });

        return {
            staticSites: {
                listStaticSitesByResourceGroup: (rg) => asyncIterable(sitesByRg[rg] || []),
                getStaticSite,
                listStaticSiteCustomDomains: (rg, name) => asyncIterable(customDomains[`${rg}::${name}`] || []),
                listStaticSiteBuilds: (rg, name) => asyncIterable(builds[`${rg}::${name}`] || []),
                listLinkedBackends: (rg, name) => asyncIterable(linkedBackends[`${rg}::${name}`] || []),
                listStaticSiteAppSettings: jest.fn(async (rg, name) => appSettings[`${rg}::${name}`] || { properties: {} }),
                listStaticSiteConfiguredRoles: jest.fn(async (rg, name) => configuredRoles[`${rg}::${name}`] || { properties: [] }),
                createOrUpdateStaticSite: createOrUpdateStaticSiteImpl || jest.fn((rg, name, envelope) => poller({ name, ...envelope })),
                createOrUpdateStaticSiteAppSettings: createOrUpdateStaticSiteAppSettingsImpl || jest.fn(async (rg, name, settings) => ({ properties: settings })),
                createOrUpdateStaticSiteCustomDomain: createOrUpdateStaticSiteCustomDomainImpl || jest.fn((rg, name, domainName, envelope) => poller({ domainName, status: 'RetrievingValidationToken', ...envelope })),
                linkBackend: linkBackendImpl || jest.fn((rg, name, linkedBackendName, envelope) => poller({ ...envelope, provisioningState: 'Succeeded' })),
            },
            webApps: {
                get: jest.fn(async (rg, name) => {
                    const found = webApps[`${rg}::${name}`];
                    if (!found) {
                        const err = new Error('not found');
                        err.statusCode = 404;
                        throw err;
                    }
                    return found;
                }),
            },
        };
    }

    function mockResourceClient({ groups = {} } = {}) {
        return {
            resourceGroups: {
                get: jest.fn(async (name) => {
                    const found = groups[name];
                    if (!found) {
                        const err = new Error('not found');
                        err.statusCode = 404;
                        throw err;
                    }
                    return found;
                }),
            },
        };
    }

    function setupClients({ webSiteClient, resourceClient } = {}) {
        jest.doMock('@azure/arm-appservice', () => ({
            WebSiteManagementClient: jest.fn().mockImplementation(() => webSiteClient || mockWebSiteClient()),
        }));
        jest.doMock('@azure/arm-resources', () => ({
            ResourceManagementClient: jest.fn().mockImplementation(() => resourceClient || mockResourceClient()),
        }));
        jest.doMock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
    }

    it('azure_static_web_apps_list returns apps with name/resourceGroup/location/sku/defaultHostname/repositoryUrl/branch/tags', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sitesByRg: {
                    'rg-web': [{
                        name: 'my-swa', location: 'westeurope', sku: { name: 'Standard', tier: 'Standard' },
                        defaultHostname: 'my-swa.azurestaticapps.net', repositoryUrl: 'https://github.com/gcc/my-swa', branch: 'main', tags: { environment: 'production' },
                    }],
                },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/static-web-apps/list');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-web' });

        expect(result.totalCount).toBe(1);
        expect(result.staticWebApps[0]).toMatchObject({
            name: 'my-swa',
            resourceGroup: 'rg-web',
            location: 'westeurope',
            sku: { name: 'Standard', tier: 'Standard' },
            defaultHostname: 'my-swa.azurestaticapps.net',
            repositoryUrl: 'https://github.com/gcc/my-swa',
            branch: 'main',
        });
    });

    it('azure_static_web_app_inspect never returns a deployment token, repo token, or secret value anywhere', async () => {
        const SEEDED_SECRET = 'ghp_SUPER_SECRET_REPO_TOKEN_abcdef123456';
        const SEEDED_SETTING_VALUE = 'AccountKey=totally-secret-value-should-never-appear';

        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: {
                    'rg-web::my-swa': {
                        name: 'my-swa', location: 'westeurope', sku: { name: 'Standard', tier: 'Standard' },
                        defaultHostname: 'my-swa.azurestaticapps.net', repositoryUrl: 'https://github.com/gcc/my-swa', branch: 'main',
                        repositoryToken: SEEDED_SECRET, // must never appear in any tool output
                        identity: { type: 'SystemAssigned', principalId: 'principal-1', tenantId: 'tenant-1' },
                        tags: {},
                    },
                },
                customDomains: { 'rg-web::my-swa': [{ domainName: 'www.example.com', status: 'Ready' }] },
                builds: { 'rg-web::my-swa': [{ name: 'pr123', buildId: 'pr123', status: 'Ready', sourceBranch: 'feature/x' }] },
                linkedBackends: { 'rg-web::my-swa': [] },
                appSettings: {
                    'rg-web::my-swa': { properties: { API_URL: 'https://api.example.com', STORAGE_CONNECTION_STRING: SEEDED_SETTING_VALUE } },
                },
                configuredRoles: { 'rg-web::my-swa': { properties: ['anonymous', 'authenticated'] } },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/static-web-apps/inspect');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-web', name: 'my-swa' });

        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(SEEDED_SECRET);
        expect(serialized).not.toContain(SEEDED_SETTING_VALUE);
        expect(serialized).not.toContain('totally-secret-value');

        expect(result.applicationSettings.plainNames).toContain('API_URL');
        expect(result.applicationSettings.secretLikeNames).toContain('STORAGE_CONNECTION_STRING');
        expect(result.applicationSettings.totalCount).toBe(2);
        expect(result.customDomains[0]).toMatchObject({ domainName: 'www.example.com', status: 'Ready' });
        expect(result.managedIdentity).toMatchObject({ type: 'SystemAssigned' });
    });

    it('azure_static_web_app_diagnose flags a missing domain certificate, an unmet API expectation, and Free SKU in a production resource group', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: {
                    'rg-prod::my-swa': {
                        name: 'my-swa', location: 'westeurope', sku: { name: 'Free', tier: 'Free' }, tags: {},
                    },
                },
                customDomains: { 'rg-prod::my-swa': [{ domainName: 'www.example.com', status: 'Validating' }] },
                linkedBackends: { 'rg-prod::my-swa': [] },
                appSettings: { 'rg-prod::my-swa': { properties: { API_BASE_URL: 'https://api.example.com' } } },
                configuredRoles: { 'rg-prod::my-swa': { properties: [] } },
            }),
            resourceClient: mockResourceClient({ groups: { 'rg-prod': { name: 'rg-prod', location: 'westeurope', tags: { environment: 'production' } } } }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/static-web-apps/diagnose');
        const result = await execute({ instance: 'azure-prod', resourceGroup: 'rg-prod', name: 'my-swa' });

        expect(result.overallStatus).toBe('FINDINGS');
        expect(result.failedChecks).toEqual(expect.arrayContaining([
            'missingCustomDomainCertificate', 'noLinkedBackendForApiApp', 'skuMismatchForProduction', 'missingAuthenticationConfig',
        ]));
    });

    it('azure_static_web_app_create_plan returns a dependency-explicit plan without calling any write API, and azure_static_web_app_create is FORBIDDEN against the real azure-prod config', async () => {
        // Confirm the premise directly from the registry before asserting the FORBIDDEN behaviour.
        const registryPath = path.join(__dirname, '..', 'config', 'azure-instances.yaml');
        const registry = YAML.parse(fs.readFileSync(registryPath, 'utf-8'));
        const grantedOps = registry.instances['azure-prod'].permissions['static-web-apps'];
        expect(grantedOps).not.toContain('create');
        expect(grantedOps).toEqual(expect.arrayContaining(['inspect', 'diagnose', 'compare', 'plan']));

        const createOrUpdateSpy = jest.fn();
        setupClients({
            webSiteClient: mockWebSiteClient({ createOrUpdateStaticSiteImpl: createOrUpdateSpy }),
            resourceClient: mockResourceClient({ groups: { 'rg-web': { name: 'rg-web', location: 'westeurope', tags: {} } } }),
        });

        const { execute: planExecute } = require('../src/gcc-azure-estate/tools/static-web-apps/create-plan');
        const plan = await planExecute({
            instance: 'azure-prod', name: 'new-swa', resourceGroup: 'rg-web', location: 'westeurope', repositoryUrl: 'https://github.com/gcc/new-swa',
        });

        expect(plan.canCreate).toBe(true);
        expect(plan.steps).toEqual(expect.arrayContaining([
            expect.objectContaining({ step: 1, action: expect.stringContaining('resource group'), status: 'satisfied' }),
            expect.objectContaining({ step: 2, tool: 'azure_static_web_app_create', dependsOn: [1] }),
        ]));
        expect(plan.steps.find((s) => s.step === 3).dependsOn).toEqual([2]);
        expect(createOrUpdateSpy).not.toHaveBeenCalled();

        const { execute: createExecute } = require('../src/gcc-azure-estate/tools/static-web-apps/create');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(createExecute({ instance: 'azure-prod', name: 'new-swa', resourceGroup: 'rg-web', location: 'westeurope' }))
            .rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
        expect(createOrUpdateSpy).not.toHaveBeenCalled();
    });

    it('azure_static_web_app_settings_plan computes add/change/unchanged and never surfaces the existing (current-side) value', async () => {
        const EXISTING_SECRET_VALUE = 'existing-super-secret-value';
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: { 'rg-web::my-swa': { name: 'my-swa', location: 'westeurope', tags: {} } },
                appSettings: {
                    'rg-web::my-swa': { properties: { API_KEY: EXISTING_SECRET_VALUE, FEATURE_FLAG: 'old-value' } },
                },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/static-web-apps/settings-plan');
        const result = await execute({
            instance: 'azure-prod',
            resourceGroup: 'rg-web',
            name: 'my-swa',
            settings: { API_KEY: 'new-key-value', FEATURE_FLAG: 'old-value', NEW_SETTING: 'brand-new' },
        });

        expect(result.plan.toAdd).toEqual({ NEW_SETTING: 'brand-new' });
        expect(result.plan.toChange).toEqual({ API_KEY: { to: 'new-key-value' } });
        expect(result.plan.unchanged).toEqual(['FEATURE_FLAG']);
        expect(result.currentSettingNames).toEqual(expect.arrayContaining(['API_KEY', 'FEATURE_FLAG']));

        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(EXISTING_SECRET_VALUE);
    });

    it('azure_static_web_app_settings_apply merges with existing settings without ever returning existing values', async () => {
        // static-web-apps has no "modify" grant on the real azure-prod config
        // (see the create_plan/create test above) — use a fully-resolved
        // instance object with the grant this write tool needs, mirroring the
        // resource-groups compare test's pattern for a hand-built instance.
        const instance = {
            name: 'azure-prod', environment: 'production', subscriptionId: '00000000-0000-0000-0000-000000000000',
            permissions: { 'static-web-apps': ['inspect', 'diagnose', 'compare', 'plan', 'modify'] },
        };
        const EXISTING_SECRET_VALUE = 'existing-super-secret-value';
        const createOrUpdateAppSettingsSpy = jest.fn(async (rg, name, settings) => ({ properties: settings }));
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: { 'rg-web::my-swa': { name: 'my-swa', location: 'westeurope', tags: {} } },
                appSettings: { 'rg-web::my-swa': { properties: { API_KEY: EXISTING_SECRET_VALUE, KEEP_ME: 'unchanged-value' } } },
                createOrUpdateStaticSiteAppSettingsImpl: createOrUpdateAppSettingsSpy,
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/static-web-apps/settings-apply');
        const result = await execute({ instance, resourceGroup: 'rg-web', name: 'my-swa', settings: { API_KEY: 'rotated-value' } });

        expect(createOrUpdateAppSettingsSpy).toHaveBeenCalledWith('rg-web', 'my-swa', { API_KEY: 'rotated-value', KEEP_ME: 'unchanged-value' });
        expect(result.changed).toEqual(['API_KEY']);
        expect(JSON.stringify(result)).not.toContain(EXISTING_SECRET_VALUE);
    });

    it('azure_static_web_app_backend_link_plan returns the linked Function App resourceId for relationships tooling to consume', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: { 'rg-web::my-swa': { name: 'my-swa', location: 'westeurope', tags: {} } },
                linkedBackends: { 'rg-web::my-swa': [] },
                webApps: { 'rg-web::my-func': { name: 'my-func', kind: 'functionapp' } },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/static-web-apps/backend-link-plan');
        const result = await execute({
            instance: 'azure-prod', resourceGroup: 'rg-web', name: 'my-swa', functionApp: { name: 'my-func' },
        });

        // Read the real subscriptionId from config rather than hardcoding a
        // value — this test resolves 'azure-prod' by name (unlike the two
        // neighboring tests, which pass a hand-built instance object), so it
        // must track whatever config/azure-instances.yaml actually contains.
        const { getInstance } = require('../src/gcc-azure-estate/lib/instances');
        const realSubscriptionId = getInstance('azure-prod').subscriptionId;

        expect(result.canApply).toBe(true);
        expect(result.backendResourceId).toBe(`/subscriptions/${realSubscriptionId}/resourceGroups/rg-web/providers/Microsoft.Web/sites/my-func`);
        expect(result.steps.find((s) => s.step === 1).status).toBe('satisfied');
    });

    it('azure_static_web_app_backend_link_apply links the backend and returns its resourceId', async () => {
        // static-web-apps has no "deploy" grant on the real azure-prod config
        // — use a fully-resolved instance object with the grant this write
        // tool needs (see the settings_apply test above for the same pattern).
        const instance = {
            name: 'azure-prod', environment: 'production', subscriptionId: '00000000-0000-0000-0000-000000000000',
            permissions: { 'static-web-apps': ['inspect', 'diagnose', 'compare', 'plan', 'deploy'] },
        };
        const linkBackendSpy = jest.fn((rg, name, linkedBackendName, envelope) => poller({ ...envelope, provisioningState: 'Succeeded' }));
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: { 'rg-web::my-swa': { name: 'my-swa', location: 'westeurope', tags: {} } },
                webApps: { 'rg-web::my-func': { name: 'my-func', kind: 'functionapp' } },
                linkBackendImpl: linkBackendSpy,
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/static-web-apps/backend-link-apply');
        const result = await execute({
            instance, resourceGroup: 'rg-web', name: 'my-swa', functionApp: { name: 'my-func' },
        });

        expect(linkBackendSpy).toHaveBeenCalledWith('rg-web', 'my-swa', 'my-func', {
            backendResourceId: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-web/providers/Microsoft.Web/sites/my-func',
            region: 'westeurope',
        });
        expect(result.backendResourceId).toBe('/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-web/providers/Microsoft.Web/sites/my-func');
        expect(result.provisioningState).toBe('Succeeded');
    });

    it('azure_static_web_app_domain_plan infers dns-txt-token for apex domains and cname-delegation for subdomains', async () => {
        setupClients({
            webSiteClient: mockWebSiteClient({
                sites: { 'rg-web::my-swa': { name: 'my-swa', location: 'westeurope', tags: {} } },
                customDomains: { 'rg-web::my-swa': [] },
            }),
        });

        const { execute } = require('../src/gcc-azure-estate/tools/static-web-apps/domain-plan');

        const apex = await execute({ instance: 'azure-prod', resourceGroup: 'rg-web', name: 'my-swa', domainName: 'example.com' });
        expect(apex.validationMethod).toBe('dns-txt-token');

        const sub = await execute({ instance: 'azure-prod', resourceGroup: 'rg-web', name: 'my-swa', domainName: 'www.example.com' });
        expect(sub.validationMethod).toBe('cname-delegation');
    });

    it('azure_static_web_app_inspect throws NOT_FOUND for a missing static web app', async () => {
        setupClients({ webSiteClient: mockWebSiteClient({ sites: {} }) });

        const { execute } = require('../src/gcc-azure-estate/tools/static-web-apps/inspect');
        const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');

        await expect(execute({ instance: 'azure-prod', resourceGroup: 'rg-web', name: 'missing-swa' }))
            .rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    });
});
