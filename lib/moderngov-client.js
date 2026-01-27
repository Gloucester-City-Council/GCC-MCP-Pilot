/**
 * ModernGov SOAP Client
 * Implements SOAP API calls to Gloucestershire councils' ModernGov systems
 */

const axios = require('axios');
const xml2js = require('xml2js');
const councilConfig = require('./council-config');

const SOAP_NAMESPACE = 'http://moderngov.co.uk/namespaces';

class ModernGovClient {
    constructor() {
        this.parser = new xml2js.Parser({
            explicitArray: false,
            ignoreAttrs: false,
            tagNameProcessors: [xml2js.processors.stripPrefix]
        });
    }

    /**
     * Get the endpoint for a specific council
     * @param {string} councilName - Council name
     * @returns {string} Endpoint URL
     */
    _getEndpoint(councilName) {
        const endpoint = councilConfig.getEndpoint(councilName);
        if (!endpoint) {
            throw new Error(`Unknown council: ${councilName}. Available councils: ${councilConfig.getCouncilNames().join(', ')}`);
        }
        return endpoint;
    }

    /**
     * Get all committees for a council
     * @param {string} councilName - Council name
     */
    async getCommittees(councilName) {
        const parsed = await this._callSoap('GetCommittees', '', councilName);

        // Extract committees from SOAP response
        const envelope = parsed['soap:Envelope'] || parsed['Envelope'];
        const body = envelope['soap:Body'] || envelope['Body'];
        const response = body['GetCommitteesResponse'];
        const result = response['GetCommitteesResult'];

        // Parse committees
        const committeesData = result['committees'];
        const committeeArray = committeesData['committee'];

        // Ensure it's always an array
        const committees = Array.isArray(committeeArray) ? committeeArray : [committeeArray];

        return committees.map(c => ({
            id: parseInt(c.committeeid, 10),
            name: c.committeetitle,
            deleted: c.committeedeleted === 'True',
            expired: c.committeeexpired === 'True',
            category: c.committeecategory || null
        }));
    }

    /**
     * Get all councillors organized by ward for a council
     * @param {string} councilName - Council name
     */
    async getCouncillorsByWard(councilName) {
        const parsed = await this._callSoap('GetCouncillorsByWard', '', councilName);

        // Extract councillors from SOAP response
        const envelope = parsed['soap:Envelope'] || parsed['Envelope'];
        const body = envelope['soap:Body'] || envelope['Body'];
        const response = body['GetCouncillorsByWardResponse'];
        const result = response['GetCouncillorsByWardResult'];

        // Parse wards
        const councillorsByWard = result['councillorsbyward'];
        const wardsData = councillorsByWard['wards'];
        const wardArray = wardsData['ward'];

        // Ensure it's always an array
        const wards = Array.isArray(wardArray) ? wardArray : [wardArray];

        return {
            wards: wards.map(ward => ({
                ward_name: ward.wardtitle,
                councillors: this._parseCouncillors(ward.councillors)
            }))
        };
    }

    /**
     * Get councillors for a specific ward by ward ID
     *
     * @param {string} councilName - Council name
     * @param {number} wardId - Ward ID
     */
    async getCouncillorsByWardId(councilName, wardId) {
        const bodyContent = `<lWardId>${wardId}</lWardId>`;
        const parsed = await this._callSoap('GetCouncillorsByWardId', bodyContent, councilName);

        // Extract councillors from SOAP response
        const envelope = parsed['soap:Envelope'] || parsed['Envelope'];
        const body = envelope['soap:Body'] || envelope['Body'];
        const response = body['GetCouncillorsByWardIdResponse'];
        const result = response['GetCouncillorsByWardIdResult'];

        // Parse councillors
        const councillorsData = result['councillorsbyward'];
        const wardsData = councillorsData['wards'];
        const ward = wardsData['ward'];

        return {
            ward_name: ward.wardtitle,
            councillors: this._parseCouncillors(ward.councillors)
        };
    }

