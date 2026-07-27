/**
 * Small internal helpers shared across the blob-containers tool family.
 * Not a tool itself — no `execute` export, so it is never registered as an
 * MCP tool by the family aggregator.
 */

'use strict';

const VALID_PUBLIC_ACCESS = ['None', 'Blob', 'Container'];

// Azure blob container naming rules: 3-63 chars, lowercase letters, numbers,
// and hyphens; must start/end with a letter or number; no consecutive hyphens.
const NAME_PATTERN = /^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/;

function validateContainerName(name) {
    const issues = [];
    if (typeof name !== 'string' || name.length < 3 || name.length > 63) {
        issues.push(`Container name "${name}" must be between 3 and 63 characters.`);
    } else if (!NAME_PATTERN.test(name)) {
        issues.push(`Container name "${name}" is invalid — must be lowercase letters, numbers, and hyphens only, starting and ending with a letter or number, with no consecutive hyphens.`);
    }
    return { pass: issues.length === 0, issues };
}

function validatePublicAccess(publicAccess) {
    if (publicAccess === undefined || publicAccess === null) return { pass: true, issues: [] };
    if (!VALID_PUBLIC_ACCESS.includes(publicAccess)) {
        return { pass: false, issues: [`Unknown publicAccess "${publicAccess}". Valid values: ${VALID_PUBLIC_ACCESS.join(', ')}.`] };
    }
    return { pass: true, issues: [] };
}

/** Maps the ARM-style PublicAccess value ("None"/"Blob"/"Container") to the
 * data-plane's PublicAccessType (undefined/"blob"/"container"), used only
 * when calling the data-plane setAccessPolicy — the only container-level
 * operation that manages stored access policies. */
function toDataPlanePublicAccess(armPublicAccess) {
    if (!armPublicAccess || armPublicAccess === 'None') return undefined;
    return armPublicAccess.toLowerCase();
}

/** Does a management-policy rule (by prefix match) cover this container? */
function isCoveredByLifecycleRule(managementPolicy, containerName) {
    const rules = (managementPolicy && managementPolicy.policy && managementPolicy.policy.rules) || [];
    return rules.some((rule) => {
        const prefixes = (rule.definition && rule.definition.filter && rule.definition.filter.prefixMatch) || [];
        return prefixes.some((prefix) => prefix === containerName || prefix === `${containerName}/` || prefix.startsWith(`${containerName}/`));
    });
}

module.exports = {
    VALID_PUBLIC_ACCESS,
    validateContainerName,
    validatePublicAccess,
    toDataPlanePublicAccess,
    isCoveredByLifecycleRule,
};
