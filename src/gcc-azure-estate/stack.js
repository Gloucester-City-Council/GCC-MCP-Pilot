/**
 * Application Stack orchestration — the flagship cross-resource
 * capability. Consumes an ApplicationStack YAML contract (apiVersion:
 * azure-config-mcp/v1, kind: ApplicationStack — see lib/yaml-contract.js)
 * and drives it through the spec's 9-step algorithm by delegating to each
 * resource family's own tools in dependency order, so every safety rule
 * already enforced there (permission gate, partition-key immutability,
 * dependency-explicitness) applies automatically here too.
 */

'use strict';

const plan = require('./tools/stack/plan');
const create = require('./tools/stack/create');
const verify = require('./tools/stack/verify');
const compare = require('./tools/stack/compare');
const diagnose = require('./tools/stack/diagnose');

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };

const CONTRACT_PROPERTY = {
    instance: { type: 'string', description: 'Registered instance name. Optional — defaults to the contract\'s target.instance.' },
    contractYaml: { type: 'string', description: 'The ApplicationStack YAML contract text (apiVersion: azure-config-mcp/v1, kind: ApplicationStack).' },
};

const TOOLS = [
    {
        name: 'azure_stack_plan',
        description: '⭐ Dry-run for an ApplicationStack contract. Runs steps 1-6 of the build algorithm (inspect resource group, resolve existing resources, detect conflicts, dependency-ordered plan, create/change diff, required-permission check) without creating anything. Delegates to each family\'s own *_create_plan tool, so partition-key immutability and every other family-level safety rule already applies.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...CONTRACT_PROPERTY }, required: ['contractYaml'] },
    },
    {
        name: 'azure_stack_create',
        description: 'Builds the Azure resources described by an ApplicationStack contract, in dependency order (Resource Group -> Storage Account -> Blob Containers -> Cosmos Account -> Cosmos Database -> Cosmos Containers -> Function App -> Static Web App -> backend link). A resource that already exists and is not in conflict is skipped, not re-created. Aborts on the first hard failure and returns a partial-completion report — already-created resources are NOT rolled back.',
        annotations: WRITE_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...CONTRACT_PROPERTY }, required: ['contractYaml'] },
    },
    {
        name: 'azure_stack_verify',
        description: 'Re-inspects every resource declared in an ApplicationStack contract and confirms it exists with the expected relationships (e.g. the Function App\'s storage dependency actually points at the contract\'s declared storage account). Read-only — safe to run standalone to check for drift.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...CONTRACT_PROPERTY }, required: ['contractYaml'] },
    },
    {
        name: 'azure_stack_compare',
        description: 'Compares an ApplicationStack contract\'s actual state across two targets (e.g. the same contract applied to azure-prod vs a second instance) — which components exist on each side and whether their relationships are healthy.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: {
            type: 'object',
            properties: {
                left: { type: 'object', properties: { ...CONTRACT_PROPERTY }, required: ['contractYaml'] },
                right: { type: 'object', properties: { ...CONTRACT_PROPERTY }, required: ['contractYaml'] },
            },
            required: ['left', 'right'],
        },
    },
    {
        name: 'azure_stack_diagnose',
        description: 'Runs each declared resource\'s own *_diagnose tool across every component of an ApplicationStack contract, plus relationship health checks (azure_stack_verify). Cosmos databases have no dedicated diagnose tool in this build — noted, not silently skipped.',
        annotations: READ_ONLY_ANNOTATIONS,
        inputSchema: { type: 'object', properties: { ...CONTRACT_PROPERTY }, required: ['contractYaml'] },
    },
];

const TOOL_HANDLERS = {
    azure_stack_plan: plan.execute,
    azure_stack_create: create.execute,
    azure_stack_verify: verify.execute,
    azure_stack_compare: compare.execute,
    azure_stack_diagnose: diagnose.execute,
};

module.exports = { TOOLS, TOOL_HANDLERS };
