/**
 * Tool: azure_application_stack_compare
 *
 * Compares a named application stack across two targets (e.g. the same
 * logical app across azure-prod vs a second instance) — each declared
 * component that's present on both sides is diffed via that family's own
 * *_compare tool; components declared on only one side are flagged.
 */

'use strict';

const { validateRequired, AzureEstateError, ERROR_CODES } = require('../../lib/errors');
const { assertPermitted } = require('../../lib/permissions');

const COMPONENT_KEYS = {
    functionApp: { compareModule: '../function-apps/compare', nameField: 'name' },
    staticWebApp: { compareModule: '../static-web-apps/compare', nameField: 'name' },
    storageAccount: { compareModule: '../storage-accounts/compare', nameField: 'name' },
    cosmosAccount: { compareModule: '../cosmos-accounts/compare', nameField: 'accountName' },
};

async function execute(args = {}) {
    const missing = validateRequired(args, ['left', 'right']);
    if (missing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, missing);
    for (const side of ['left', 'right']) {
        const sideMissing = validateRequired(args[side] || {}, ['instance', 'resourceGroup']);
        if (sideMissing) throw new AzureEstateError(ERROR_CODES.BAD_REQUEST, `${side}.${sideMissing.replace('Missing required field: ', '')} is required`);
        assertPermitted(args[side].instance, 'stack', 'compare');
    }

    const componentComparisons = {};
    const onlyInLeft = [];
    const onlyInRight = [];

    for (const [component, { compareModule, nameField }] of Object.entries(COMPONENT_KEYS)) {
        const leftName = args.left[component];
        const rightName = args.right[component];

        if (leftName && !rightName) { onlyInLeft.push(component); continue; }
        if (!leftName && rightName) { onlyInRight.push(component); continue; }
        if (!leftName && !rightName) continue;

        const { execute: compare } = require(compareModule);
        componentComparisons[component] = await compare({
            left: { instance: args.left.instance, resourceGroup: args.left.resourceGroup, [nameField]: leftName },
            right: { instance: args.right.instance, resourceGroup: args.right.resourceGroup, [nameField]: rightName },
        });
    }

    return {
        left: { resourceGroup: args.left.resourceGroup }, right: { resourceGroup: args.right.resourceGroup },
        componentComparisons,
        componentsOnlyInLeft: onlyInLeft,
        componentsOnlyInRight: onlyInRight,
    };
}

module.exports = { execute };
