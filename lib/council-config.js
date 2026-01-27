/**
 * Council Configuration Module
 * Loads and provides access to all Gloucestershire council configurations
 */

const path = require('path');
const fs = require('fs');

class CouncilConfig {
    constructor() {
        this.councils = new Map();
        this.loadCouncils();
    }

    /**
     * Load all councils from the Gloucestershire configuration
     */
    loadCouncils() {
        try {
            // Load the main councils configuration
            const councilsData = require('../json/Gloucestershire/councils.json');

            councilsData.councils.forEach(council => {
                // Normalize council name for folder lookup
                const folderName = council.name.replace(/ /g, '_');

                // Load committees data
                let committees = null;
                try {
                    committees = require(`../json/Gloucestershire/council_data/${folderName}/committees.json`);
                } catch (e) {
                    console.warn(`No committees data for ${council.name}`);
                }

                // Load wards data
                let wards = null;
                try {
                    wards = require(`../json/Gloucestershire/council_data/${folderName}/wards.json`);
                } catch (e) {
                    console.warn(`No wards data for ${council.name}`);
                }

                this.councils.set(council.name, {
                    name: council.name,
                    url: council.url,
                    endpoint: `${council.url}/mgWebService.asmx`,
                    committees: committees,
                    wards: wards
                });
            });

            console.log(`Loaded ${this.councils.size} councils:`, Array.from(this.councils.keys()));
        } catch (error) {
            console.error('Error loading council configuration:', error);
            throw error;
        }
    }

    /**
     * Get all available councils
     * @returns {Array} Array of council names
     */
    getCouncilNames() {
        return Array.from(this.councils.keys());
    }

    /**
     * Get council configuration by name
     * @param {string} councilName - Council name
     * @returns {object|null} Council configuration or null if not found
     */
    getCouncil(councilName) {
        return this.councils.get(councilName) || null;
    }

    /**
     * Get council endpoint URL
     * @param {string} councilName - Council name
     * @returns {string|null} Endpoint URL or null if not found
     */
    getEndpoint(councilName) {
        const council = this.getCouncil(councilName);
        return council ? council.endpoint : null;
    }

    /**
     * Get committees data for a council
     * @param {string} councilName - Council name
     * @returns {object|null} Committees data or null if not found
     */
    getCommittees(councilName) {
        const council = this.getCouncil(councilName);
        return council ? council.committees : null;
    }

    /**
     * Get wards data for a council
     * @param {string} councilName - Council name
     * @returns {object|null} Wards data or null if not found
     */
    getWards(councilName) {
        const council = this.getCouncil(councilName);
        return council ? council.wards : null;
    }

    /**
     * Find council by partial name match
     * @param {string} partialName - Partial council name
     * @returns {string|null} Full council name or null if not found
     */
    findCouncilByPartialName(partialName) {
        const normalized = partialName.toLowerCase();
        for (const councilName of this.councils.keys()) {
            if (councilName.toLowerCase().includes(normalized)) {
                return councilName;
            }
        }
        return null;
    }

    /**
     * Get summary of all councils
     * @returns {Array} Array of council summaries
     */
    getAllCouncilsSummary() {
        return Array.from(this.councils.values()).map(council => ({
            name: council.name,
            url: council.url,
            has_committees: !!council.committees,
            has_wards: !!council.wards,
            committee_count: council.committees?.committees?.length || 0,
            ward_count: council.wards?.wards?.length || 0
        }));
    }
}

// Export singleton instance
module.exports = new CouncilConfig();
