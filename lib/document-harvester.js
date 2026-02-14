/**
 * Document Harvester
 * Crawls all Gloucestershire councils' ModernGov systems to collect
 * meeting documents from a configurable date range.
 *
 * Pipeline: councils → committees → meetings → meeting details → attachments → PDF text
 */

const axios = require('axios');
const pdfParse = require('pdf-parse');
const modernGovClient = require('./moderngov-client');
const councilConfig = require('./council-config');

const DOWNLOAD_TIMEOUT = 30000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Format a Date as DD/MM/YYYY for ModernGov API
 * @param {Date} date
 * @returns {string}
 */
function formatDateUK(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

/**
 * Download and extract text from a PDF URL
 * @param {string} url - PDF document URL
 * @returns {Promise<{text: string, pageCount: number, wordCount: number}|null>}
 */
async function extractPdfText(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: DOWNLOAD_TIMEOUT,
            maxContentLength: MAX_FILE_SIZE,
            headers: {
                'Accept': 'application/pdf,*/*',
                'User-Agent': 'GCC-MCP-DocumentHarvester/1.0'
            }
        });

        const buffer = Buffer.from(response.data);
        const pdf = await pdfParse(buffer);

        const text = pdf.text || '';
        const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

        return {
            text,
            pageCount: pdf.numpages || 0,
            wordCount
        };
    } catch (error) {
        // Silently skip documents that can't be downloaded or parsed
        return null;
    }
}

/**
 * Harvest all documents from all councils within a date range.
 *
 * @param {object} options
 * @param {Date}   [options.fromDate]       - Start date (default: 1 year ago)
 * @param {Date}   [options.toDate]         - End date (default: today)
 * @param {string} [options.councilName]    - Single council to harvest (optional, default: all)
 * @param {number} [options.maxDocuments]   - Cap on total documents to fetch (default: no limit)
 * @param {number} [options.concurrency]    - Max parallel PDF downloads (default: 3)
 * @param {function} [options.onProgress]   - Progress callback(stage, detail)
 * @returns {Promise<object[]>} Array of harvested document objects
 */
async function harvestDocuments(options = {}) {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const fromDate = options.fromDate || oneYearAgo;
    const toDate = options.toDate || now;
    const maxDocuments = options.maxDocuments || Infinity;
    const concurrency = options.concurrency || 3;
    const onProgress = options.onProgress || (() => {});

    const fromDateStr = formatDateUK(fromDate);
    const toDateStr = formatDateUK(toDate);

    // Determine which councils to crawl
    const councilNames = options.councilName
        ? [options.councilName]
        : councilConfig.getCouncilNames();

    const documents = [];
    const errors = [];
    let totalMeetings = 0;
    let totalAttachments = 0;

    for (const councilName of councilNames) {
        if (documents.length >= maxDocuments) break;

        onProgress('council', { council: councilName });

        // Get committees for this council
        let committees;
        try {
            committees = await modernGovClient.getCommittees(councilName);
        } catch (err) {
            // Fall back to knowledge base committees
            const councilData = councilConfig.getCommittees(councilName);
            if (councilData && councilData.committees) {
                committees = councilData.committees.map(c => ({
                    id: c.id || c.committeeid,
                    name: c.title || c.committeetitle || c.name,
                    deleted: false,
                    expired: false
                }));
            } else {
                errors.push({ council: councilName, stage: 'committees', error: err.message });
                continue;
            }
        }

        // Filter out deleted/expired committees
        const activeCommittees = committees.filter(c => !c.deleted && !c.expired);

        for (const committee of activeCommittees) {
            if (documents.length >= maxDocuments) break;

            onProgress('committee', { council: councilName, committee: committee.name });

            // Get meetings for this committee in date range
            let meetings;
            try {
                const result = await modernGovClient.getMeetings(
                    councilName,
                    committee.id,
                    fromDateStr,
                    toDateStr
                );
                meetings = result.meetings || [];
            } catch (err) {
                errors.push({
                    council: councilName,
                    committee: committee.name,
                    stage: 'meetings',
                    error: err.message
                });
                continue;
            }

            totalMeetings += meetings.length;

            for (const meeting of meetings) {
                if (documents.length >= maxDocuments) break;

                // Get meeting details (includes linked documents)
                let details;
                try {
                    details = await modernGovClient.getMeeting(councilName, meeting.id);
                } catch (err) {
                    errors.push({
                        council: councilName,
                        committee: committee.name,
                        meeting_id: meeting.id,
                        stage: 'meeting_details',
                        error: err.message
                    });
                    continue;
                }

                // Collect all attachment URLs from agenda items
                const attachments = [];
                if (details.agenda && Array.isArray(details.agenda)) {
                    for (const agendaItem of details.agenda) {
                        if (agendaItem.linked_documents && Array.isArray(agendaItem.linked_documents)) {
                            for (const doc of agendaItem.linked_documents) {
                                if (doc.url && !doc.is_restricted) {
                                    attachments.push({
                                        id: doc.attachmentid,
                                        title: doc.title,
                                        url: doc.url,
                                        publication_date: doc.publication_date,
                                        agenda_item_title: agendaItem.title
                                    });
                                }
                            }
                        }
                    }
                }

                totalAttachments += attachments.length;

                // Download PDFs in batches
                for (let i = 0; i < attachments.length; i += concurrency) {
                    if (documents.length >= maxDocuments) break;

                    const batch = attachments.slice(i, i + concurrency);
                    const results = await Promise.allSettled(
                        batch.map(att => extractPdfText(att.url))
                    );

                    for (let j = 0; j < results.length; j++) {
                        if (documents.length >= maxDocuments) break;

                        const result = results[j];
                        const att = batch[j];

                        if (result.status === 'fulfilled' && result.value && result.value.text.length > 50) {
                            documents.push({
                                council: councilName,
                                committee: committee.name,
                                committee_id: committee.id,
                                meeting_id: meeting.id,
                                meeting_date: meeting.date,
                                meeting_location: meeting.location,
                                attachment_id: att.id,
                                document_title: att.title,
                                document_url: att.url,
                                agenda_item: att.agenda_item_title,
                                publication_date: att.publication_date,
                                text: result.value.text,
                                page_count: result.value.pageCount,
                                word_count: result.value.wordCount
                            });

                            onProgress('document', {
                                council: councilName,
                                title: att.title,
                                total: documents.length
                            });
                        }
                    }
                }
            }
        }
    }

    return {
        documents,
        stats: {
            councils_crawled: councilNames.length,
            total_meetings: totalMeetings,
            total_attachments: totalAttachments,
            documents_harvested: documents.length,
            errors: errors.length,
            date_range: { from: fromDateStr, to: toDateStr }
        },
        errors: errors.length > 0 ? errors : undefined
    };
}

module.exports = { harvestDocuments, extractPdfText, formatDateUK };
