/**
 * Response envelope, date-context wrapper, and secret redaction.
 *
 * redact() is applied centrally to every tool result before it is
 * serialized (see index.js's dispatch wrapper) so no individual tool can
 * accidentally leak a connection string, account key, SAS token, or
 * deployment token.
 */

'use strict';

const SECRET_KEY_PATTERN = /(key|secret|password|token|connectionstring|sastoken|primarymasterkey|secondarymasterkey)/i;
const REDACTED = '[REDACTED]';

function redact(value, seen = new WeakSet()) {
    if (Array.isArray(value)) {
        return value.map((item) => redact(item, seen));
    }

    if (value && typeof value === 'object') {
        if (seen.has(value)) return '[CIRCULAR]';
        seen.add(value);

        const out = {};
        for (const [key, val] of Object.entries(value)) {
            out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(val, seen);
        }
        return out;
    }

    return value;
}

function getDateContext() {
    const now = new Date();
    return {
        generatedAt: now.toISOString(),
        date: now.toISOString().split('T')[0],
    };
}

/** Wrap a tool's raw result with date context + redaction, ready to serialize. */
function wrapToolResult(toolName, instanceName, data) {
    return {
        ...getDateContext(),
        instance: instanceName,
        tool: toolName,
        data: redact(data),
    };
}

module.exports = { redact, getDateContext, wrapToolResult };