    /**
     * Get meetings for a committee
     *
     * @param {string} councilName - Council name
     * @param {number} committeeId - Committee ID
     * @param {string} fromDate - Start date in DD/MM/YYYY format (optional)
     * @param {string} toDate - End date in DD/MM/YYYY format (optional)
     */
    async getMeetings(councilName, committeeId, fromDate, toDate) {
        let bodyContent = `<lCommitteeId>${committeeId}</lCommitteeId>`;
        if (fromDate) {
            bodyContent += `<sFromDate>${fromDate}</sFromDate>`;
        }
        if (toDate) {
            bodyContent += `<sToDate>${toDate}</sToDate>`;
        }

        const parsed = await this._callSoap('GetMeetings', bodyContent, councilName);

        // Extract meetings from SOAP response
        const envelope = parsed['soap:Envelope'] || parsed['Envelope'];
        const body = envelope['soap:Body'] || envelope['Body'];
        const response = body['GetMeetingsResponse'];
        const result = response['GetMeetingsResult'];

        // Parse meetings
        const getMeetings = result['getmeetings'];
        const committeeData = getMeetings['committee'];

        // Handle case where there's no committee or meetings
        if (!committeeData) {
            return { meetings: [] };
        }

        const committeeMeetings = committeeData['committeemeetings'];
        if (!committeeMeetings) {
            return { meetings: [] };
        }

        const meetingArray = committeeMeetings['meeting'];

        // Ensure it's always an array
        const meetings = meetingArray ? (Array.isArray(meetingArray) ? meetingArray : [meetingArray]) : [];

        return {
            meetings: meetings.map(m => ({
                id: parseInt(m.meetingid, 10),
                date: m.meetingdate,
                time: m.meetingtime || null,
                status: m.meetingstatus || null,
                is_webcast: m.iswebcast === 'True'
            }))
        };
    }

    /**
     * Get details for a specific meeting
     *
     * @param {string} councilName - Council name
     * @param {number} meetingId - Meeting ID
     */
    async getMeeting(councilName, meetingId) {
        const bodyContent = `<lMeetingId>${meetingId}</lMeetingId>`;
        const parsed = await this._callSoap('GetMeeting', bodyContent, councilName);

        // Extract meeting details from SOAP response
        const envelope = parsed['soap:Envelope'] || parsed['Envelope'];
        const body = envelope['soap:Body'] || envelope['Body'];
        const response = body['GetMeetingResponse'];
        const result = response['GetMeetingResult'];

        const meeting = result['meeting'];

        return {
            details: {
                id: parseInt(meeting.meetingid, 10),
                date: meeting.meetingdate,
                time: meeting.meetingtime || null,
                status: meeting.meetingstatus || null,
                location: meeting.meetinglocation || null,
                actual_start_time: meeting.meetingactualstarttime || null,
                actual_finish_time: meeting.meetingactualfinishtime || null,
                planned_finish_time: meeting.meetingplannedfinishtime || null,
                is_webcast: meeting.iswebcast === 'True',
                agenda_published: meeting.agendapublished === 'True',
                minutes_published: meeting.minutepublished === 'True',
                decision_published: meeting.decisionpublished === 'True'
            },
            agenda: this._parseAgendaItems(meeting.agendaitems),
            attendees: this._parseAttendees(meeting.attendees)
        };
    }

    /**
     * Get attachment metadata
     *
     * @param {string} councilName - Council name
     * @param {number} attachmentId - Attachment ID
     */
    async getAttachment(councilName, attachmentId) {
        const bodyContent = `<lAttachmentId>${attachmentId}</lAttachmentId>`;
        const parsed = await this._callSoap('GetAttachment', bodyContent, councilName);

        // Extract attachment from SOAP response
        const envelope = parsed['soap:Envelope'] || parsed['Envelope'];
        const body = envelope['soap:Body'] || envelope['Body'];
        const response = body['GetAttachmentResponse'];
        const result = response['GetAttachmentResult'];

        const attachment = result['attachment'];
        const details = attachment['attachmentdetails'];

        return {
            attachmentid: parseInt(details.attachmentid, 10),
            title: details.title,
            url: details.url,
            isurl: details.isurl === 'True',
            isrestricted: details.isrestricted === 'True',
            publicationdate: details.publicationdate || null,
            meetingdate: details.meetingdate || null,
            decisiondate: details.decisiondate || null,
            committeetitle: details.committeetitle || null,
            ownertitle: details.ownertitle || null
        };
    }

    /**
     * Parse councillors from ward data
     * @private
     */
    _parseCouncillors(councillorsData) {
        if (!councillorsData) return [];

        const councillorArray = councillorsData['councillor'];
        if (!councillorArray) return [];

        // Ensure it's always an array
        const councillors = Array.isArray(councillorArray) ? councillorArray : [councillorArray];

        return councillors.map(c => ({
            id: parseInt(c.councillorid, 10),
            name: c.fullusername,
            party: c.politicalpartytitle || null,
            photo_small: c.photosmallurl || null,
            photo_big: c.photobigurl || null,
            key_posts: c.keyposts || null,
            work_address: this._parseAddress(c.workaddress),
            home_address: this._parseAddress(c.homeaddress),
            email: c.workaddress?.email || c.homeaddress?.email || null,
            phone: c.workaddress?.phone || c.homeaddress?.phone || null,
            mobile: c.workaddress?.mobile || c.homeaddress?.mobile || null
        }));
    }

