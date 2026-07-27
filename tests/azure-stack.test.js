'use strict';

const MINIMAL_STORAGE_ONLY_CONTRACT = `
apiVersion: azure-config-mcp/v1
kind: ApplicationStack
target:
  instance: azure-prod
  resourceGroup: rg-world-join-prod
resources:
  storage:
    name: worldjoinprod
    sku: Standard_LRS
    kind: StorageV2
    containers:
      - name: audit
        publicAccess: none
`;

const CONTRACT_WITH_UNDERSPECIFIED_COSMOS = `
apiVersion: azure-config-mcp/v1
kind: ApplicationStack
target:
  instance: azure-prod
  resourceGroup: rg-world-join-prod
resources:
  cosmos:
    account: world-join-cosmos
    database: world-join
`;

function mockFamilyTool(modulePath, impl) {
    jest.doMock(modulePath, () => ({ execute: jest.fn(impl) }));
}

describe('Azure Estate stack orchestration', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    describe('azure_stack_plan', () => {
        it('reports readyToCreate when every declared resource can be created with no conflicts', async () => {
            mockFamilyTool('../src/gcc-azure-estate/tools/resource-groups/inspect', async () => ({ name: 'rg-world-join-prod', location: 'uksouth' }));
            mockFamilyTool('../src/gcc-azure-estate/tools/storage-accounts/create-plan', async () => ({ willCreate: true, conflicts: [] }));
            mockFamilyTool('../src/gcc-azure-estate/tools/blob-containers/create-plan', async () => ({ willCreate: true, conflicts: [] }));

            const { execute } = require('../src/gcc-azure-estate/tools/stack/plan');
            const result = await execute({ contractYaml: MINIMAL_STORAGE_ONLY_CONTRACT });

            expect(result.readyToCreate).toBe(true);
            expect(result.blockedSteps).toBe(0);
            expect(result.steps.map((s) => s.label)).toEqual(['resourceGroup', 'storage', 'storage.containers.audit']);
        });

        it('surfaces a BAD_REQUEST from an under-specified cosmos block as a plan blocker instead of throwing', async () => {
            mockFamilyTool('../src/gcc-azure-estate/tools/resource-groups/inspect', async () => ({ name: 'rg-world-join-prod', location: 'uksouth' }));
            // Real cosmos-accounts/create-plan would throw BAD_REQUEST for missing
            // apiType/consistencyPolicy/regions/capacityMode — simulate that here
            // without needing the real Cosmos ARM client.
            jest.doMock('../src/gcc-azure-estate/tools/cosmos-accounts/create-plan', () => ({
                execute: jest.fn(async () => {
                    const { AzureEstateError, ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');
                    throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, 'Missing required field: apiType');
                }),
            }));
            mockFamilyTool('../src/gcc-azure-estate/tools/cosmos-databases/create-plan', async () => ({
                databaseAlreadyExists: false, canApply: false, blockers: ['throughputModel missing'],
            }));

            const { execute } = require('../src/gcc-azure-estate/tools/stack/plan');
            const result = await execute({ contractYaml: CONTRACT_WITH_UNDERSPECIFIED_COSMOS });

            expect(result.readyToCreate).toBe(false);
            expect(result.blockers.find((b) => b.step === 'cosmos.account')).toBeTruthy();
        });

        it('rejects a contract with no target.instance and no explicit instance override', async () => {
            const { execute } = require('../src/gcc-azure-estate/tools/stack/plan');
            const { ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');
            // yaml-contract.js's own validation catches a missing target.instance
            // before stack/plan.js ever gets to check it itself.
            const badContract = MINIMAL_STORAGE_ONLY_CONTRACT.replace('instance: azure-prod', '');

            await expect(execute({ contractYaml: badContract })).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CONTRACT });
        });
    });

    describe('azure_stack_create', () => {
        it('creates in dependency order and skips resources that already exist', async () => {
            mockFamilyTool('../src/gcc-azure-estate/tools/resource-groups/inspect', async () => ({ name: 'rg-world-join-prod', location: 'uksouth' }));
            mockFamilyTool('../src/gcc-azure-estate/tools/storage-accounts/create-plan', async () => ({ willCreate: false, conflicts: ['Storage account "worldjoinprod" already exists'] }));
            mockFamilyTool('../src/gcc-azure-estate/tools/storage-accounts/create', async () => { throw new Error('should not be called — storage already exists'); });
            mockFamilyTool('../src/gcc-azure-estate/tools/blob-containers/create-plan', async () => ({ willCreate: true, conflicts: [] }));
            const containerCreate = jest.fn(async () => ({ created: true, name: 'audit' }));
            jest.doMock('../src/gcc-azure-estate/tools/blob-containers/create', () => ({ execute: containerCreate }));

            const { execute } = require('../src/gcc-azure-estate/tools/stack/create');
            const result = await execute({ contractYaml: MINIMAL_STORAGE_ONLY_CONTRACT });

            expect(result.aborted).toBe(false);
            expect(result.skipped).toEqual(expect.arrayContaining([
                expect.objectContaining({ label: 'resourceGroup', reason: 'already exists' }),
                expect.objectContaining({ label: 'storage', reason: 'already exists' }),
            ]));
            expect(containerCreate).toHaveBeenCalledTimes(1);
            expect(result.completed.some((c) => c.label === 'storage.containers.audit')).toBe(true);
        });

        it('aborts on first hard failure and returns a partial-completion report without rolling back', async () => {
            mockFamilyTool('../src/gcc-azure-estate/tools/resource-groups/inspect', async () => ({ name: 'rg-world-join-prod', location: 'uksouth' }));
            mockFamilyTool('../src/gcc-azure-estate/tools/storage-accounts/create-plan', async () => ({ willCreate: true, conflicts: [] }));
            mockFamilyTool('../src/gcc-azure-estate/tools/storage-accounts/create', async () => ({ created: true, name: 'worldjoinprod' }));
            mockFamilyTool('../src/gcc-azure-estate/tools/blob-containers/create-plan', async () => ({ willCreate: true, conflicts: [] }));
            jest.doMock('../src/gcc-azure-estate/tools/blob-containers/create', () => ({
                execute: jest.fn(async () => {
                    const { AzureEstateError, ERROR_CODES } = require('../src/gcc-azure-estate/lib/errors');
                    throw new AzureEstateError(ERROR_CODES.INTERNAL_ERROR, 'transient ARM failure');
                }),
            }));

            const { execute } = require('../src/gcc-azure-estate/tools/stack/create');
            const result = await execute({ contractYaml: MINIMAL_STORAGE_ONLY_CONTRACT });

            expect(result.aborted).toBe(true);
            expect(result.abortedAt).toBe('storage.containers.audit');
            expect(result.completed.some((c) => c.label === 'storage')).toBe(true);
            expect(result.reason.message).toMatch(/transient ARM failure/);
        });
    });

    describe('azure_stack_verify', () => {
        it('flags a storage-dependency mismatch as a relationship finding', async () => {
            const contract = `
apiVersion: azure-config-mcp/v1
kind: ApplicationStack
target:
  instance: azure-prod
  resourceGroup: rg-world-join-prod
resources:
  storage:
    name: worldjoinprod
    containers: []
  functionApp:
    name: world-join-api
`;
            mockFamilyTool('../src/gcc-azure-estate/tools/resource-groups/inspect', async () => ({ name: 'rg-world-join-prod' }));
            mockFamilyTool('../src/gcc-azure-estate/tools/storage-accounts/inspect', async () => ({ name: 'worldjoinprod' }));
            mockFamilyTool('../src/gcc-azure-estate/tools/function-apps/inspect', async () => ({
                storageDependency: { configured: true, accountName: 'some-other-account' },
            }));

            const { execute } = require('../src/gcc-azure-estate/tools/stack/verify');
            const result = await execute({ contractYaml: contract });

            expect(result.allResourcesPresent).toBe(true);
            expect(result.relationshipFindings[0]).toMatch(/some-other-account/);
            expect(result.verified).toBe(false);
        });
    });
});
