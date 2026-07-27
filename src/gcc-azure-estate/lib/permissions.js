/**
 * Permission gate — the single enforcement point between a tool call and
 * Azure. Every write-capable tool (and, for defence in depth, every
 * read-capable tool) must call assertPermitted() before touching an SDK
 * client. Config-only change (config/azure-instances.yaml) to grant or
 * revoke an operation class; no code change required.
 */

'use strict';

const { getInstance } = require('./instances');
const { AzureEstateError, ERROR_CODES } = require('./errors');

// Matches the spec's global operation classes verbatim. "destructive" is
// reserved — no tool in this build maps to it (no delete tools exist).
const OPERATION_CLASSES = [
    'inspect', 'diagnose', 'compare', 'plan', 'create', 'modify',
    'restart', 'deploy', 'network', 'identity', 'scale', 'destructive',
];

function resolveInstance(instanceOrName) {
    return typeof instanceOrName === 'string' ? getInstance(instanceOrName) : instanceOrName;
}

/**
 * Throws AzureEstateError(FORBIDDEN) if the instance's permission list for
 * resourceFamily does not include operationClass. Returns the resolved
 * instance object on success so callers don't have to resolve it twice.
 */
function assertPermitted(instanceOrName, resourceFamily, operationClass) {
    if (!OPERATION_CLASSES.includes(operationClass)) {
        throw new AzureEstateError(
            ERROR_CODES.BAD_REQUEST,
            `Unknown operation class: "${operationClass}"`,
            { operationClass, validClasses: OPERATION_CLASSES }
        );
    }

    const instance = resolveInstance(instanceOrName);
    const granted = (instance.permissions && instance.permissions[resourceFamily]) || [];

    if (!granted.includes(operationClass)) {
        throw new AzureEstateError(
            ERROR_CODES.FORBIDDEN,
            `Instance "${instance.name}" is not permitted to "${operationClass}" on "${resourceFamily}". ` +
            `Granted: ${granted.length ? granted.join(', ') : '(none)'}.`,
            { instance: instance.name, resourceFamily, operationClass, granted }
        );
    }

    return instance;
}

module.exports = { assertPermitted, OPERATION_CLASSES };
