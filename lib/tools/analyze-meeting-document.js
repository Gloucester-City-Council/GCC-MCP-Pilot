/**
 * Analyze Meeting Document Tool
 * Fetches and parses committee documents (PDFs) from Gloucester City Council's
 * ModernGov system to extract structured information including reasons for reports,
 * recommendations, questions, and motions.
 */

const axios = require('axios');
const pdfParse = require('pdf-parse');
const councilConfig = require('../council-config');

// Constants
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const WARN_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DOWNLOAD_TIMEOUT = 30000; // 30 seconds
const MAX_ITEMS_DEFAULT = 20;

/**
 * Derive council name from document URL by matching against known council URLs
 * @param {string} url - Document URL
 * @returns {object} - { council: string|null, isKnownCouncil: boolean }
 */
function deriveCouncilFromUrl(url) {
    if (!url) {
        return { council: null, isKnownCouncil: false };
    }

    // Get all council names and check each one
    const councilNames = councilConfig.getCouncilNames();
    const urlLower = url.toLowerCase();

    // Try to match URL against council base URLs
    for (const councilName of councilNames) {
        const council = councilConfig.getCouncil(councilName);
        if (!council) continue;

        const councilUrl = council.url.toLowerCase();

        // Extract hostname from council URL for matching
        try {
            const councilHost = new URL(councilUrl).hostname;
            if (urlLower.includes(councilHost)) {
                return { council: council.name, isKnownCouncil: true };
            }
        } catch (e) {
            // If URL parsing fails, try simple string matching
            if (urlLower.includes(councilUrl)) {
                return { council: council.name, isKnownCouncil: true };
            }
        }
    }

    // Check if it's a ModernGov URL but from an unknown council
    const isModernGov = url.includes('moderngov.co.uk') ||
                        url.includes('.gov.uk') ||
                        url.includes('democracy.') ||
                        url.includes('meetings.') ||
                        url.includes('minutes.');

    return {
        council: null,
        isKnownCouncil: false,
        isModernGov: isModernGov
    };
}

// Section header patterns (case-insensitive)
const SECTION_PATTERNS = {
    reason: /^(reason for report|purpose of report|purpose|executive summary|background and context)\s*:?\s*$/i,
    recommendations: /^(recommendations?|officers? recommends?|proposed resolutions?)\s*:?\s*$/i,
    financial: /^(financial implications?|budget implications?|resource implications?|financial comments?)\s*:?\s*$/i,
    legal: /^(legal implications?|legal comments?|constitutional issues?)\s*:?\s*$/i,
    risk: /^(risk assessment|risks?|risk implications?)\s*:?\s*$/i,
    background: /^(background|context|introduction)\s*:?\s*$/i
};

// Question patterns
const QUESTION_PATTERNS = {
    questionNumber: /^(?:question\s*(\d+)|q\s*(\d+))/i,
    questionFrom: /^question from\s+(.+)/i,
    answer: /^(?:response|answer|reply)\s*:?\s*/i
};

// Motion patterns
const MOTION_PATTERNS = {
    noticeOfMotion: /^notice of motion/i,
    proposer: /^(?:proposed by|proposer)\s*:?\s*(?:councillor\s+)?(.+)/i,
    seconder: /^(?:seconded by|seconder)\s*:?\s*(?:councillor\s+)?(.+)/i,
    thisCouncil: /^this council/i
};

// Amendment patterns
const AMENDMENT_PATTERNS = {
    amendmentHeader: /^amendment\s*(?:to|:)/i,
    amendmentProposed: /^(?:amendment\s+)?proposed by\s*:?\s*(?:councillor\s+)?(.+)/i,
    amendmentSeconded: /^(?:amendment\s+)?seconded by\s*:?\s*(?:councillor\s+)?(.+)/i,
    amendmentTo: /amendment\s+to\s+(?:the\s+)?(?:motion|recommendation|resolution)/i,
    thatMotionBeAmended: /that\s+(?:the\s+)?(?:motion|recommendation)\s+be\s+amended/i,
    deleteInsert: /(?:delete|insert|substitute|add|remove)\s+(?:the\s+)?(?:words?|paragraph|section)/i,
    amendedText: /^(?:amended\s+)?(?:motion|recommendation|text)\s*:/i
};

/**
 * Analyze a meeting document from a URL
 *
 * @param {string} url - The document URL from get_attachment
 * @param {string[]} extractSections - Which sections to extract (default: ["all"])
 * @param {number} maxItems - Maximum items to return for lists (default: 20)
 * @returns {Promise<object>} Structured document analysis
 */
