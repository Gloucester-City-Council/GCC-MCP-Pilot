/**
 * Instance registry loader.
 *
 * Loads config/azure-instances.yaml once at cold start and validates its
 * shape. A named "instance" is one Azure subscription/environment the
 * Estate MCP is allowed to talk to, plus the operation classes it's
 * permitted to run against each resource family (see permissions.js).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'config', 'azure-instances.yaml');

const REQUIRED_INSTANCE_FIELDS = ['environment', 'subscriptionId', 'permissions'];

let _instances = null;
let _loadError = null;

function loadInstances() {
    if (_instances || _loadError) {
        return _instances;
    }

    let raw;
    try {
        raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    } catch (err) {
        _loadError = new Error(`Could not read instance registry at ${CONFIG_PATH}: ${err.message}`);
        throw _loadError;
    }

    let parsed;
    try {
        parsed = YAML.parse(raw);
    } catch (err) {
        _loadError = new Error(`Instance registry is not valid YAML: ${err.message}`);
        throw _loadError;
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.instances || typeof parsed.instances !== 'object') {
        _loadError = new Error('Instance registry must have a top-level "instances" object');
        throw _loadError;
    }

    for (const [name, instance] of Object.entries(parsed.instances)) {
        for (const field of REQUIRED_INSTANCE_FIELDS) {
            if (instance[field] === undefined || instance[field] === null) {
                _loadError = new Error(`Instance "${name}" is missing required field "${field}"`);
                throw _loadError;
            }
        }
    }

    _instances = parsed.instances;
    return _instances;
}

function listInstances() {
    const instances = loadInstances();
    return Object.entries(instances).map(([name, instance]) => ({
        name,
        environment: instance.environment,
        subscriptionId: instance.subscriptionId,
        permissions: instance.permissions,
    }));
}

function getInstance(name) {
    const instances = loadInstances();
    const instance = instances[name];
    if (!instance) {
        const available = Object.keys(instances).join(', ');
        throw new Error(`Unknown instance: "${name}". Available: ${available}`);
    }
    return { name, ...instance };
}

/** Reset cached state — test-only helper. */
function _resetForTests() {
    _instances = null;
    _loadError = null;
}

module.exports = { loadInstances, listInstances, getInstance, _resetForTests, CONFIG_PATH };
