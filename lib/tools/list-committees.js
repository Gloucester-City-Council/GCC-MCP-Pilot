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
    committeesData = { committees: [] };
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

    // Try to merge live data with knowledge base
    const enriched = liveCommittees.map(committee => {
        // Try to find match in knowledge base by name or ID
        const knowledgeEntry = (committeesData.committees || []).find(
            k => (k.id && k.id === committee.id) ||
                 (k.title && k.title.toLowerCase() === (committee.name || '').toLowerCase())
        );

        if (knowledgeEntry) {
            return {
                ...committee,
                description: knowledgeEntry.purpose || knowledgeEntry.purposeSuggested,
                category: knowledgeEntry.category,
                purposeSource: knowledgeEntry.purposeSource,
                purposeConfidence: knowledgeEntry.purposeConfidence,
                urls: knowledgeEntry.urls,
                members: knowledgeEntry.members,
                contact: knowledgeEntry.contact,
                flags: knowledgeEntry.flags,
                source: 'enriched'
            };
        }

        return {
            ...committee,
            source: 'moderngov_only'
        };
    });

    // Add any knowledge base committees not in live data
    const liveIds = new Set(liveCommittees.map(c => c.id).filter(Boolean));
    const liveNames = new Set(liveCommittees.map(c => (c.name || '').toLowerCase()));
    const additionalFromKnowledge = knowledgeCommittees.filter(
        kc => !liveIds.has(kc.id) && !liveNames.has((kc.name || '').toLowerCase())
    );

    return {
        committees: [...enriched, ...additionalFromKnowledge],
        metadata: {
            council: committeesData.council || 'Gloucester City Council',
            last_updated: committeesData.generatedUtc || 'unknown',
            source: committeesData.source,
            counts: committeesData.counts,
            source_note: 'Live data from ModernGov SOAP API is currently STUBBED. Knowledge base provides supplementary information.',
            total_count: enriched.length + additionalFromKnowledge.length
        }
    };
}

module.exports = { listCommittees };
