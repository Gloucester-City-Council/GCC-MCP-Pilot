/**
 * Azure Functions App Entry Point
 * Registers all function handlers
 */

const { app } = require('@azure/functions');

// Import and register all function handlers
require('./functions/committees');

// Export the app for Azure Functions runtime
module.exports = app;
