/**
 * Azure Functions App Entry Point
 *
 * This file registers all Azure Functions for the application.
 * Azure Functions v4 programming model.
 */

import { app } from '@azure/functions';

// Import and register all function handlers
import './functions/committees.js';

// Export the app for Azure Functions runtime
export default app;
