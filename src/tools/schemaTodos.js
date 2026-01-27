/**
 * schema.todos tool - Extract TODO and validation items from schema
 */

const { ERROR_CODES, createError, createSuccess } = require('../util/errors');
const { getSchema } = require('../schema/loader');
const { buildPointer } = require('../schema/pointer');

/**
 * Classify the severity of a TODO item
 * @param {string} note - The TODO note text
 * @param {string[]} pathTokens - Path to the TODO
 * @returns {string} Severity: "blocking", "needs-confirmation", or "nice-to-have"
 */
function classifySeverity(note, pathTokens) {
    const noteLower = note.toLowerCase();
    const pathStr = pathTokens.join('/').toLowerCase();

    // Blocking: legal/DPO sign-off required
    if (
        noteLower.includes('dpo') ||
        noteLower.includes('sign-off') ||
        noteLower.includes('sign off') ||
        noteLower.includes('before publication') ||
        noteLower.includes('legal')
    ) {
        return 'blocking';
    }

    // Needs confirmation: URLs, timescales, policy links, role confirmations
    if (
        noteLower.includes('url') ||
        noteLower.includes('link') ||
        noteLower.includes('confirm') ||
        noteLower.includes('timescale') ||
        noteLower.includes('processing time') ||
        noteLower.includes('validate') ||
        noteLower.includes('policy') ||
        noteLower.includes('current') ||
        pathStr.includes('validation_status')
    ) {
        return 'needs-confirmation';
    }

    // Nice-to-have: everything else
    return 'nice-to-have';
}

/**
 * Recursively find TODO items in an object
 * @param {*} obj - Object to search
 * @param {string[]} pathTokens - Current path tokens
 * @param {object[]} todos - Array to collect TODOs
 */
function findTodos(obj, pathTokens, todos) {
    if (obj === null || obj === undefined) {
        return;
    }

    if (typeof obj === 'string') {
        // Check if string contains TODO
        if (obj.includes('TODO')) {
            todos.push({
                jsonPath: buildPointer(pathTokens),
                note: obj,
                severity: classifySeverity(obj, pathTokens)
            });
        }
        return;
    }

    if (Array.isArray(obj)) {
        // Check for TODO_SUMMARY array
        if (pathTokens.length > 0 && pathTokens[pathTokens.length - 1] === 'TODO_SUMMARY') {
            for (let i = 0; i < obj.length; i++) {
                if (typeof obj[i] === 'string') {
                    todos.push({
                        jsonPath: buildPointer([...pathTokens, String(i)]),
                        note: obj[i],
                        severity: classifySeverity(obj[i], pathTokens)
                    });
                }
            }
            return;
        }

        for (let i = 0; i < obj.length; i++) {
            findTodos(obj[i], [...pathTokens, String(i)], todos);
        }
        return;
    }

    if (typeof obj === 'object') {
        // Check for TODO key
        if (obj.TODO) {
            const todoValue = Array.isArray(obj.TODO) ? obj.TODO : [obj.TODO];
            for (let i = 0; i < todoValue.length; i++) {
                const note = typeof todoValue[i] === 'string' ? todoValue[i] : JSON.stringify(todoValue[i]);
                todos.push({
                    jsonPath: buildPointer([...pathTokens, 'TODO']),
                    note,
                    severity: classifySeverity(note, pathTokens)
                });
            }
        }

        // Check for status containing TODO
        if (obj.status && typeof obj.status === 'string' && obj.status.includes('TODO')) {
            todos.push({
                jsonPath: buildPointer([...pathTokens, 'status']),
                note: obj.status,
                severity: classifySeverity(obj.status, pathTokens)
            });
        }

        // Recurse into all properties
        for (const key of Object.keys(obj)) {
            if (key === 'TODO') continue; // Already handled
            findTodos(obj[key], [...pathTokens, key], todos);
        }
    }
}

/**
 * Filter TODOs by scope
 * @param {object[]} todos - All TODO items
 * @param {string[]} scope - Sections to include (empty = all)
 * @returns {object[]} Filtered TODOs
 */
function filterByScope(todos, scope) {
    if (!scope || scope.length === 0) {
        return todos;
    }

    return todos.filter(todo => {
        // Get the top-level section from the path
        const pathParts = todo.jsonPath.split('/').filter(p => p);
        if (pathParts.length === 0) return false;

        const section = pathParts[0];
        return scope.includes(section);
    });
}

/**
 * Execute the schema.todos tool
 * @param {object} input - Tool input
 * @param {string[]} [input.scope] - Sections to search for TODOs
 * @returns {object} Tool result
 */
function execute(input = {}) {
    const schema = getSchema();

    if (!schema) {
        return createError(
            ERROR_CODES.SCHEMA_LOAD_FAILED,
            'Schema could not be loaded'
        );
    }

    const { scope } = input;

    // Validate scope if provided
    if (scope !== undefined && !Array.isArray(scope)) {
        return createError(
            ERROR_CODES.BAD_REQUEST,
            '"scope" must be an array of section names'
        );
    }

    try {
        const todos = [];
        findTodos(schema, [], todos);

        // Filter by scope
        const filtered = filterByScope(todos, scope);

        // Sort by severity (blocking first, then needs-confirmation, then nice-to-have)
        const severityOrder = { 'blocking': 0, 'needs-confirmation': 1, 'nice-to-have': 2 };
        filtered.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

        return createSuccess({
            todos: filtered,
            total: filtered.length,
            scope: scope || [],
            bySeverity: {
                blocking: filtered.filter(t => t.severity === 'blocking').length,
                'needs-confirmation': filtered.filter(t => t.severity === 'needs-confirmation').length,
                'nice-to-have': filtered.filter(t => t.severity === 'nice-to-have').length
            }
        });
    } catch (err) {
        return createError(
            ERROR_CODES.INTERNAL_ERROR,
            `Failed to extract TODOs: ${err.message}`
        );
    }
}

module.exports = { execute };