    /**
     * Parse address data
     * @private
     */
    _parseAddress(addressData) {
        if (!addressData) return null;

        return {
            line1: addressData.line1 || null,
            line2: addressData.line2 || null,
            line3: addressData.line3 || null,
            line4: addressData.line4 || null,
            postcode: addressData.postcode || null,
            phone: addressData.phone || null,
            mobile: addressData.mobile || null,
            email: addressData.email || null
        };
    }

    /**
     * Parse agenda items from meeting data
     * @private
     */
    _parseAgendaItems(agendaItemsData) {
        if (!agendaItemsData) return [];

        const itemArray = agendaItemsData['agendaitem'];
        if (!itemArray) return [];

        // Ensure it's always an array
        const items = Array.isArray(itemArray) ? itemArray : [itemArray];

        return items.map(item => ({
            id: parseInt(item.agendaitemid, 10),
            title: item.agendaitemtitle,
            number: item.agendaitemnumber || null,
            minutes_number: item.minutesitemnumber || null,
            is_decision: item.isdecision === 'True',
            decision: item.decisionnonemptyhtmlbody || null,
            minutes: item.minutesnonemptyhtmlbody || null,
            linked_documents: this._parseLinkedDocuments(item.linkeddocuments)
        }));
    }

    /**
     * Parse linked documents from agenda item
     * @private
     */
    _parseLinkedDocuments(linkedDocsData) {
        if (!linkedDocsData) return [];

        const docArray = linkedDocsData['linkeddoc'];
        if (!docArray) return [];

        // Ensure it's always an array
        const docs = Array.isArray(docArray) ? docArray : [docArray];

        return docs.map(doc => ({
            attachmentid: parseInt(doc.attachmentid, 10),
            title: doc.title,
            url: doc.url,
            is_restricted: doc.isrestricted === 'True',
            publication_date: doc.publicationdate || null
        }));
    }

    /**
     * Parse attendees from meeting data
     * @private
     */
    _parseAttendees(attendeesData) {
        if (!attendeesData) return [];

        const attendeeArray = attendeesData['attendee'];
        if (!attendeeArray) return [];

        // Ensure it's always an array
        const attendees = Array.isArray(attendeeArray) ? attendeeArray : [attendeeArray];

        return attendees.map(a => ({
            member_id: a['$']?.memberid ? parseInt(a['$'].memberid, 10) : null,
            name: a['$']?.name || null,
            role: a['$']?.roledescription || null,
            attendance: a['$']?.attendance || null,
            party: a['$']?.politicalparty || null,
            ward: a['$']?.ward || null,
            representing: a['$']?.representing || null
        }));
    }

    /**
     * Build a SOAP envelope for a request
     *
     * @param {string} operation - SOAP operation name
     * @param {string} bodyContent - Inner body XML content
     * @returns {string} Complete SOAP envelope
     */
    _buildSoapEnvelope(operation, bodyContent = '') {
        return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <${operation} xmlns="${SOAP_NAMESPACE}">
      ${bodyContent}
    </${operation}>
  </soap:Body>
</soap:Envelope>`;
    }

    /**
     * Make a SOAP request to ModernGov
     *
     * @param {string} operation - SOAP operation name
     * @param {string} bodyContent - Inner body XML content
     * @param {string} councilName - Council name
     * @returns {Promise<object>} Parsed response
     */
    async _callSoap(operation, bodyContent = '', councilName) {
        const endpoint = this._getEndpoint(councilName);
        const soapEnvelope = this._buildSoapEnvelope(operation, bodyContent);

        try {
            const response = await axios.post(endpoint, soapEnvelope, {
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'SOAPAction': `${SOAP_NAMESPACE}/${operation}`
                },
                timeout: 30000
            });

            // Parse XML response
            const parsed = await this.parser.parseStringPromise(response.data);
            return parsed;
        } catch (error) {
            if (error.response) {
                throw new Error(`SOAP request failed for ${councilName}: ${error.response.status} - ${error.response.data}`);
            }
            throw new Error(`SOAP request failed for ${councilName}: ${error.message}`);
        }
    }

    /**
     * Get raw SOAP response for debugging/exploration
     *
     * @param {string} operation - SOAP operation name
     * @param {string} bodyContent - Inner body XML content
     * @param {string} councilName - Council name
     * @returns {Promise<string>} Raw XML response
     */
    async _callSoapRaw(operation, bodyContent = '', councilName) {
        const endpoint = this._getEndpoint(councilName);
        const soapEnvelope = this._buildSoapEnvelope(operation, bodyContent);

        const response = await axios.post(endpoint, soapEnvelope, {
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': `${SOAP_NAMESPACE}/${operation}`
            },
            timeout: 30000
        });

        return response.data;
    }
}

module.exports = new ModernGovClient();
