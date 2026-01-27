/**
 * List Committees Tool
 * Returns all committees for a Gloucestershire council with enriched metadata
 */

const moderngovClient = require('../moderngov-client');
const councilConfig = require('../council-config');

/**
 * List all committees for a council, enriched with knowledge base data
 *
 * @param {string} councilName - Council name (optional, returns all councils if not specified)
 * @returns {Promise<object>} Committee data
 */
async function listCommittees(councilName = null) {
    // If no council specified, return committees for all councils
    if (!councilName) {
        const allCouncils = councilConfig.getCouncilNames();
        const allCommittees = [];

        for (const council of allCouncils) {
            try {
                const committeesData = councilConfig.getCommittees(council);
                if (committeesData && committeesData.committees) {
                    allCommittees.push({
                        council: council,
                        url: councilConfig.getCouncil(council).url,
                        committees: committeesData.committees.map(c => ({
                            id: c.id,
                            name: c.title,
                            description: c.purpose || c.purposeSuggested,
                            category: c.category,
                            purposeSource: c.purposeSource,
                            purposeConfidence: c.purposeConfidence,
                            urls: c.urls,
                            members: c.members,
                            contact: c.contact,
                            flags: c.flags
                        })),
                        metadata: {
                            last_updated: committeesData.generatedUtc,
                            total_count: committeesData.committees.length,
                            counts: committeesData.counts
                        }
                    });
                }
            } catch (e) {
                console.warn(`Error loading committees for ${council}:`, e);
            }
        }

        return {
            councils: allCommittees,
            total_councils: allCommittees.length,
            available_councils: allCouncils,
            note: 'To get committees for a specific council, provide the council_name parameter.'
        };
    }

    // Get committees for specific council
    const committeesData = councilConfig.getCommittees(councilName);
    if (!committeesData) {
        return {
            error: 'Council not found or no committee data available',
            council_name: councilName,
            available_councils: councilConfig.getCouncilNames()
        };
    }

    // Try to get live committees from ModernGov (may fail, that's OK)
    let liveCommittees = [];
    try {
        liveCommittees = await moderngovClient.getCommittees(councilName);
    } catch (e) {
        console.warn(`Could not fetch live committees for ${councilName}:`, e.message);
    }

    // Use knowledge base as primary source
    const knowledgeCommittees = (committeesData.committees || []).map(committee => ({
        id: committee.id,
        name: committee.title,
        description: committee.purpose || committee.purposeSuggested,
        category: committee.category,
        purposeSource: committee.purposeSource,
        purposeConfidence: committee.purposeConfidence,
        urls: committee.urls,
        members: committee.members,
        contact: committee.contact,
        flags: committee.flags,
        source: 'knowledge_base'
    }));

    // Enrich with live data if available
    const enriched = knowledgeCommittees.map(committee => {
        const liveMatch = liveCommittees.find(
            l => l.id === committee.id || l.name?.toLowerCase() === committee.name?.toLowerCase()
        );

        if (liveMatch) {
            return {
                ...committee,
                deleted: liveMatch.deleted,
                expired: liveMatch.expired,
                source: 'enriched'
            };
        }

        return committee;
    });

    // Analyze filters applied
    const counts = committeesData.counts || {};
    const filtersApplied = {
        total_from_api: counts.totalInFeed || 0,
        included_in_output: enriched.length,
        excluded_count: (counts.totalInFeed || 0) - enriched.length,
        exclusion_reasons: {
            deleted_or_expired: (counts.totalInFeed || 0) - (counts.activeInOutput || 0),
            note: 'Committees marked as deleted or expired in ModernGov are excluded from the output'
        },
        scrape_failures: counts.scrapeFailures || 0
    };

    // Add explanation if there's a significant difference
    if (filtersApplied.excluded_count > 0) {
        filtersApplied.explanation = `${filtersApplied.excluded_count} committees were excluded from the output. These are typically historical committees, disbanded groups, or archived structures that are no longer active.`;
    }

    return {
        council: councilName,
        url: councilConfig.getCouncil(councilName).url,
        committees: enriched,
        metadata: {
            last_updated: committeesData.generatedUtc,
            source: committeesData.source,
            counts: committeesData.counts,
            total_count: enriched.length,
            live_data_available: liveCommittees.length > 0,
            filters_applied: filtersApplied
        }
    };
}

module.exports = { listCommittees };
