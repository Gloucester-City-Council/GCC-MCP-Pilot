'use strict';

/**
 * ct_todos tool — extract publication gates and assurance gaps from the revised schema.
 *
 * The revised schema stores issues in ct_rules.json under human_review_gates.blocking_issues
 * rather than as TODO strings scattered through the document.  This tool surfaces those
 * structured issues alongside any legacy TODO markers still present elsewhere.
 */

const { ERROR_CODES, createError, createSuccess } = require('../util/errors');
const { getSchema, getDocument } = require('../schema/revisedLoader');
const { buildPointer } = require('../schema/pointer');

function severityFromBlockingIssue(issue) {
    const s = (issue.severity || '').toLowerCase();
    const title = (issue.title || '').toLowerCase();
    if (s === 'critical' || title.includes('dpo') || title.includes('sign off') || title.includes('legal')) {
        return 'blocking';
    }
    if (s === 'high' || title.includes('confirm') || title.includes('validate') || title.includes('performance')) {
        return 'needs-confirmation';
    }
    return 'nice-to-have';
}

function extractBlockingIssues(rulesDoc) {
    const hrg = (rulesDoc && rulesDoc.human_review_gates) || {};
    const todos = [];

    const requiresSignOff = hrg.publication_requires_named_sign_off;
    if (requiresSignOff) {
        todos.push({
            jsonPath: '/human_review_gates/publication_requires_named_sign_off',
            note: 'Publication requires named sign-off — see governance_roles for responsible officers',
            severity: 'blocking',
            source: 'human_review_gates',
        });
    }

    for (const [i, issue] of (hrg.blocking_issues || []).entries()) {
        todos.push({
            jsonPath: `/human_review_gates/blocking_issues/${i}`,
            note: issue.title || issue.issue_id || `Issue ${i}`,
            severity: severityFromBlockingIssue(issue),
            source: 'human_review_gates',
            issueId: issue.issue_id,
            status: issue.status,
            blocksPublication: issue.blocks_publication === true,
        });
    }

    return todos;
}

// Also scan the schema for legacy TODO markers (kept for forward-compatibility)
function classifyLegacyTodo(note, pathTokens) {
    const lower = note.toLowerCase();
    const pathStr = pathTokens.join('/').toLowerCase();
    if (lower.includes('dpo') || lower.includes('sign-off') || lower.includes('sign off') ||
        lower.includes('before publication') || lower.includes('legal')) return 'blocking';
    if (lower.includes('url') || lower.includes('link') || lower.includes('confirm') ||
        lower.includes('timescale') || lower.includes('processing time') || lower.includes('validate') ||
        lower.includes('policy') || lower.includes('current') || pathStr.includes('validation_status')) {
        return 'needs-confirmation';
    }
    return 'nice-to-have';
}

function findLegacyTodos(obj, pathTokens, todos) {
    if (obj === null || obj === undefined) return;
    if (typeof obj === 'string') {
        if (obj.includes('TODO')) {
            todos.push({
                jsonPath: buildPointer(pathTokens),
                note: obj,
                severity: classifyLegacyTodo(obj, pathTokens),
                source: 'inline_todo',
            });
        }
        return;
    }
    if (Array.isArray(obj)) {
        if (pathTokens.length > 0 && pathTokens[pathTokens.length - 1] === 'TODO_SUMMARY') {
            for (let i = 0; i < obj.length; i++) {
                if (typeof obj[i] === 'string') {
                    todos.push({
                        jsonPath: buildPointer([...pathTokens, String(i)]),
                        note: obj[i],
                        severity: classifyLegacyTodo(obj[i], pathTokens),
                        source: 'inline_todo',
                    });
                }
            }
            return;
        }
        for (let i = 0; i < obj.length; i++) findLegacyTodos(obj[i], [...pathTokens, String(i)], todos);
        return;
    }
    if (typeof obj === 'object') {
        if (obj.TODO) {
            const vals = Array.isArray(obj.TODO) ? obj.TODO : [obj.TODO];
            for (const val of vals) {
                const note = typeof val === 'string' ? val : JSON.stringify(val);
                todos.push({
                    jsonPath: buildPointer([...pathTokens, 'TODO']),
                    note,
                    severity: classifyLegacyTodo(note, pathTokens),
                    source: 'inline_todo',
                });
            }
        }
        if (obj.status && typeof obj.status === 'string' && obj.status.includes('TODO')) {
            todos.push({
                jsonPath: buildPointer([...pathTokens, 'status']),
                note: obj.status,
                severity: classifyLegacyTodo(obj.status, pathTokens),
                source: 'inline_todo',
            });
        }
        for (const key of Object.keys(obj)) {
            if (key === 'TODO') continue;
            findLegacyTodos(obj[key], [...pathTokens, key], todos);
        }
    }
}

function filterByScope(todos, scope) {
    if (!scope || scope.length === 0) return todos;
    return todos.filter(todo => {
        const parts = todo.jsonPath.split('/').filter(Boolean);
        return parts.length > 0 && scope.includes(parts[0]);
    });
}

function execute(input = {}) {
    const schema = getSchema();
    if (!schema) {
        return createError(ERROR_CODES.SCHEMA_LOAD_FAILED, 'Revised council tax schema could not be loaded');
    }

    const { scope } = input;
    if (scope !== undefined && !Array.isArray(scope)) {
        return createError(ERROR_CODES.BAD_REQUEST, '"scope" must be an array of section names');
    }

    try {
        const rulesDoc = getDocument('rules');
        const structured = extractBlockingIssues(rulesDoc);

        const legacy = [];
        findLegacyTodos(schema, [], legacy);

        // Deduplicate — prefer structured entries; skip legacy entries whose paths
        // are already covered by a structured entry.
        const structuredPaths = new Set(structured.map(t => t.jsonPath));
        const dedupedLegacy = legacy.filter(t => !structuredPaths.has(t.jsonPath));

        const todos = [...structured, ...dedupedLegacy];

        const filtered = filterByScope(todos, scope);

        const severityOrder = { blocking: 0, 'needs-confirmation': 1, 'nice-to-have': 2 };
        filtered.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

        return createSuccess({
            todos: filtered,
            total: filtered.length,
            scope: scope || [],
            bySeverity: {
                blocking: filtered.filter(t => t.severity === 'blocking').length,
                'needs-confirmation': filtered.filter(t => t.severity === 'needs-confirmation').length,
                'nice-to-have': filtered.filter(t => t.severity === 'nice-to-have').length,
            },
        });
    } catch (err) {
        return createError(ERROR_CODES.INTERNAL_ERROR, `Failed to extract todos: ${err.message}`);
    }
}

module.exports = { execute };
