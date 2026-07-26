/**
 * Tool: azure_stack_compare
 *
 * Compares an ApplicationStack contract's actual state across two
 * targets — typically the same contract applied to two instances (e.g.
 * azure-prod vs a second environment), but the two sides may also use
 * different contracts to compare drift between related stacks. Built on
 * azure_stack_verify so it reuses the same resource-presence and
 * relationship checks.
 */

'use strict';

const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { assertPermitted } = require('../../lib/permissions');
const { parseStackContract } = require('../../lib/yaml-contract');
const { execute: verify } = require('./verify');

async function execute(args = {}) {
    const missing = validateRequired(args, ['left', 'right']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);
    for (const side of ['left', 'right']) {
        const sideMissing = validateRequired(args[side] || {}, ['contractYaml']);
        if (sideMissing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `${side}.contractYaml is required`);

        const sideContract = parseStackContract(args[side].contractYaml);
        const sideInstance = args[side].instance || sideContract.target.instance;
        if (!sideInstance) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `${side}: target.instance is required in the contract (or pass ${side}.instance explicitly)`);
        assertPermitted(sideInstance, 'stack', 'compare');
    }

    const [left, right] = await Promise.all([verify(args.left), verify(args.right)]);

    const leftLabels = new Set(left.results.filter((r) => r.ok).map((r) => r.label));
    const rightLabels = new Set(right.results.filter((r) => r.ok).map((r) => r.label));

    const onlyInLeft = [...leftLabels].filter((l) => !rightLabels.has(l));
    const onlyInRight = [...rightLabels].filter((l) => !leftLabels.has(l));

    return {
        left: { target: left.target, allResourcesPresent: left.allResourcesPresent, relationshipFindings: left.relationshipFindings },
        right: { target: right.target, allResourcesPresent: right.allResourcesPresent, relationshipFindings: right.relationshipFindings },
        componentsOnlyInLeft: onlyInLeft,
        componentsOnlyInRight: onlyInRight,
        identical: onlyInLeft.length === 0 && onlyInRight.length === 0
            && left.relationshipFindings.length === 0 && right.relationshipFindings.length === 0,
    };
}

module.exports = { execute };