async function analyzeMeetingDocument(url, extractSections = ['all'], maxItems = MAX_ITEMS_DEFAULT) {
    const warnings = [];

    // Validate URL
    if (!url || typeof url !== 'string') {
        return {
            success: false,
            error: 'URL is required',
            error_type: 'invalid_input',
            suggestion: 'Please provide a valid document URL from get_attachment'
        };
    }

    // Derive council from URL
    const councilInfo = deriveCouncilFromUrl(url);
    if (!councilInfo.isKnownCouncil) {
        if (councilInfo.isModernGov) {
            warnings.push('URL appears to be from a ModernGov system but not a recognized Gloucestershire council');
        } else {
            warnings.push('URL does not appear to be from a ModernGov system');
        }
    }

    let pdfBuffer;
    let pdfText;
    let pageCount = 0;

    // Step 1: Download PDF
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: DOWNLOAD_TIMEOUT,
            maxContentLength: MAX_FILE_SIZE,
            headers: {
                'Accept': 'application/pdf',
                'User-Agent': 'GCC-MCP-DocumentAnalyzer/1.0'
            }
        });

        pdfBuffer = Buffer.from(response.data);

        // Check file size
        if (pdfBuffer.length > WARN_FILE_SIZE) {
            warnings.push(`Large document (${Math.round(pdfBuffer.length / 1024 / 1024)}MB) - extraction may be slower`);
        }

    } catch (error) {
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            return {
                success: false,
                error: 'Document download timed out',
                error_type: 'network_error',
                suggestion: 'The document is taking too long to download. Please try again or access it directly at: ' + url
            };
        }
        if (error.response?.status === 404) {
            return {
                success: false,
                error: 'Document not found',
                error_type: 'network_error',
                suggestion: 'The document URL may be incorrect or the document has been removed'
            };
        }
        if (error.response?.status === 403) {
            return {
                success: false,
                error: 'Access denied to document',
                error_type: 'access_denied',
                suggestion: 'This document may be restricted. Contact the council for access.'
            };
        }
        return {
            success: false,
            error: 'Unable to download document: ' + error.message,
            error_type: 'network_error',
            suggestion: 'Please check the URL is correct and try again. Access document directly at: ' + url
        };
    }

    // Step 2: Extract text from PDF
    try {
        const pdfData = await pdfParse(pdfBuffer);
        pdfText = pdfData.text;
        pageCount = pdfData.numpages;

        // Check if scanned/image PDF (very little text extracted)
        if (!pdfText || pdfText.trim().length < 100) {
            return {
                success: false,
                error: 'Document appears to be a scanned image without extractable text',
                error_type: 'scanned_pdf',
                suggestion: 'This document needs to be viewed directly at: ' + url + '. OCR text extraction is not currently available.',
                metadata: {
                    page_count: pageCount
                }
            };
        }

        if (pageCount > 50) {
            warnings.push(`Large document (${pageCount} pages) - some content may be truncated`);
        }

    } catch (error) {
        return {
            success: false,
            error: 'Unable to parse PDF content: ' + error.message,
            error_type: 'parse_error',
            suggestion: 'This document may have an unusual format. Please view the original at: ' + url
        };
    }

    // Step 3: Detect document type
    const documentType = detectDocumentType(pdfText);

    // Skip appendices unless specifically requested
    const title = extractTitle(pdfText);
    if (isAppendix(title) && !extractSections.includes('appendix')) {
        warnings.push('This appears to be an appendix document');
    }

    // Step 4: Extract sections based on document type and requested sections
    const shouldExtractAll = extractSections.includes('all');
    const result = {
        success: true,
        document_type: documentType,
        title: title,
        author: extractAuthor(pdfText),
        date: extractDate(pdfText),
        summary: '',
        sections: {},
        warnings: warnings,
        metadata: {
            page_count: pageCount,
            word_count: countWords(pdfText),
            has_tables: detectTables(pdfText),
            has_images: false, // Cannot reliably detect in text extraction
            extraction_confidence: 'medium',
            source_url: url
        },
        // Democratic data integrity metadata
        data_classification: 'official_record',
        is_official_record: true,
        source: {
            system: 'ModernGov',
            council: councilInfo.council || 'Unknown Council',
            url: url,
            council_verified: councilInfo.isKnownCouncil
        },
        // Sections that MUST be quoted verbatim when presenting to users
        official_sections: [
            'recommendations',
            'decisions',
            'resolutions',
            'legal_implications',
            'financial_implications',
            'motion_text',
            'amendment_text',
            'amended_motion',
            'full_text'
        ],
        // Sections that may be summarized
        summarizable_sections: [
            'reason_for_report',
            'background',
            'risk_assessment'
        ],
        content_guidance: {
            note: 'When presenting content from official_sections, quote verbatim using blockquotes. Provide plain English explanations separately. Always include source_url link.',
            format_example: 'Official Record: "[exact quote]" | In Plain English: [your explanation] | Source: [link]'
        }
    };

    // Extract based on document type
    let confidenceAssessment;
    if (documentType === 'committee_report') {
        result.sections = extractReportSections(pdfText, extractSections, shouldExtractAll, maxItems);
        confidenceAssessment = assessConfidence(result.sections, 'committee_report');
        result.summary = generateReportSummary(title, result.sections);
    } else if (documentType === 'questions') {
        result.questions = extractQuestions(pdfText, maxItems);
        confidenceAssessment = assessConfidence({ questions: result.questions }, 'questions');
        result.summary = generateQuestionsSummary(result.questions);
    } else if (documentType === 'motion') {
        result.motion = extractMotion(pdfText);
        confidenceAssessment = assessConfidence({ motion_text: result.motion?.motion_text }, 'motion');
        result.summary = generateMotionSummary(result.motion);
    } else if (documentType === 'amendment') {
        result.amendment = extractAmendment(pdfText);
        confidenceAssessment = assessConfidence({
            amendment_text: result.amendment?.amendment_text,
            amended_motion: result.amendment?.amended_motion,
            full_text: result.amendment?.full_text
        }, 'amendment');
        result.summary = generateAmendmentSummary(result.amendment);
    } else {
        // Unknown type - try to extract any recognizable sections
        result.sections = extractReportSections(pdfText, extractSections, true, maxItems);
        result.questions = extractQuestions(pdfText, maxItems);
        result.motion = extractMotion(pdfText);
        result.amendment = extractAmendment(pdfText);
        confidenceAssessment = assessConfidence(result.sections, 'unknown');
        result.summary = 'Document type could not be determined. Attempted to extract available sections.';
        warnings.push('Could not reliably determine document type');
    }

    // Store detailed confidence information
    result.metadata.extraction_confidence = confidenceAssessment.overall;
    result.metadata.confidence_score = confidenceAssessment.score;
    result.metadata.confidence_details = confidenceAssessment.details;
    result.metadata.section_confidence = confidenceAssessment.sections;

    // Add warnings for missing expected sections
    if (documentType === 'committee_report') {
        if (!result.sections.reason_for_report) {
            warnings.push("Could not locate 'Reason for Report' section");
        }
        if (!result.sections.recommendations || result.sections.recommendations.length === 0) {
            warnings.push("Could not locate 'Recommendations' section");
        }
    }

    result.warnings = warnings;
    return result;
}

