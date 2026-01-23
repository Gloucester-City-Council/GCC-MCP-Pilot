/**
 * Azure Function: Committees API
 *
 * HTTP-triggered function that exposes committee data via REST API
 * Uses the v4 context.api pattern from the MCP server
 */

import { app } from '@azure/functions';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Get project paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..');

// Context object that will hold our API functions (v4 pattern)
const context = {
  api: {},
  data: null,
  initialized: false
};

/**
 * Load committees data from JSON file
 */
async function loadCommitteesData() {
  if (context.initialized) return;

  try {
    const filePath = join(projectRoot, 'json', 'committees.json');
    const fileContent = await readFile(filePath, 'utf-8');
    context.data = JSON.parse(fileContent);
    console.log(`✓ Loaded ${context.data?.committees?.length || 0} committees`);
  } catch (error) {
    console.error('✗ Failed to load committees data:', error);
    throw error;
  }
}

/**
 * Initialize all v4 API functions on context.api
 */
function initializeApiFunctions() {
  if (context.initialized) return;

  // API function: Get all committees
  context.api.getAllCommittees = () => {
    return context.data?.committees || [];
  };

  // API function: Get committee by ID
  context.api.getCommitteeById = (id) => {
    return context.data?.committees?.find(c => c.id === id);
  };

  // API function: Search committees
  context.api.searchCommittees = (query, category) => {
    let results = context.api.getAllCommittees();

    if (query) {
      const queryLower = query.toLowerCase();
      results = results.filter(c =>
        c.title.toLowerCase().includes(queryLower)
      );
    }

    if (category) {
      const categoryLower = category.toLowerCase();
      results = results.filter(c =>
        c.category && c.category.toLowerCase().includes(categoryLower)
      );
    }

    return results;
  };

  // API function: Get metadata
  context.api.getMetadata = () => {
    return {
      council: context.data?.council,
      generatedUtc: context.data?.generatedUtc,
      source: context.data?.source,
      counts: context.data?.counts
    };
  };

  // API function: Get categories
  context.api.getCategories = () => {
    const categories = new Set();
    context.api.getAllCommittees().forEach(c => {
      if (c.category) {
        categories.add(c.category);
      }
    });
    return Array.from(categories).sort();
  };

  // API function: Get committee members
  context.api.getCommitteeMembers = (committeeId) => {
    const committee = context.api.getCommitteeById(committeeId);
    if (!committee) {
      return null;
    }
    return {
      committee_id: committeeId,
      committee_name: committee.title,
      members: committee.members || []
    };
  };

  // API function: Get committees summary
  context.api.getCommitteesSummary = () => {
    const committees = context.api.getAllCommittees();
    const summary = committees.map(c => ({
      id: c.id,
      title: c.title,
      category: c.category,
      member_count: c.members?.length || 0,
      urls: c.urls
    }));

    return {
      total_committees: summary.length,
      metadata: context.api.getMetadata(),
      committees: summary
    };
  };

  context.initialized = true;
  console.log('✓ Initialized v4 API functions on context.api');
}

/**
 * Initialize context on cold start
 */
async function ensureInitialized() {
  if (!context.initialized) {
    await loadCommitteesData();
    initializeApiFunctions();
  }
}

/**
 * HTTP GET handler for committees endpoints
 */
app.http('committees', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'committees/{action?}/{id?}',
  handler: async (request, azContext) => {
    try {
      // Ensure context is initialized
      await ensureInitialized();

      const action = request.params.action || 'list';
      const id = request.params.id;
      const query = request.query.get('query');
      const category = request.query.get('category');

      azContext.log(`Processing request: action=${action}, id=${id}`);

      let result;

      switch (action) {
        case 'list':
        case 'all':
          result = context.api.getAllCommittees();
          break;

        case 'search':
          result = {
            query,
            category,
            count: 0,
            results: context.api.searchCommittees(query, category)
          };
          result.count = result.results.length;
          break;

        case 'get':
          if (!id) {
            return {
              status: 400,
              jsonBody: { error: 'Committee ID is required' }
            };
          }
          const committeeId = parseInt(id);
          if (isNaN(committeeId)) {
            return {
              status: 400,
              jsonBody: { error: 'Invalid committee ID' }
            };
          }
          result = context.api.getCommitteeById(committeeId);
          if (!result) {
            return {
              status: 404,
              jsonBody: { error: `Committee with ID ${committeeId} not found` }
            };
          }
          break;

        case 'members':
          if (!id) {
            return {
              status: 400,
              jsonBody: { error: 'Committee ID is required' }
            };
          }
          const membersCommitteeId = parseInt(id);
          if (isNaN(membersCommitteeId)) {
            return {
              status: 400,
              jsonBody: { error: 'Invalid committee ID' }
            };
          }
          result = context.api.getCommitteeMembers(membersCommitteeId);
          if (!result) {
            return {
              status: 404,
              jsonBody: { error: `Committee with ID ${membersCommitteeId} not found` }
            };
          }
          break;

        case 'categories':
          result = {
            categories: context.api.getCategories(),
            count: context.api.getCategories().length
          };
          break;

        case 'summary':
          result = context.api.getCommitteesSummary();
          break;

        case 'metadata':
          result = context.api.getMetadata();
          break;

        default:
          return {
            status: 400,
            jsonBody: {
              error: `Unknown action: ${action}`,
              availableActions: ['list', 'all', 'search', 'get', 'members', 'categories', 'summary', 'metadata']
            }
          };
      }

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        jsonBody: result
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
