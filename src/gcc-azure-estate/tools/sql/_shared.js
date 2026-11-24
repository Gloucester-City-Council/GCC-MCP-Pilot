'use strict';

/** Awaits an ARM long-running operation whether the SDK returns a poller or the final resource. */
async function settle(result) {
    return result && typeof result.pollUntilDone === 'function' ? result.pollUntilDone() : result;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

module.exports = { settle, GUID, IPV4 };