/**
 * Detect the type of document based on content patterns
 */
function detectDocumentType(text) {
    const lowerText = text.toLowerCase();

    // Check for committee report indicators
    const hasReasonForReport = /reason for report|purpose of report/i.test(text);
    const hasRecommendations = /recommendations?\s*:?\s*\n/i.test(text);
    const hasNumberedRecommendations = /\d+\.\s+that\s+(?:cabinet|council|committee)/i.test(text);

    // Check for questions indicators
    const questionMatches = text.match(/question\s*\d+/gi) || [];
    const hasQuestionPattern = questionMatches.length >= 2;
    const hasPublicQuestionTime = /public question time/i.test(text);
    const hasQuestionFrom = /question from/i.test(text);

    // Check for motion indicators
    const hasNoticeOfMotion = /notice of motion/i.test(text);
    const hasThisCouncil = (text.match(/this council/gi) || []).length >= 2;
    const hasProposedBy = /proposed by councillor/i.test(text);

    // Check for amendment indicators
    const hasAmendmentHeader = AMENDMENT_PATTERNS.amendmentHeader.test(text);
    const hasAmendmentTo = AMENDMENT_PATTERNS.amendmentTo.test(text);
    const hasThatMotionBeAmended = AMENDMENT_PATTERNS.thatMotionBeAmended.test(text);
    const hasDeleteInsert = AMENDMENT_PATTERNS.deleteInsert.test(text);
    const amendmentMentions = (text.match(/\bamendment\b/gi) || []).length;

    // Score each type
    let reportScore = 0;
    let questionScore = 0;
    let motionScore = 0;
    let amendmentScore = 0;

    if (hasReasonForReport) reportScore += 3;
    if (hasRecommendations) reportScore += 2;
    if (hasNumberedRecommendations) reportScore += 3;

    if (hasQuestionPattern) questionScore += 3;
    if (hasPublicQuestionTime) questionScore += 3;
    if (hasQuestionFrom) questionScore += 2;

    if (hasNoticeOfMotion) motionScore += 4;
    if (hasThisCouncil) motionScore += 2;
    if (hasProposedBy) motionScore += 2;

    // Amendment scoring
    if (hasAmendmentHeader) amendmentScore += 4;
    if (hasAmendmentTo) amendmentScore += 3;
    if (hasThatMotionBeAmended) amendmentScore += 3;
    if (hasDeleteInsert) amendmentScore += 2;
    if (amendmentMentions >= 2) amendmentScore += 2;

    // Return highest scoring type (amendment takes priority if it's clearly an amendment)
    if (amendmentScore >= 4 && amendmentScore >= motionScore) {
        return 'amendment';
    }
    if (reportScore >= questionScore && reportScore >= motionScore && reportScore > 0) {
        return 'committee_report';
    }
    if (questionScore >= reportScore && questionScore >= motionScore && questionScore > 0) {
        return 'questions';
    }
    if (motionScore > 0) {
        return 'motion';
    }

    return 'unknown';
}

/**
 * Extract the document title
 */
function extractTitle(text) {
    const lines = text.split('\n').filter(line => line.trim());

    // Look for title patterns
    for (let i = 0; i < Math.min(20, lines.length); i++) {
        const line = lines[i].trim();

        // Skip very short lines or committee names
        if (line.length < 5 || line.length > 200) continue;
        if (/^(cabinet|council|committee|meeting)/i.test(line)) continue;
        if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(line)) continue; // Skip dates
        if (/^page\s+\d+/i.test(line)) continue;

        // Look for "Title:" or "Subject:" prefix
        const titleMatch = line.match(/^(?:title|subject|report)\s*:\s*(.+)/i);
        if (titleMatch) {
            return titleMatch[1].trim();
        }

        // If line is in title case or all caps and reasonable length, it might be title
        if (line.length >= 10 && line.length <= 150) {
            const isAllCaps = line === line.toUpperCase() && /[A-Z]/.test(line);
            if (isAllCaps) {
                return toTitleCase(line);
            }
        }
    }

    // Fallback: use first substantial line
    for (const line of lines.slice(0, 10)) {
        if (line.trim().length >= 10 && line.trim().length <= 150) {
            return line.trim();
        }
    }

    return 'Untitled Document';
}

/**
 * Extract the author/officer name
 */
