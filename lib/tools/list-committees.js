/**
 * List Committees Tool
 * Returns all committees at Gloucester City Council with enriched metadata
 */

const moderngovClient = require('../moderngov-client');
const path = require('path');

// Load committees knowledge base
let committeesData;
try {
    committeesData = require('../../json/committees.json');
} catch (e) {
    committeesData = { committees: {} };
}

/**
 * List all committees, enriched with knowledge base data
 *
 * @returns {Promise<Array>} Array of committee objects
 */
async function listCommittees() {
    // Get committees from ModernGov (currently stub data)
    const liveCommittees = await moderngovClient.getCommittees();

    // Also include committees from our knowledge base
    const knowledgeCommittees = Object.entries(committeesData.committees || {}).map(
        ([key, committee]) => ({
            key,
            id: committee.moderngov_id,
            name: committee.official_name,
            description: committee.description,
            keywords: committee.keywords || [],
            typical_topics: committee.typical_topics || [],
            source: 'knowledge_base'
        })
    );

    // Try to merge live data with knowledge base
    const enriched = liveCommittees.map(committee => {
        // Try to find match in knowledge base by name
        const knowledgeEntry = Object.values(committeesData.committees || {}).find(
            k => k.official_name &&
                 k.official_name.toLowerCase() === (committee.name || '').toLowerCase()
        );

        if (knowledgeEntry) {
            return {
                ...committee,
                description: knowledgeEntry.description,
                keywords: knowledgeEntry.keywords || [],
                typical_topics: knowledgeEntry.typical_topics || [],
                source: 'enriched'
            };
        }

        return {
            ...committee,
            source: 'moderngov_only'
        };
    });

    // Add any knowledge base committees not in live data
    const liveNames = new Set(liveCommittees.map(c => (c.name || '').toLowerCase()));
    const additionalFromKnowledge = knowledgeCommittees.filter(
        kc => !liveNames.has((kc.name || '').toLowerCase())
    );

    return {
        committees: [...enriched, ...additionalFromKnowledge],
        metadata: {
            council: committeesData.metadata?.council || 'Gloucester City Council',
            last_updated: committeesData.metadata?.last_updated || 'unknown',
            source_note: 'Live data from ModernGov SOAP API is currently STUBBED. Knowledge base provides supplementary information.',
            total_count: enriched.length + additionalFromKnowledge.length
        }
    };
}

module.exports = { listCommittees };
