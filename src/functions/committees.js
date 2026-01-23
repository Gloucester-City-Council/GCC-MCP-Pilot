const { app } = require("@azure/functions");
const fs = require("fs");
const path = require("path");

// Load committees data on cold start
let committeesData = null;

function loadCommitteesData() {
  if (!committeesData) {
    const filePath = path.join(__dirname, "..", "..", "json", "committees.json");
    const fileContent = fs.readFileSync(filePath, "utf-8");
    committeesData = JSON.parse(fileContent);
    console.log(`Loaded ${committeesData.committees?.length || 0} committees`);
  }
  return committeesData;
}

app.http("committees", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "committees/{action?}/{id?}",
  handler: async (request, context) => {
    try {
      // Load data
      const data = loadCommitteesData();

      // Extract parameters
      const action = request.params.action || "list";
      const id = request.params.id;
      const query = request.query.get("query");
      const category = request.query.get("category");

      context.log(`Processing request: action=${action}, id=${id}`);

      let result;

      switch (action) {
        case "list":
        case "all":
          result = data.committees;
          break;

        case "search":
          result = {
            query,
            category,
            count: 0,
            results: data.committees.filter(c => {
              const matchesQuery = !query || c.title.toLowerCase().includes(query.toLowerCase());
              const matchesCategory = !category || (c.category && c.category.toLowerCase().includes(category.toLowerCase()));
              return matchesQuery && matchesCategory;
            })
          };
          result.count = result.results.length;
          break;

        case "get":
          if (!id) {
            return {
              status: 400,
              jsonBody: { error: "Committee ID is required" }
            };
          }
          const committeeId = parseInt(id);
          if (isNaN(committeeId)) {
            return {
              status: 400,
              jsonBody: { error: "Invalid committee ID" }
            };
          }
          result = data.committees.find(c => c.id === committeeId);
          if (!result) {
            return {
              status: 404,
              jsonBody: { error: `Committee with ID ${committeeId} not found` }
            };
          }
          break;

        case "members":
          if (!id) {
            return {
              status: 400,
              jsonBody: { error: "Committee ID is required" }
            };
          }
          const membersCommitteeId = parseInt(id);
          if (isNaN(membersCommitteeId)) {
            return {
              status: 400,
              jsonBody: { error: "Invalid committee ID" }
            };
          }
          const committee = data.committees.find(c => c.id === membersCommitteeId);
          if (!committee) {
            return {
              status: 404,
              jsonBody: { error: `Committee with ID ${membersCommitteeId} not found` }
            };
          }
          result = {
            committee_id: membersCommitteeId,
            committee_name: committee.title,
            members: committee.members || []
          };
          break;

        case "categories":
          const categories = [...new Set(data.committees.map(c => c.category).filter(Boolean))].sort();
          result = {
            categories,
            count: categories.length
          };
          break;

        case "summary":
          result = {
            total_committees: data.committees.length,
            metadata: {
              council: data.council,
              generatedUtc: data.generatedUtc,
              source: data.source,
              counts: data.counts
            },
            committees: data.committees.map(c => ({
              id: c.id,
              title: c.title,
              category: c.category,
              member_count: c.members?.length || 0,
              urls: c.urls
            }))
          };
          break;

        case "metadata":
          result = {
            council: data.council,
            generatedUtc: data.generatedUtc,
            source: data.source,
            counts: data.counts
          };
          break;

        default:
          return {
            status: 400,
            jsonBody: {
              error: `Unknown action: ${action}`,
              availableActions: ["list", "all", "search", "get", "members", "categories", "summary", "metadata"]
            }
          };
      }

      return {
        status: 200,
        jsonBody: result
      };

    } catch (error) {
      context.error("Error processing request:", error);
      return {
        status: 500,
        jsonBody: {
          error: "Internal server error",
          message: error.message
        }
      };
    }
  }
});