function extractAuthor(text) {
    const patterns = [
        /(?:author|report by|prepared by|officer)\s*:\s*([^\n]+)/i,
        /(?:managing director|chief executive|head of|director of)\s*[,:\-]?\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return match[1].trim();
        }
    }

    return null;
}

/**
 * Extract the document date
 */
function extractDate(text) {
    // Look for date patterns
    const patterns = [
        /(?:date|meeting date|publication date)\s*:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
        /(?:date|meeting date|publication date)\s*:\s*(\d{1,2}\s+\w+\s+\d{4})/i,
        /(\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return match[1].trim();
        }
    }

    return null;
}

/**
 * Check if document is an appendix
 */
function isAppendix(title) {
    if (!title) return false;
    return /appendix\s*[a-z0-9]/i.test(title);
}

/**
 * Extract sections from a committee report
 */
function extractReportSections(text, requestedSections, extractAll, maxItems) {
    const sections = {};
    const lines = text.split('\n');

    // Build a map of section start/end positions
    const sectionPositions = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        for (const [sectionType, pattern] of Object.entries(SECTION_PATTERNS)) {
            if (pattern.test(line)) {
                sectionPositions.push({
                    type: sectionType,
                    line: i,
                    header: line
                });
                break;
            }
        }

        // Also check for numbered section headers (1.0, 2.0, etc.)
        const numberedMatch = line.match(/^(\d+\.?\d*)\s+(.+)/);
        if (numberedMatch) {
            const sectionTitle = numberedMatch[2].toLowerCase();
            for (const [sectionType, pattern] of Object.entries(SECTION_PATTERNS)) {
                // Create a simpler pattern for numbered sections
                const simplePattern = pattern.source.replace(/\^\(/g, '(').replace(/\)\s*:\?\s*\$/, ')');
                if (new RegExp(simplePattern, 'i').test(sectionTitle)) {
                    sectionPositions.push({
                        type: sectionType,
                        line: i,
                        header: line
                    });
                    break;
                }
            }
        }
    }

    // Extract content for each section
    for (let i = 0; i < sectionPositions.length; i++) {
        const section = sectionPositions[i];
        const nextSection = sectionPositions[i + 1];

        const shouldExtract = extractAll ||
            requestedSections.includes(section.type) ||
            (section.type === 'reason' && requestedSections.includes('reasons')) ||
            (section.type === 'recommendations' && requestedSections.includes('recommendations'));

        if (!shouldExtract) continue;

        const startLine = section.line + 1;
        const endLine = nextSection ? nextSection.line : Math.min(startLine + 100, lines.length);

        let content = lines.slice(startLine, endLine)
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .join('\n')
            .trim();

        // Clean up the content
        content = cleanText(content);

        // Map section types to output keys
        const keyMap = {
            reason: 'reason_for_report',
            recommendations: 'recommendations',
            financial: 'financial_implications',
            legal: 'legal_implications',
            risk: 'risk_assessment',
            background: 'background'
        };

        const outputKey = keyMap[section.type] || section.type;

        // Special handling for recommendations - parse as list
        if (section.type === 'recommendations') {
            sections[outputKey] = parseRecommendations(content, maxItems);
        } else {
            sections[outputKey] = content || null;
        }
    }

    // If no recommendations found via headers, try to find them inline
    if (!sections.recommendations || sections.recommendations.length === 0) {
        sections.recommendations = findInlineRecommendations(text, maxItems);
    }

    return sections;
}

/**
 * Parse recommendations from text into a list
 */
function parseRecommendations(text, maxItems) {
    const recommendations = [];

    // Split by numbered items
    const pattern = /(?:^|\n)\s*(\d+\.?\d*)\s*[.\)]\s*/;
    const parts = text.split(pattern);

    let currentRec = '';
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();

        // Skip empty parts
        if (!part) continue;

        // Check if this is a number
        if (/^\d+\.?\d*$/.test(part)) {
            // Save previous recommendation
            if (currentRec) {
                recommendations.push(cleanRecommendation(currentRec));
            }
            currentRec = part + '. ';
        } else {
            currentRec += part + ' ';
        }
    }

    // Don't forget the last one
    if (currentRec.trim()) {
        recommendations.push(cleanRecommendation(currentRec));
    }

    // If no numbered items found, try to split by "That" statements
    if (recommendations.length === 0) {
        const thatMatches = text.match(/that\s+(?:cabinet|council|committee|the)[^.]+\./gi);
        if (thatMatches) {
            for (let i = 0; i < Math.min(thatMatches.length, maxItems); i++) {
                recommendations.push((i + 1) + '. ' + thatMatches[i].trim());
            }
        }
    }

    return recommendations.slice(0, maxItems);
}

/**
 * Find recommendations inline in the text
 */
function findInlineRecommendations(text, maxItems) {
    const recommendations = [];

    // Look for "RESOLVED" or "RECOMMENDED" sections
    const resolvedMatch = text.match(/(?:resolved|recommended)\s*:?\s*\n([\s\S]*?)(?:\n\s*\n|\n[A-Z]{2,})/i);
    if (resolvedMatch) {
        return parseRecommendations(resolvedMatch[1], maxItems);
    }

    // Look for numbered "That" statements
    const pattern = /(\d+)\.\s*(that\s+(?:cabinet|council|committee|the)[^.]+\.)/gi;
    let match;
    while ((match = pattern.exec(text)) !== null && recommendations.length < maxItems) {
        recommendations.push(match[1] + '. ' + match[2].trim());
    }

    return recommendations;
}

