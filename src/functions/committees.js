/**
 * Azure Function: Committees API
 *
 * Thin wrapper around context.api - all logic is in context-api.js
 * Azure Functions v4 programming model
 */

import { app } from '@azure/functions';
import context from '../context-api.js';

/**
 * HTTP handler for committees endpoints
 * Delegates all logic to context.api
 */
app.http('committees', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'committees/{action?}/{id?}',
  handler: async (request, azContext) => {
    try {
      // Ensure context.api is initialized
      await context.api.ensureInitialized();

      // Extract parameters
      const action = request.params.action || 'list';
      const id = request.params.id;
      const query = request.query.get('query');
      const category = request.query.get('category');

      azContext.log(`Processing request: action=${action}, id=${id}`);

      // Delegate to context.api
      const response = await context.api.handleHttpRequest(action, id, query, category);

      return {
        status: response.status,
        headers: {
          'Content-Type': 'application/json'
        },
        jsonBody: response.body
      };

    } catch (error) {
      azContext.error('Error processing request:', error);
      return {
        status: 500,
        jsonBody: {
          error: 'Internal server error',
          message: error.message
        }
      };
    }
  }
});
