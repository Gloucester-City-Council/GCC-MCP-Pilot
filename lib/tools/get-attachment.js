/**
 * Get Attachment Tool
 * Gets metadata and URL for a specific document/attachment in a Gloucestershire council
 */

const moderngovClient = require('../moderngov-client');
const councilConfig = require('../council-config');

/**
 * Get metadata and URL for a specific document/attachment
 *
 * @param {string} councilName - Council name
 * @param {number} attachmentId - Attachment ID from ModernGov
 * @returns {Promise<object>} Attachment information including URL
 */
async function getAttachment(councilName, attachmentId) {
    // Validate council name
    if (!councilName) {
        return {
            error: 'council_name is required',
            available_councils: councilConfig.getCouncilNames()
        };
    }

    const council = councilConfig.getCouncil(councilName);
    if (!council) {
        return {
            error: 'Council not found',
            council_name: councilName,
            available_councils: councilConfig.getCouncilNames()
        };
    }

    // Validate attachment ID
    if (typeof attachmentId !== 'number' && typeof attachmentId !== 'string') {
        return {
            error: 'Invalid attachment_id',
            hint: 'attachment_id must be a number. Use get_meeting_details to find attachment IDs in linkeddocuments.'
        };
    }

    const parsedAttachmentId = parseInt(attachmentId, 10);
    if (isNaN(parsedAttachmentId)) {
        return {
            error: 'Invalid attachment_id',
            hint: 'attachment_id must be a valid integer'
        };
    }

    // Get attachment from ModernGov
    const result = await moderngovClient.getAttachment(councilName, parsedAttachmentId);

    return {
        council: councilName,
        attachment_id: parsedAttachmentId,
        title: result.title || null,
        url: result.url || null,
        publication_date: result.publicationdate || null,
        meeting_date: result.meetingdate || null,
        committee: result.committeetitle || null,
        owner_title: result.ownertitle || null,
        is_restricted: result.isrestricted || false,
        note: 'Use this URL to download or view the document'
    };
}

module.exports = { getAttachment };