/**
 * Clean up a recommendation string
 */
function cleanRecommendation(text) {
    return text
        .replace(/\s+/g, ' ')
        .replace(/^\d+\.\s*/, (m) => m) // Keep the number
        .trim();
}

/**
 * Extract questions from a questions document
 */
function extractQuestions(text, maxItems) {
    const questions = [];
    const lines = text.split('\n');

    let currentQuestion = null;
    let inAnswer = false;
    let buffer = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Check for new question
        const questionNumMatch = line.match(QUESTION_PATTERNS.questionNumber);
        const questionFromMatch = line.match(QUESTION_PATTERNS.questionFrom);

        if (questionNumMatch || questionFromMatch) {
            // Save previous question
            if (currentQuestion) {
                if (inAnswer) {
                    currentQuestion.answer = cleanText(buffer.join('\n'));
                } else {
                    currentQuestion.question = cleanText(buffer.join('\n'));
                }
                questions.push(currentQuestion);
            }

            // Start new question
            const num = questionNumMatch ?
                parseInt(questionNumMatch[1] || questionNumMatch[2], 10) :
                questions.length + 1;

            currentQuestion = {
                number: num,
                from: questionFromMatch ? questionFromMatch[1].trim() : 'Member of Public',
                question: '',
                answer: '',
                supplementary: null
            };
            buffer = [];
            inAnswer = false;
            continue;
        }

        // Check for answer section
        if (QUESTION_PATTERNS.answer.test(line)) {
            if (currentQuestion) {
                currentQuestion.question = cleanText(buffer.join('\n'));
                buffer = [];
                inAnswer = true;
            }
            continue;
        }

        // Check for "From:" line
        const fromMatch = line.match(/^from\s*:\s*(.+)/i);
        if (fromMatch && currentQuestion) {
            currentQuestion.from = fromMatch[1].trim();
            continue;
        }

        // Check for supplementary
        if (/^supplementary/i.test(line) && currentQuestion) {
            if (inAnswer) {
                currentQuestion.answer = cleanText(buffer.join('\n'));
            }
            buffer = [];
            // Mark that we're now in supplementary
            continue;
        }

        // Add line to buffer
        buffer.push(line);
    }

    // Save last question
    if (currentQuestion) {
        if (inAnswer) {
            currentQuestion.answer = cleanText(buffer.join('\n'));
        } else {
            currentQuestion.question = cleanText(buffer.join('\n'));
        }
        questions.push(currentQuestion);
    }

    return questions.slice(0, maxItems);
}

/**
 * Extract motion details
 */
function extractMotion(text) {
    const motion = {
        title: null,
        proposer: null,
        seconder: null,
        motion_text: null,
        background: null
    };

    const lines = text.split('\n');

    // Find proposer and seconder
    for (const line of lines) {
        const trimmedLine = line.trim();

        const proposerMatch = trimmedLine.match(MOTION_PATTERNS.proposer);
        if (proposerMatch) {
            motion.proposer = proposerMatch[1].trim();
        }

        const seconderMatch = trimmedLine.match(MOTION_PATTERNS.seconder);
        if (seconderMatch) {
            motion.seconder = seconderMatch[1].trim();
        }
    }

    // Find motion text (starts with "This Council")
    const thisCouncilIndex = text.search(/this council/i);
    if (thisCouncilIndex !== -1) {
        // Extract from "This Council" to end or next major section
        let motionText = text.substring(thisCouncilIndex);

        // Try to find where the motion ends
        const endPatterns = [
            /\n\s*(?:background|reason|note|appendix)/i,
            /\n\s*(?:proposed by|seconded by)/i,
            /\n{3,}/
        ];

        for (const pattern of endPatterns) {
            const match = motionText.match(pattern);
            if (match) {
                motionText = motionText.substring(0, match.index);
                break;
            }
        }

        motion.motion_text = cleanText(motionText);
    }

    // Find title (often after "Notice of Motion:")
    const titleMatch = text.match(/notice of motion\s*[:–-]?\s*([^\n]+)/i);
    if (titleMatch) {
        motion.title = titleMatch[1].trim();
    }

    // Try to extract background (before "This Council")
    if (thisCouncilIndex > 0) {
        const beforeMotion = text.substring(0, thisCouncilIndex);
        const backgroundStart = beforeMotion.search(/(?:background|context|reason)/i);
        if (backgroundStart !== -1) {
            motion.background = cleanText(beforeMotion.substring(backgroundStart));
        }
    }

    return motion;
}

/**
 * Extract amendment details from document
 */
