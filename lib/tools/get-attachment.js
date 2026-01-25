/**
 * Get Attachment Tool
 * Gets metadata and URL for a specific document/attachment
 */

const moderngovClient = require('../moderngov-client');

/**
 * Get metadata and URL for a specific document/attachment
 *
 * @param {number} attachmentId - Attachment ID from ModernGov
 * @returns {Promise<object>} Attachment information including URL
 */
async function getAttachment(attachmentId) {
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
    const result = await moderngovClient.getAttachment(parsedAttachmentId);

    return {
        attachment_id: parsedAttachmentId,
        title: result.title || null,
        url: result.url || null,
        publication_date: result.publicationdate || null,
        meeting_date: result.meetingdate || null,
        committee: result.committeetitle || null,
        owner_title: result.ownertitle || null,
        is_restricted: result.isrestricted || false,
        council: 'Gloucester City Council',
        note: 'Use this URL to download or view the document'
    };
}

module.exports = { getAttachment };
