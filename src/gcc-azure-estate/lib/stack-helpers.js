/**
 * Shared helpers for azure_stack_* orchestration (tools/stack/*.js) and
 * the azure_application_stack_* relationship tools (tools/relationships/*.js).
 *
 * The stack tools call each resource family's own execute() functions
 * in-process (no new HTTP hop — same Node process) so every safety rule
 * already enforced by those tools (permission gate, partition-key
 * immutability, dependency-explicitness) applies automatically here too.
 */

'use strict';

const { AzureEstateError, ERROR_CODES } = require('./errors');

/**
 * Runs one step of a stack plan/create against a family tool's execute().
 * Never throws — normalizes both success and AzureEstateError into a
 * uniform step record so a stack-wide operation can report every blocker
 * across every resource instead of aborting at the first one.
 */
async function runStep(label, executeFn, args) {
    try {
        const result = await executeFn(args);
        return { label, ok: true, result };
    } catch (err) {
        if (err instanceof AzureEstateError) {
            return { label, ok: false, error: { code: err.code, message: err.message, details: err.details } };
        }
        return { label, ok: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: err.message } };
    }
}

/** Accepts either a plain path string ("/worldId") or a full {paths,kind,version} object. Never invents a key that wasn't supplied. */
function normalizePartitionKey(partitionKey) {
    if (typeof partitionKey === 'string') {
        return { paths: [partitionKey], kind: 'Hash' };
    }
    return partitionKey || null;
}

/** Fields our create tools require that the illustrative ApplicationStack YAML in the design spec leaves implicit — collected so a stack plan can name exactly what's missing rather than guessing it. */
function missingContractFields(block, fields) {
    return fields.filter((f) => block[f] === undefined || block[f] === null);
}

module.exports = { runStep, normalizePartitionKey, missingContractFields };