function extractAmendment(text) {
    const amendment = {
        title: null,
        proposer: null,
        seconder: null,
        original_text: null,
        amendment_text: null,
        amended_motion: null,
        amendment_type: null, // 'delete', 'insert', 'substitute', 'add'
        target: null, // what the amendment applies to (motion, recommendation, etc.)
        full_text: null // fallback: full document text when specific extraction fails
    };

    const lines = text.split('\n');

    // Find proposer and seconder - check for various formats
    for (const line of lines) {
        const trimmedLine = line.trim();

        // Standard patterns
        const proposerMatch = trimmedLine.match(AMENDMENT_PATTERNS.amendmentProposed);
        if (proposerMatch && !amendment.proposer) {
            amendment.proposer = proposerMatch[1].trim();
        }

        const seconderMatch = trimmedLine.match(AMENDMENT_PATTERNS.amendmentSeconded);
        if (seconderMatch && !amendment.seconder) {
            amendment.seconder = seconderMatch[1].trim();
        }

        // Additional patterns: "Councillor [Name]" on its own line, or "Cllr [Name]"
        if (!amendment.proposer) {
            const councillorMatch = trimmedLine.match(/^(?:councillor|cllr\.?)\s+([A-Z][a-zA-Z\-']+(?:\s+[A-Z][a-zA-Z\-']+)?)/i);
            if (councillorMatch) {
                amendment.proposer = councillorMatch[1].trim();
            }
        }
    }

    // Determine amendment type
    if (/\bdelete\b/i.test(text)) {
        amendment.amendment_type = 'delete';
    } else if (/\binsert\b/i.test(text)) {
        amendment.amendment_type = 'insert';
    } else if (/\bsubstitute\b/i.test(text)) {
        amendment.amendment_type = 'substitute';
    } else if (/\badd(?:itional)?\b/i.test(text)) {
        amendment.amendment_type = 'add';
    }

    // Determine what the amendment targets
    if (/amendment\s+to\s+(?:the\s+)?motion/i.test(text)) {
        amendment.target = 'motion';
    } else if (/amendment\s+to\s+(?:the\s+)?recommendation/i.test(text)) {
        amendment.target = 'recommendation';
    } else if (/amendment\s+to\s+(?:the\s+)?resolution/i.test(text)) {
        amendment.target = 'resolution';
    }

    // Find title - check multiple patterns
    // Pattern 1: "Amendment:" or "Amendment to:"
    let titleMatch = text.match(/amendment\s*(?:to)?\s*[:–-]?\s*([^\n]+)/i);
    if (titleMatch) {
        amendment.title = titleMatch[1].trim();
    }

    // Pattern 2: "ITEM X" header format (common in GCC documents)
    if (!amendment.title || amendment.title.length < 10) {
        const itemMatch = text.match(/^(ITEM\s+\d+[A-Z]?\s*[-–:]?\s*[^\n]+)/im);
        if (itemMatch) {
            amendment.title = itemMatch[1].trim();
        }
    }

    // Try to extract the amendment text using multiple strategies
    let extractedText = null;

    // Strategy 1: Look for "That the motion be amended to read:" or similar
    const amendedToReadMatch = text.match(/(?:be\s+amended\s+to\s+read|amended\s+(?:motion|text|recommendation)\s*:)\s*([\s\S]*?)(?:\n\s*\n|$)/i);
    if (amendedToReadMatch) {
        extractedText = amendedToReadMatch[1];
    }

    // Strategy 2: Try to find delete/insert pattern
    if (!extractedText) {
        const deleteInsertMatch = text.match(/delete\s+(?:the\s+words?\s+)?["']?([^"'\n]+)["']?\s+and\s+insert\s+(?:the\s+words?\s+)?["']?([^"'\n]+)["']?/i);
        if (deleteInsertMatch) {
            amendment.original_text = deleteInsertMatch[1].trim();
            extractedText = deleteInsertMatch[2].trim();
            amendment.amendment_type = 'substitute';
        }
    }

    // Strategy 3: Look for "amended motion" or "if amended...would read"
    if (!extractedText) {
        const amendedMotionMatch = text.match(/(?:amended\s+motion|if\s+amended.*would\s+read)\s*:?\s*([\s\S]*?)(?:\n\s*\n|proposed\s+by|seconded\s+by|$)/i);
        if (amendedMotionMatch) {
            amendment.amended_motion = cleanText(amendedMotionMatch[1]);
        }
    }

    // Strategy 4: Extract from "This Council" statement
    if (!extractedText && !amendment.amended_motion) {
        const thisCouncilIndex = text.search(/this council/i);
        if (thisCouncilIndex !== -1) {
            let motionText = text.substring(thisCouncilIndex);
            const endPatterns = [
                /\n\s*(?:proposed by|seconded by)/i,
                /\n{3,}/
            ];
            for (const pattern of endPatterns) {
                const match = motionText.match(pattern);
                if (match) {
                    motionText = motionText.substring(0, match.index);
                    break;
                }
            }
            amendment.amended_motion = cleanText(motionText);
        }
    }

    // Strategy 5: GCC-specific format - extract body after header/title
    // For short documents (< 500 words), extract the main body text
    if (!extractedText && !amendment.amended_motion) {
        const wordCount = text.split(/\s+/).length;
        if (wordCount < 500) {
            extractedText = extractAmendmentBody(text, amendment.title);
        }
    }

    // Strategy 6: Final fallback - capture substantial text blocks
    // Look for numbered points, "That" statements, or paragraph blocks
    if (!extractedText && !amendment.amended_motion) {
        // Look for numbered items (1., 2., a., b., etc.)
        const numberedMatch = text.match(/(?:^|\n)\s*(?:\d+\.|[a-z]\)|\([a-z]\))\s*([\s\S]+?)(?=\n\s*(?:\d+\.|[a-z]\)|\([a-z]\)|$))/i);
        if (numberedMatch) {
            // Extract all numbered/lettered items
            const numberedItems = text.match(/(?:^|\n)\s*(?:\d+\.|[a-z]\)|\([a-z]\))\s*[^\n]+/gi);
            if (numberedItems && numberedItems.length > 0) {
                extractedText = numberedItems.join('\n');
            }
        }

        // Look for "That" statements (common in amendments)
        if (!extractedText) {
            const thatMatch = text.match(/\bthat\s+(?:the\s+)?(?:council|cabinet|committee|recommendation|motion)[\s\S]+?(?:\.|$)/gi);
            if (thatMatch && thatMatch.length > 0) {
                extractedText = thatMatch.join('\n\n');
            }
        }
    }

    // Apply extracted text to appropriate field
    if (extractedText) {
        amendment.amendment_text = cleanText(extractedText);
    }

    // Always provide full_text for transparency when specific extraction may have missed content
    // This helps with short documents where patterns don't match
    const cleanedFullText = cleanText(text);
    if (cleanedFullText && cleanedFullText.length > 50) {
        // Only include if we didn't extract meaningful content
        if (!amendment.amendment_text && !amendment.amended_motion) {
            amendment.full_text = cleanedFullText;
        } else if (amendment.amendment_text && amendment.amendment_text.length < cleanedFullText.length * 0.3) {
            // If extracted text is less than 30% of full text, include full text for reference
            amendment.full_text = cleanedFullText;
        }
    }

    return amendment;
}

