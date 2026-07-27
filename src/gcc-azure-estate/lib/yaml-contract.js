/**
 * ApplicationStack YAML contract parsing/validation.
 *
 * Shape (apiVersion: azure-config-mcp/v1, kind: ApplicationStack):
 *   target: { instance, resourceGroup }
 *   resources: { functionApp?, staticWebApp?, storage?, cosmos? }
 *
 * Used by azure_stack_plan / azure_stack_create / azure_stack_verify /
 * azure_stack_compare / azure_stack_diagnose (see tools/stack/*).
 */

'use strict';

const YAML = require('yaml');
const { AzureEstateError, ERROR_CODES } = require('./errors');

function parseStackContract(yamlText) {
    let parsed;
    try {
        parsed = YAML.parse(yamlText);
    } catch (err) {
        throw new AzureEstateError(ERROR_CODES.INVALID_CONTRACT, `Stack contract is not valid YAML: ${err.message}`);
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new AzureEstateError(ERROR_CODES.INVALID_CONTRACT, 'Stack contract must be a YAML object');
    }

    if (parsed.kind !== 'ApplicationStack') {
        throw new AzureEstateError(ERROR_CODES.INVALID_CONTRACT, `Expected kind: ApplicationStack, got: ${parsed.kind}`);
    }

    if (!parsed.target || !parsed.target.instance || !parsed.target.resourceGroup) {
        throw new AzureEstateError(ERROR_CODES.INVALID_CONTRACT, 'target.instance and target.resourceGroup are required');
    }

    if (!parsed.resources || typeof parsed.resources !== 'object') {
        throw new AzureEstateError(ERROR_CODES.INVALID_CONTRACT, 'resources block is required');
    }

    return parsed;
}

module.exports = { parseStackContract };