/**
 * Extract the main body text from a GCC amendment document
 * Handles formats like "[Group] Amendment" header followed by "ITEM X" and content
 */
function extractAmendmentBody(text, title) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Skip header lines (group name, "Amendment", title/ITEM header)
    let startIndex = 0;
    const skipPatterns = [
        /^(?:independent|conservative|labour|liberal democrat|green)\s+(?:group\s+)?amendment$/i,
        /^amendment$/i,
        /^ITEM\s+\d+/i,
        /^[A-Z\s\-–:]+$/, // ALL CAPS headers
        /^page\s+\d+/i,
        /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/ // dates
    ];

    for (let i = 0; i < lines.length && i < 10; i++) {
        let shouldSkip = false;
        for (const pattern of skipPatterns) {
            if (pattern.test(lines[i])) {
                shouldSkip = true;
                startIndex = i + 1;
                break;
            }
        }
        // Also skip if line matches the title
        if (!shouldSkip && title && lines[i].toLowerCase().includes(title.toLowerCase().substring(0, 20))) {
            startIndex = i + 1;
        }
    }

    // Extract remaining content
    const bodyLines = lines.slice(startIndex);
    if (bodyLines.length > 0) {
        return bodyLines.join('\n');
    }

    return null;
}

/**
 * Clean extracted text
 */
function cleanText(text) {
    if (!text) return null;

    return text
        // Remove page numbers and footers
        .replace(/\n\s*page\s+\d+\s*(?:of\s+\d+)?\s*\n/gi, '\n')
        // Fix broken hyphenation
        .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
        // Normalize whitespace
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        // Trim
        .trim();
}

/**
 * Convert string to title case
 */
function toTitleCase(str) {
    return str.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Count words in text
 */
function countWords(text) {
    return text.split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Detect if document contains tables
 */
function detectTables(text) {
    // Simple heuristic: multiple lines with consistent column separators
    const lines = text.split('\n');
    let tabLines = 0;
    let pipeLines = 0;

    for (const line of lines) {
        if ((line.match(/\t/g) || []).length >= 2) tabLines++;
        if ((line.match(/\|/g) || []).length >= 2) pipeLines++;
    }

    return tabLines >= 3 || pipeLines >= 3;
}

/**
 * Assess extraction confidence with detailed per-section analysis
 * @param {object} sections - Extracted sections
 * @param {string} documentType - Type of document
 * @returns {object} - { overall: string, sections: object, details: string }
 */
function assessConfidence(sections, documentType = 'committee_report') {
    const sectionConfidence = {};
    let totalScore = 0;
    let totalWeight = 0;

    // Define expected sections by document type with weights
    const expectedSections = {
        committee_report: {
            reason_for_report: { weight: 3, minLength: 50 },
            recommendations: { weight: 4, minLength: 20, checkArray: true },
            financial_implications: { weight: 2, minLength: 20 },
            legal_implications: { weight: 2, minLength: 20 },
            risk_assessment: { weight: 1, minLength: 20 },
            background: { weight: 1, minLength: 30 }
        },
        questions: {
            questions: { weight: 5, checkArray: true }
        },
        motion: {
            motion_text: { weight: 5, minLength: 30 }
        },
        amendment: {
            amendment_text: { weight: 4, minLength: 20 },
            amended_motion: { weight: 3, minLength: 30 },
            full_text: { weight: 2, minLength: 50 } // fallback when specific extraction fails
        }
    };

    const expected = expectedSections[documentType] || expectedSections.committee_report;

    // Assess each expected section
    for (const [sectionKey, criteria] of Object.entries(expected)) {
        const section = sections[sectionKey];
        let confidence = 'missing';
        let score = 0;

        if (section) {
            if (criteria.checkArray && Array.isArray(section)) {
                // Array-based sections (e.g., recommendations, questions)
                const itemCount = section.length;
                if (itemCount > 0) {
                    // Check quality of items
                    const hasDetailedItems = section.some(item => {
                        const text = typeof item === 'string' ? item : (item.text || item.question || '');
                        return text.length > 30;
                    });

                    if (hasDetailedItems) {
                        confidence = 'high';
                        score = 1.0;
                    } else if (itemCount >= 3) {
                        confidence = 'medium';
                        score = 0.7;
                    } else {
                        confidence = 'low';
                        score = 0.4;
                    }
                }
            } else if (typeof section === 'string') {
                // Text-based sections
                const length = section.trim().length;
                const minLength = criteria.minLength || 20;

                if (length >= minLength * 3) {
                    confidence = 'high';
                    score = 1.0;
                } else if (length >= minLength) {
                    confidence = 'medium';
                    score = 0.7;
                } else if (length > 0) {
                    confidence = 'low';
                    score = 0.3;
                }
            } else if (typeof section === 'object' && section !== null) {
                // Object-based sections (e.g., motion)
                const hasContent = Object.keys(section).some(key => {
                    const value = section[key];
                    return value && (typeof value === 'string' ? value.length > 10 : true);
                });

                if (hasContent) {
                    confidence = 'high';
                    score = 1.0;
                } else {
                    confidence = 'low';
                    score = 0.3;
                }
            }
        }

        sectionConfidence[sectionKey] = {
            status: confidence,
            score: score,
            weight: criteria.weight
        };

        totalScore += score * criteria.weight;
        totalWeight += criteria.weight;
    }

    // Calculate overall confidence
    const overallRatio = totalWeight > 0 ? totalScore / totalWeight : 0;
    let overall;
    let details;

    if (overallRatio >= 0.75) {
        overall = 'high';
        details = 'Most expected sections extracted with good content quality';
    } else if (overallRatio >= 0.5) {
        overall = 'medium';
        details = 'Some key sections extracted; content may be partial or incomplete';
    } else if (overallRatio > 0) {
        overall = 'low';
        details = 'Limited content extracted; document structure may not match expected format';
    } else {
        overall = 'none';
        details = 'No expected sections could be extracted from document';
    }

    // Count extracted vs expected
    const extractedCount = Object.values(sectionConfidence).filter(s => s.status !== 'missing').length;
    const expectedCount = Object.keys(expected).length;

    return {
        overall,
        details: `${details} (${extractedCount}/${expectedCount} sections)`,
        score: Math.round(overallRatio * 100),
        sections: sectionConfidence
    };
}

/**
 * Generate summary for committee report
 */
function generateReportSummary(title, sections) {
    const parts = [];

    if (title && title !== 'Untitled Document') {
        parts.push(`Report on "${title}".`);
    }

    if (sections.reason_for_report) {
        // Take first sentence or first 150 chars
        const reason = sections.reason_for_report;
        const firstSentence = reason.match(/^[^.]+\./);
        if (firstSentence && firstSentence[0].length <= 200) {
            parts.push(firstSentence[0]);
        } else {
            parts.push(reason.substring(0, 150).trim() + '...');
        }
    }

    if (sections.recommendations && sections.recommendations.length > 0) {
        parts.push(`Contains ${sections.recommendations.length} recommendation(s).`);
    }

    return parts.join(' ') || 'Committee report with extractable sections.';
}

/**
 * Generate summary for questions document
 */
function generateQuestionsSummary(questions) {
    if (!questions || questions.length === 0) {
        return 'Questions document - no questions could be extracted.';
    }

    const fromPublic = questions.filter(q =>
        q.from.toLowerCase().includes('public') ||
        q.from.toLowerCase().includes('member of public')
    ).length;

    const fromCouncillors = questions.length - fromPublic;

    const parts = [`${questions.length} question(s) extracted.`];

    if (fromPublic > 0) {
        parts.push(`${fromPublic} from members of the public.`);
    }
    if (fromCouncillors > 0) {
        parts.push(`${fromCouncillors} from councillors.`);
    }

    return parts.join(' ');
}

/**
 * Generate summary for motion
 */
function generateMotionSummary(motion) {
    const parts = [];

    if (motion.title) {
        parts.push(`Motion: "${motion.title}".`);
    }

    if (motion.proposer) {
        parts.push(`Proposed by ${motion.proposer}.`);
    }

    if (motion.motion_text) {
        // Count "resolves" clauses
        const resolves = (motion.motion_text.match(/resolves? to/gi) || []).length;
        if (resolves > 0) {
            parts.push(`Contains ${resolves} resolution(s).`);
        }
    }

    return parts.join(' ') || 'Motion document.';
}

/**
 * Generate summary for amendment
 */
function generateAmendmentSummary(amendment) {
    const parts = [];

    if (amendment.title) {
        parts.push(`Amendment: "${amendment.title}".`);
    } else if (amendment.target) {
        parts.push(`Amendment to ${amendment.target}.`);
    } else {
        parts.push('Amendment document.');
    }

    if (amendment.proposer) {
        parts.push(`Proposed by ${amendment.proposer}.`);
    }

    if (amendment.amendment_type) {
        parts.push(`Type: ${amendment.amendment_type}.`);
    }

    // Report which content fields have data
    if (amendment.amendment_text) {
        const wordCount = amendment.amendment_text.split(/\s+/).length;
        parts.push(`Amendment text: ${wordCount} words.`);
    }

    if (amendment.amended_motion) {
        const wordCount = amendment.amended_motion.split(/\s+/).length;
        parts.push(`Amended motion: ${wordCount} words.`);
    }

    // Note if full_text fallback was used
    if (amendment.full_text && !amendment.amendment_text && !amendment.amended_motion) {
        const wordCount = amendment.full_text.split(/\s+/).length;
        parts.push(`Full document text available (${wordCount} words).`);
    }

    return parts.join(' ') || 'Amendment document.';
}

module.exports = { analyzeMeetingDocument };
