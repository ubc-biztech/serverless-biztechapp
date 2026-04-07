import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import {
  PARTNERS_TABLE,
  PARTNER_EVENT_LINKS_TABLE,
  PARTNERSHIP_EVENTS_TABLE,
  PARTNER_DOCUMENTS_TABLE,
  PARTNER_COMMUNICATIONS_TABLE
} from "../../constants/tables";
import {
  PARTNERSHIP_STATUSES,
  ALUMNI_TAG,
  DEFAULT_DOCUMENT_TYPE,
  DEFAULT_DOCUMENT_STATUS,
  DEFAULT_COMMUNICATION_CHANNEL,
  DEFAULT_COMMUNICATION_DIRECTION,
  parseJsonBody,
  normalizePartnerInput,
  normalizePartnershipEventInput,
  normalizePartnerEventInput,
  normalizePartnerDocumentInput,
  normalizePartnerCommunicationInput,
  parseBooleanQuery,
  toEventIdYear,
  sortPartners,
  sortLinksNewestFirst,
  sortByUpdatedNewest,
  buildPartnerSearchIndex,
  buildStatusCounts,
  buildPackageTierCounts,
  mergeAlumniTag,
  normalizeStatus,
  normalizeStoredStatus,
  normalizeTier,
  getEventTierConfigs,
  getTierAmountForEvent,
  normalizeText
} from "./helpers";
import { buildPartnershipExportRows } from "./exportRows";
import {
  getGoogleSheetsStatus,
  getGoogleSheetsConfig,
  syncPartnershipsWithGoogleSheets
} from "./googleSheets";
import { buildDashboardReport } from "./dashboardReport";
import {
  getMassEmailConfig,
  listMassEmailTemplates,
  createMassEmailTemplate,
  updateMassEmailTemplate,
  archiveMassEmailTemplate,
  sendBulkPartnershipEmails
} from "./massEmail";
import { getEmailSyncStatus, ingestEmailSync } from "./emailSync";

const PARTNER_INDEX = "partner-query";
const EVENT_INDEX = "event-query";

const getQueryParams = (event) => event?.queryStringParameters || {};
const toTimestamp = () => Date.now();

const splitFullName = (value = "") => {
  const normalized = normalizeText(value, 180).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return {
      firstName: "",
      lastName: "",
      fullName: ""
    };
  }

  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length <= 1) {
    return {
      firstName: normalized,
      lastName: "",
      fullName: normalized
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
    fullName: normalized
  };
};

const getDecodedAuthorizationToken = (event) => {
  const header =
    event?.headers?.Authorization ||
    event?.headers?.authorization ||
    event?.headers?.AUTHORIZATION ||
    "";

  const normalizedHeader = normalizeText(header, 500);
  if (!normalizedHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = normalizeText(normalizedHeader.slice(7), 8000);
  if (!token) return null;

  try {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded !== "object") return null;
    return decoded;
  } catch {
    return null;
  }
};

const getRequesterProfile = (event) => {
  const claims =
    event?.requestContext?.authorizer?.claims &&
    typeof event.requestContext.authorizer.claims === "object"
      ? event.requestContext.authorizer.claims
      : {};
  const decoded = getDecodedAuthorizationToken(event) || {};

  const readFromSources = (keys = [], maxLength = 180) => {
    for (const key of keys) {
      const claimValue = normalizeText(claims?.[key], maxLength);
      if (claimValue) return claimValue;

      const decodedValue = normalizeText(decoded?.[key], maxLength);
      if (decodedValue) return decodedValue;
    }
    return "";
  };

  const email = readFromSources(["email", "cognito:username"], 180).toLowerCase();
  let firstName = readFromSources(
    ["given_name", "givenName", "first_name", "firstName", "fname"],
    80
  );
  let lastName = readFromSources(
    ["family_name", "familyName", "last_name", "lastName", "lname"],
    120
  );
  let fullName = readFromSources(["name", "full_name", "fullName"], 180);

  if (!fullName && (firstName || lastName)) {
    fullName = `${firstName} ${lastName}`.trim();
  }

  if ((!firstName || !lastName) && fullName) {
    const split = splitFullName(fullName);
    if (!firstName) firstName = split.firstName;
    if (!lastName) lastName = split.lastName;
    if (!fullName) fullName = split.fullName;
  }

  if (!fullName && (firstName || lastName)) {
    fullName = `${firstName} ${lastName}`.trim();
  }

  return {
    email,
    firstName,
    lastName,
    fullName
  };
};

const getRequesterEmail = (event) => {
  return getRequesterProfile(event).email;
};

const toFiniteAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const isSecuredStatus = (status) => {
  const normalized = normalizeStoredStatus(status);
  return normalized === "confirmed" || normalized === "paid";
};

const handleError = (err) => {
  console.error(err);

  if (err && typeof err === "object" && "statusCode" in err && "body" in err) {
    try {
      const parsedBody =
        typeof err.body === "string" ? JSON.parse(err.body) : err.body;

      if (
        parsedBody &&
        typeof parsedBody === "object" &&
        Object.keys(parsedBody).length > 0
      ) {
        return helpers.createResponse(Number(err.statusCode) || 500, parsedBody);
      }

      if (err.type === "ResourceNotFoundException") {
        return helpers.createResponse(500, {
          message:
            "Required partnerships table is missing in DynamoDB. Run 'serverless dynamodb migrate' for the partnerships service."
        });
      }

      return helpers.createResponse(Number(err.statusCode) || 500, {
        message: "Request failed."
      });
    } catch {
      return helpers.createResponse(Number(err.statusCode) || 500, {
        message: "Request failed."
      });
    }
  }

  return helpers.createResponse(err?.statusCode || err?.status || 500, {
    message: err?.message || err || "Request failed."
  });
};

const mapEventsById = (events) => {
  const map = new Map();
  for (const event of events || []) {
    map.set(event.id, event);
  }
  return map;
};

const mapEventsByKey = (events) => {
  const map = new Map();
  for (const event of events || []) {
    map.set(toEventIdYear(event.id, event.year), event);
  }
  return map;
};

const getPartnerOrNotFound = async (partnerId) => {
  const partner = await db.getOne(partnerId, PARTNERS_TABLE);
  if (!partner) {
    throw helpers.notFoundResponse("partner", partnerId);
  }
  return partner;
};

const getPartnershipEventOrNotFound = async (eventId) => {
  const partnershipEvent = await db.getOne(eventId, PARTNERSHIP_EVENTS_TABLE);
  if (!partnershipEvent) {
    throw helpers.notFoundResponse("partnership event", eventId);
  }
  return partnershipEvent;
};

const getPartnerLinks = async (partnerId) => {
  return db.query(PARTNER_EVENT_LINKS_TABLE, PARTNER_INDEX, {
    expression: "partnerId = :partnerId",
    expressionValues: {
      ":partnerId": partnerId
    }
  });
};

const getEventLinks = async (eventIdYear) => {
  return db.query(PARTNER_EVENT_LINKS_TABLE, EVENT_INDEX, {
    expression: "eventIdYear = :eventIdYear",
    expressionValues: {
      ":eventIdYear": eventIdYear
    }
  });
};

const getPartnerDocuments = async (partnerId) => {
  return db.query(PARTNER_DOCUMENTS_TABLE, PARTNER_INDEX, {
    expression: "partnerId = :partnerId",
    expressionValues: {
      ":partnerId": partnerId
    }
  });
};

const getPartnerCommunications = async (partnerId) => {
  return db.query(PARTNER_COMMUNICATIONS_TABLE, PARTNER_INDEX, {
    expression: "partnerId = :partnerId",
    expressionValues: {
      ":partnerId": partnerId
    }
  });
};

const buildStatusOptions = (links) => {
  const known = [...PARTNERSHIP_STATUSES];
  const knownSet = new Set(known);
  const customSet = new Set();

  for (const link of links || []) {
    const normalized = normalizeStoredStatus(link.status);
    if (!normalized) continue;
    if (!knownSet.has(normalized)) {
      customSet.add(normalized);
    }
  }

  return [...known, ...Array.from(customSet).sort()];
};

const buildPackageTierOptions = (links, partnershipEvents = []) => {
  const tiers = new Set();

  for (const link of links || []) {
    const tier = normalizeTier(link.packageTier || "");
    if (!tier) continue;
    tiers.add(tier);
  }

  for (const event of partnershipEvents || []) {
    for (const tierConfig of getEventTierConfigs(event)) {
      const normalized = normalizeTier(tierConfig.id || "");
      if (!normalized) continue;
      tiers.add(normalized);
    }
  }

  return Array.from(tiers).sort();
};

const buildPartnerTierOptions = (partners) => {
  const tiers = new Set();
  for (const partner of partners || []) {
    const tier = normalizeTier(partner.tier || "");
    if (!tier) continue;
    tiers.add(tier);
  }
  return Array.from(tiers).sort();
};

const buildPartnerStatusBreakdown = (links) => {
  const byStatus = {};

  for (const link of links || []) {
    const status = normalizeStoredStatus(link.status);

    if (!byStatus[status]) {
      byStatus[status] = {
        status,
        count: 0,
        amount: 0,
        lastTouchedAt: 0
      };
    }

    byStatus[status].count += 1;
    byStatus[status].amount += toFiniteAmount(link.amount);
    byStatus[status].lastTouchedAt = Math.max(
      byStatus[status].lastTouchedAt,
      Number(link.updatedAt) || Number(link.createdAt) || 0
    );
  }

  return Object.values(byStatus).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    if (right.amount !== left.amount) return right.amount - left.amount;
    if (right.lastTouchedAt !== left.lastTouchedAt) {
      return right.lastTouchedAt - left.lastTouchedAt;
    }
    return left.status.localeCompare(right.status);
  });
};

const computePartnerMetrics = (links) => {
  const relationshipCount = links.length;
  const confirmedCount = links.filter(
    (link) => normalizeStoredStatus(link.status) === "confirmed"
  ).length;
  const paidCount = links.filter(
    (link) => normalizeStoredStatus(link.status) === "paid"
  ).length;
  const totalAmount = links.reduce((sum, link) => sum + toFiniteAmount(link.amount), 0);
  const securedAmount = links.reduce(
    (sum, link) => sum + (isSecuredStatus(link.status) ? toFiniteAmount(link.amount) : 0),
    0
  );

  const newestLink = sortLinksNewestFirst(links)[0] || null;
  const statusBreakdown = buildPartnerStatusBreakdown(links);

  return {
    relationshipCount,
    confirmedCount,
    paidCount,
    totalAmount,
    securedAmount,
    statusBreakdown,
    latestStatus: newestLink?.status || null,
    latestEventIdYear: newestLink?.eventIdYear || null,
    lastTouchedAt: newestLink?.updatedAt || newestLink?.createdAt || null
  };
};

const computeEventMetrics = (links) => {
  const relationshipCount = links.length;
  const confirmedCount = links.filter(
    (link) => normalizeStoredStatus(link.status) === "confirmed"
  ).length;
  const paidCount = links.filter(
    (link) => normalizeStoredStatus(link.status) === "paid"
  ).length;
  const committedAmount = links.reduce(
    (sum, link) => sum + toFiniteAmount(link.amount),
    0
  );
  const securedAmount = links.reduce(
    (sum, link) => sum + (isSecuredStatus(link.status) ? toFiniteAmount(link.amount) : 0),
    0
  );
  const upcomingFollowUps = links.filter((link) => {
    if (!link.followUpDate) return false;
    return link.followUpDate >= new Date().toISOString().slice(0, 10);
  }).length;

  return {
    relationshipCount,
    confirmedCount,
    paidCount,
    committedAmount,
    securedAmount,
    upcomingFollowUps
  };
};

const buildPipelineSummary = (links) => {
  const breakdown = {};

  for (const status of PARTNERSHIP_STATUSES) {
    breakdown[status] = {
      count: 0,
      amount: 0
    };
  }

  for (const link of links || []) {
    const status = normalizeStoredStatus(link.status);
    if (!breakdown[status]) {
      breakdown[status] = {
        count: 0,
        amount: 0
      };
    }

    breakdown[status].count += 1;
    breakdown[status].amount += toFiniteAmount(link.amount);
  }

  const securedAmount = Object.entries(breakdown).reduce((sum, [status, entry]) => {
    if (status === "confirmed" || status === "paid") {
      return sum + toFiniteAmount(entry.amount);
    }
    return sum;
  }, 0);

  const pipelineAmount = Object.values(breakdown).reduce(
    (sum, entry) => sum + toFiniteAmount(entry.amount),
    0
  );

  return {
    byStatus: breakdown,
    pipelineAmount,
    securedAmount
  };
};

const hydrateLinkWithEvent = (link, eventsByKey) => {
  const event = eventsByKey.get(link.eventIdYear) || null;

  return {
    ...link,
    eventName: event?.name || link.eventName || link.eventId,
    eventStartDate: event?.startDate || null,
    eventEndDate: event?.endDate || null,
    packageTier: normalizeTier(link.packageTier || "") || ""
  };
};

const hydrateDocumentWithEvent = (document, eventsById) => {
  const event = document.eventId ? eventsById.get(document.eventId) : null;

  return {
    ...document,
    eventName: event?.name || document.eventName || null,
    eventYear: event?.year || document.eventYear || null
  };
};

const hydrateCommunicationWithEvent = (communication, eventsById) => {
  const event = communication.eventId
    ? eventsById.get(communication.eventId)
    : null;

  return {
    ...communication,
    eventName: event?.name || communication.eventName || null,
    eventYear: event?.year || communication.eventYear || null
  };
};

const partnerMatchesSearch = (partner, searchText) => {
  if (!searchText) return true;
  return buildPartnerSearchIndex(partner).includes(searchText);
};

const partnerMatchesTag = (partner, tagFilter) => {
  if (!tagFilter) return true;

  const tags = Array.isArray(partner.tags) ? partner.tags : [];
  return tags.some((tag) => tag.toLowerCase() === tagFilter);
};

const buildDirectorySummary = (partners, links) => {
  const totalPartners = partners.length;
  const archivedPartners = partners.filter((partner) => partner.archived).length;
  const alumniPartners = partners.filter((partner) => partner.isAlumni).length;
  const totalRelationships = links.length;
  const confirmedRelationships = links.filter(
    (link) => normalizeStoredStatus(link.status) === "confirmed"
  ).length;
  const paidRelationships = links.filter(
    (link) => normalizeStoredStatus(link.status) === "paid"
  ).length;
  const statusCounts = buildStatusCounts(links);
  const packageTierCounts = buildPackageTierCounts(links);
  const upcomingFollowUps = links.filter((link) => {
    if (!link.followUpDate) return false;
    return link.followUpDate >= new Date().toISOString().slice(0, 10);
  }).length;

  const pipeline = buildPipelineSummary(links);

  return {
    totalPartners,
    archivedPartners,
    activePartners: totalPartners - archivedPartners,
    alumniPartners,
    totalRelationships,
    confirmedRelationships,
    paidRelationships,
    upcomingFollowUps,
    statusCounts,
    packageTierCounts,
    pipeline
  };
};

const maybeAutoSyncPush = async (trigger) => {
  const config = getGoogleSheetsConfig();
  if (!config.configured || !config.autoSync) return;

  try {
    await syncPartnershipsWithGoogleSheets("push");
  } catch (error) {
    console.error("Google Sheets auto-sync failed after", trigger, error);
  }
};

const buildEventLinkId = (partnerId, eventId) => `${partnerId}::${eventId}`;

const ensureUniquePartnerEventAssociation = async (partnerId, eventId) => {
  const links = await getPartnerLinks(partnerId);
  const duplicate = links.find((link) => link.eventId === eventId);
  if (duplicate) {
    throw helpers.duplicateResponse("partnerId+eventId", {
      partnerId,
      eventId
    });
  }
};

const validateEventDateOrder = (eventShape) => {
  if (eventShape.startDate && eventShape.endDate) {
    if (eventShape.startDate > eventShape.endDate) {
      throw helpers.inputError("'startDate' cannot be after 'endDate'.", {
        startDate: eventShape.startDate,
        endDate: eventShape.endDate
      });
    }
  }

  if (eventShape.outreachStartDate && eventShape.endDate) {
    if (eventShape.outreachStartDate > eventShape.endDate) {
      throw helpers.inputError(
        "'outreachStartDate' cannot be after 'endDate'.",
        {
          outreachStartDate: eventShape.outreachStartDate,
          endDate: eventShape.endDate
        }
      );
    }
  }
};

const resolveDocumentEventPatch = async (payload, fallback) => {
  const hasEventUpdate =
    Object.prototype.hasOwnProperty.call(payload, "eventId") ||
    Object.prototype.hasOwnProperty.call(payload, "eventYear");

  if (!hasEventUpdate) return null;

  const nextEventId =
    payload.eventId !== undefined ? payload.eventId : fallback?.eventId || "";

  if (!nextEventId) {
    return {
      eventId: null,
      eventYear: null,
      eventIdYear: null,
      eventName: null
    };
  }

  const eventRecord = await getPartnershipEventOrNotFound(nextEventId);

  const nextYear =
    payload.eventYear !== undefined ? payload.eventYear : fallback?.eventYear;
  if (nextYear && Number(nextYear) !== Number(eventRecord.year)) {
    throw helpers.inputError(
      "'eventYear' does not match the selected partnerships event year.",
      {
        eventId: eventRecord.id,
        eventYear: nextYear,
        expectedYear: eventRecord.year
      }
    );
  }

  return {
    eventId: eventRecord.id,
    eventYear: eventRecord.year,
    eventIdYear: toEventIdYear(eventRecord.id, eventRecord.year),
    eventName: eventRecord.name
  };
};

const resolveCommunicationEventPatch = async (payload, fallback) => {
  return resolveDocumentEventPatch(payload, fallback);
};

const patchLinksAfterEventUpdate = async (previousEvent, updatedEvent) => {
  const previousEventIdYear = toEventIdYear(previousEvent.id, previousEvent.year);
  const linkedRows = await getEventLinks(previousEventIdYear);

  await Promise.all(
    linkedRows.map((link) => {
      return db.updateDB(
        link.id,
        {
          eventYear: updatedEvent.year,
          eventIdYear: toEventIdYear(updatedEvent.id, updatedEvent.year),
          eventName: updatedEvent.name
        },
        PARTNER_EVENT_LINKS_TABLE
      );
    })
  );
};

const formatPartnershipEvent = (event) => {
  const tierConfigs = getEventTierConfigs(event);
  const packageTiers = tierConfigs.map((tier) => tier.id);

  return {
    id: event.id,
    name: event.name,
    year: event.year,
    startDate: event.startDate || null,
    endDate: event.endDate || null,
    outreachStartDate: event.outreachStartDate || null,
    sponsorshipGoal:
      typeof event.sponsorshipGoal === "number" && Number.isFinite(event.sponsorshipGoal)
        ? event.sponsorshipGoal
        : null,
    tierConfigs,
    packageTiers,
    notes: event.notes || "",
    linkedMainEventId: event.linkedMainEventId || "",
    linkedMainEventYear: event.linkedMainEventYear || null,
    archived: Boolean(event.archived),
    relationshipCount: Number(event.relationshipCount) || 0,
    confirmedCount: Number(event.confirmedCount) || 0,
    paidCount: Number(event.paidCount) || 0,
    committedAmount: Number(event.committedAmount) || 0,
    securedAmount: Number(event.securedAmount) || 0,
    createdAt: event.createdAt || null,
    updatedAt: event.updatedAt || null
  };
};

const sortPartnershipEvents = (events) => {
  return [...events].sort((left, right) => {
    if ((right.year || 0) !== (left.year || 0)) {
      return (right.year || 0) - (left.year || 0);
    }

    const rightStart = right.startDate || "";
    const leftStart = left.startDate || "";
    if (rightStart !== leftStart) {
      return rightStart > leftStart ? 1 : -1;
    }

    return normalizeText(left.name, 140).localeCompare(
      normalizeText(right.name, 140)
    );
  });
};

export const listPartners = async (event) => {
  try {
    const query = getQueryParams(event);

    const searchText = normalizeText(query.search, 180).toLowerCase();
    const statusFilter = query.status
      ? normalizeStatus(query.status, { allowCustom: true })
      : null;
    const tagFilter = normalizeText(query.tag, 80).toLowerCase();
    const includeArchived = parseBooleanQuery(query.includeArchived) === true;
    const alumniFilter = parseBooleanQuery(query.isAlumni);
    const packageTierFilter = normalizeTier(
      query.packageTier !== undefined ? query.packageTier : query.tier,
      { allowEmpty: true }
    );
    const partnerTierFilter = normalizeTier(query.partnerTier, {
      allowEmpty: true
    });

    const eventIdYearFilter = query.eventIdYear
      ? query.eventIdYear
      : query.eventId && query.eventYear
        ? toEventIdYear(query.eventId, Number(query.eventYear))
        : null;

    const [allPartners, allLinks, allPartnershipEvents] = await Promise.all([
      db.scan(PARTNERS_TABLE),
      db.scan(PARTNER_EVENT_LINKS_TABLE),
      db.scan(PARTNERSHIP_EVENTS_TABLE)
    ]);

    const relationshipFilteredLinks = allLinks.filter((link) => {
      if (eventIdYearFilter && link.eventIdYear !== eventIdYearFilter) {
        return false;
      }

      if (statusFilter && normalizeStoredStatus(link.status) !== statusFilter) {
        return false;
      }

      if (
        packageTierFilter &&
        normalizeTier(link.packageTier || "") !== packageTierFilter
      ) {
        return false;
      }

      return true;
    });

    const relationshipFilteredPartnerIds = new Set(
      relationshipFilteredLinks.map((link) => link.partnerId)
    );
    const hasRelationshipFilter = Boolean(
      eventIdYearFilter || statusFilter || packageTierFilter
    );

    const linksByPartnerInScope = (hasRelationshipFilter
      ? relationshipFilteredLinks
      : allLinks
    ).reduce((acc, link) => {
      if (!acc[link.partnerId]) {
        acc[link.partnerId] = [];
      }
      acc[link.partnerId].push(link);
      return acc;
    }, {});

    const filteredPartners = allPartners.filter((partner) => {
      if (!includeArchived && partner.archived) return false;

      if (alumniFilter !== null && Boolean(partner.isAlumni) !== alumniFilter) {
        return false;
      }

      if (!partnerMatchesSearch(partner, searchText)) return false;
      if (!partnerMatchesTag(partner, tagFilter)) return false;

      if (
        partnerTierFilter &&
        normalizeTier(partner.tier || "") !== partnerTierFilter
      ) {
        return false;
      }

      if (
        (eventIdYearFilter || statusFilter || packageTierFilter) &&
        !relationshipFilteredPartnerIds.has(partner.id)
      ) {
        return false;
      }

      return true;
    });

    const partnerRows = sortPartners(filteredPartners).map((partner) => {
      const partnerLinks = linksByPartnerInScope[partner.id] || [];
      const metrics = computePartnerMetrics(partnerLinks);
      return {
        ...partner,
        tier: normalizeTier(partner.tier || ""),
        ...metrics,
        tags: Array.isArray(partner.tags) ? partner.tags : []
      };
    });

    const filteredPartnerIds = new Set(partnerRows.map((partner) => partner.id));
    const linksInScope = (
      hasRelationshipFilter ? relationshipFilteredLinks : allLinks
    ).filter((link) => filteredPartnerIds.has(link.partnerId));

    return helpers.createResponse(200, {
      partners: partnerRows,
      summary: buildDirectorySummary(partnerRows, linksInScope),
      filters: {
        status: statusFilter,
        eventIdYear: eventIdYearFilter || null,
        includeArchived,
        isAlumni: alumniFilter,
        tag: tagFilter || null,
        search: searchText || null,
        tier: packageTierFilter || null,
        partnerTier: partnerTierFilter || null
      },
      statusOptions: buildStatusOptions(allLinks),
      packageTierOptions: buildPackageTierOptions(allLinks, allPartnershipEvents),
      partnerTierOptions: buildPartnerTierOptions(allPartners)
    });
  } catch (err) {
    return handleError(err);
  }
};

export const getDashboard = async (event) => {
  try {
    const query = getQueryParams(event);

    const [partners, links, events, communications] = await Promise.all([
      db.scan(PARTNERS_TABLE),
      db.scan(PARTNER_EVENT_LINKS_TABLE),
      db.scan(PARTNERSHIP_EVENTS_TABLE),
      db.scan(PARTNER_COMMUNICATIONS_TABLE)
    ]);

    const dashboard = buildDashboardReport({
      partners,
      links,
      events,
      communications,
      query
    });

    return helpers.createResponse(200, dashboard);
  } catch (err) {
    return handleError(err);
  }
};

export const createPartner = async (event) => {
  try {
    const payload = normalizePartnerInput(parseJsonBody(event));
    const timestamp = toTimestamp();
    const isAlumni = Boolean(payload.isAlumni);

    const item = {
      id: uuidv4(),
      company: payload.company,
      email: payload.email || "",
      contactName: payload.contactName || "",
      phone: payload.phone || "",
      contactRole: payload.contactRole || "",
      linkedin: payload.linkedin || "",
      tier: normalizeTier(payload.tier || ""),
      notes: payload.notes || "",
      tags: mergeAlumniTag(payload.tags || [], isAlumni),
      isAlumni,
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await db.create(item, PARTNERS_TABLE);
    await maybeAutoSyncPush("createPartner");

    return helpers.createResponse(201, {
      message: "Partner created successfully.",
      partner: item
    });
  } catch (err) {
    return handleError(err);
  }
};

export const getPartner = async (event) => {
  try {
    const partnerId = event?.pathParameters?.partnerId;
    if (!partnerId) {
      throw helpers.missingPathParamResponse("partner", "partnerId");
    }

    const [partner, links, events, documents, communications] = await Promise.all([
      getPartnerOrNotFound(partnerId),
      getPartnerLinks(partnerId),
      db.scan(PARTNERSHIP_EVENTS_TABLE),
      getPartnerDocuments(partnerId),
      getPartnerCommunications(partnerId)
    ]);

    const eventsByKey = mapEventsByKey(events);
    const eventsById = mapEventsById(events);

    const hydratedLinks = sortLinksNewestFirst(links).map((link) =>
      hydrateLinkWithEvent(link, eventsByKey)
    );

    const metrics = computePartnerMetrics(hydratedLinks);

    const hydratedDocuments = sortByUpdatedNewest(documents).map((document) =>
      hydrateDocumentWithEvent(document, eventsById)
    );

    const hydratedCommunications = sortByUpdatedNewest(communications).map(
      (communication) => hydrateCommunicationWithEvent(communication, eventsById)
    );

    return helpers.createResponse(200, {
      partner: {
        ...partner,
        tier: normalizeTier(partner.tier || ""),
        ...metrics,
        tags: Array.isArray(partner.tags) ? partner.tags : []
      },
      links: hydratedLinks,
      documents: hydratedDocuments,
      communications: hydratedCommunications,
      statusOptions: buildStatusOptions(hydratedLinks),
      packageTierOptions: buildPackageTierOptions(hydratedLinks, events)
    });
  } catch (err) {
    return handleError(err);
  }
};

export const updatePartner = async (event) => {
  try {
    const partnerId = event?.pathParameters?.partnerId;
    if (!partnerId) {
      throw helpers.missingPathParamResponse("partner", "partnerId");
    }

    const [existingPartner, payload] = await Promise.all([
      getPartnerOrNotFound(partnerId),
      Promise.resolve(normalizePartnerInput(parseJsonBody(event), { partial: true }))
    ]);

    if (!Object.keys(payload).length) {
      throw helpers.inputError("At least one property must be provided.", payload);
    }

    const hasTagsUpdate = Object.prototype.hasOwnProperty.call(payload, "tags");
    const hasAlumniUpdate = Object.prototype.hasOwnProperty.call(payload, "isAlumni");

    if (hasTagsUpdate || hasAlumniUpdate) {
      const nextIsAlumni = hasAlumniUpdate
        ? payload.isAlumni
        : Boolean(existingPartner.isAlumni);

      const nextTags = hasTagsUpdate
        ? payload.tags
        : Array.isArray(existingPartner.tags)
          ? existingPartner.tags
          : [];

      payload.tags = mergeAlumniTag(nextTags, nextIsAlumni);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "tier")) {
      payload.tier = normalizeTier(payload.tier || "");
    }

    const updatePayload = {
      ...payload,
      updatedAt: toTimestamp()
    };

    await db.updateDB(partnerId, updatePayload, PARTNERS_TABLE);
    await maybeAutoSyncPush("updatePartner");

    const updatedPartner = await db.getOne(partnerId, PARTNERS_TABLE);

    return helpers.createResponse(200, {
      message: "Partner updated successfully.",
      partner: {
        ...updatedPartner,
        tier: normalizeTier(updatedPartner.tier || ""),
        tags: Array.isArray(updatedPartner.tags) ? updatedPartner.tags : []
      }
    });
  } catch (err) {
    return handleError(err);
  }
};

export const listEvents = async () => {
  try {
    const [events, links] = await Promise.all([
      db.scan(PARTNERSHIP_EVENTS_TABLE),
      db.scan(PARTNER_EVENT_LINKS_TABLE)
    ]);

    const metricsByEventIdYear = {};
    for (const link of links || []) {
      const key = link.eventIdYear;
      if (!key) continue;

      if (!metricsByEventIdYear[key]) {
        metricsByEventIdYear[key] = {
          relationshipCount: 0,
          confirmedCount: 0,
          paidCount: 0,
          committedAmount: 0,
          securedAmount: 0
        };
      }

      const metrics = metricsByEventIdYear[key];
      metrics.relationshipCount += 1;

      const normalizedStatus = normalizeStoredStatus(link.status);
      if (normalizedStatus === "confirmed") metrics.confirmedCount += 1;
      if (normalizedStatus === "paid") metrics.paidCount += 1;

      const amount = toFiniteAmount(link.amount);
      metrics.committedAmount += amount;
      if (isSecuredStatus(link.status)) {
        metrics.securedAmount += amount;
      }
    }

    const enriched = events.map((event) => {
      const key = toEventIdYear(event.id, event.year);
      return {
        ...event,
        ...(metricsByEventIdYear[key] || {
          relationshipCount: 0,
          confirmedCount: 0,
          paidCount: 0,
          committedAmount: 0,
          securedAmount: 0
        })
      };
    });

    return helpers.createResponse(200, {
      events: sortPartnershipEvents(enriched).map(formatPartnershipEvent)
    });
  } catch (err) {
    return handleError(err);
  }
};

export const getEvent = async (event) => {
  try {
    const eventId = event?.pathParameters?.eventId;
    if (!eventId) {
      throw helpers.missingPathParamResponse("partnership event", "eventId");
    }

    const partnershipEvent = await getPartnershipEventOrNotFound(eventId);
    const eventIdYear = toEventIdYear(partnershipEvent.id, partnershipEvent.year);
    const eventLinks = sortLinksNewestFirst(await getEventLinks(eventIdYear));

    const partnerIds = Array.from(
      new Set(eventLinks.map((link) => link.partnerId).filter(Boolean))
    );
    const partnerRows = await Promise.all(
      partnerIds.map((partnerId) => db.getOne(partnerId, PARTNERS_TABLE))
    );
    const partnersById = new Map();
    for (const partner of partnerRows) {
      if (partner?.id) partnersById.set(partner.id, partner);
    }

    const sponsorships = eventLinks.map((link) => {
      const partner = partnersById.get(link.partnerId) || null;
      let partnerSummary = null;
      if (partner) {
        partnerSummary = {
          id: partner.id,
          company: partner.company || "",
          contactName: partner.contactName || "",
          email: partner.email || "",
          phone: partner.phone || "",
          contactRole: partner.contactRole || "",
          tier: normalizeTier(partner.tier || ""),
          archived: Boolean(partner.archived),
          isAlumni: Boolean(partner.isAlumni)
        };
      }

      return {
        ...link,
        packageTier: normalizeTier(link.packageTier || "") || "",
        amount: link.amount === undefined ? null : link.amount,
        partner: partnerSummary
      };
    });

    const metrics = computeEventMetrics(eventLinks);
    const pipeline = buildPipelineSummary(eventLinks);

    return helpers.createResponse(200, {
      event: formatPartnershipEvent({
        ...partnershipEvent,
        ...metrics
      }),
      sponsorships,
      pipeline
    });
  } catch (err) {
    return handleError(err);
  }
};

export const createEvent = async (event) => {
  try {
    const payload = normalizePartnershipEventInput(parseJsonBody(event));
    const timestamp = toTimestamp();

    const item = {
      id: uuidv4(),
      name: payload.name,
      year: payload.year,
      startDate: payload.startDate || null,
      endDate: payload.endDate || null,
      outreachStartDate: payload.outreachStartDate || null,
      sponsorshipGoal:
        payload.sponsorshipGoal === undefined ? null : payload.sponsorshipGoal,
      tierConfigs: Array.isArray(payload.tierConfigs) ? payload.tierConfigs : [],
      packageTiers: Array.isArray(payload.packageTiers) ? payload.packageTiers : [],
      notes: payload.notes || "",
      linkedMainEventId: payload.linkedMainEventId || "",
      linkedMainEventYear: payload.linkedMainEventYear || null,
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    validateEventDateOrder(item);

    await db.create(item, PARTNERSHIP_EVENTS_TABLE);
    await maybeAutoSyncPush("createEvent");

    return helpers.createResponse(201, {
      message: "Partnership event created successfully.",
      event: formatPartnershipEvent(item)
    });
  } catch (err) {
    return handleError(err);
  }
};

export const updateEvent = async (event) => {
  try {
    const eventId = event?.pathParameters?.eventId;
    if (!eventId) {
      throw helpers.missingPathParamResponse("partnership event", "eventId");
    }

    const existing = await getPartnershipEventOrNotFound(eventId);
    const payload = normalizePartnershipEventInput(parseJsonBody(event), {
      partial: true
    });

    if (!Object.keys(payload).length) {
      throw helpers.inputError("At least one property must be provided.", payload);
    }

    const merged = {
      ...existing,
      ...payload
    };

    validateEventDateOrder(merged);

    await db.updateDB(
      eventId,
      {
        ...payload,
        updatedAt: toTimestamp()
      },
      PARTNERSHIP_EVENTS_TABLE
    );

    const updated = await db.getOne(eventId, PARTNERSHIP_EVENTS_TABLE);

    if (existing.name !== updated.name || Number(existing.year) !== Number(updated.year)) {
      await patchLinksAfterEventUpdate(existing, updated);
    }
    await maybeAutoSyncPush("updateEvent");

    return helpers.createResponse(200, {
      message: "Partnership event updated successfully.",
      event: formatPartnershipEvent(updated)
    });
  } catch (err) {
    return handleError(err);
  }
};

export const deleteEvent = async (event) => {
  try {
    const eventId = event?.pathParameters?.eventId;
    if (!eventId) {
      throw helpers.missingPathParamResponse("partnership event", "eventId");
    }

    const existing = await getPartnershipEventOrNotFound(eventId);

    const relatedLinks = await getEventLinks(toEventIdYear(existing.id, existing.year));
    if (relatedLinks.length > 0) {
      throw helpers.inputError(
        "Cannot delete this partnerships event while sponsor associations exist. Archive it instead.",
        {
          eventId: existing.id,
          eventName: existing.name,
          linkedSponsors: relatedLinks.length
        }
      );
    }

    await db.deleteOne(eventId, PARTNERSHIP_EVENTS_TABLE);
    await maybeAutoSyncPush("deleteEvent");

    return helpers.createResponse(200, {
      message: "Partnership event deleted successfully."
    });
  } catch (err) {
    return handleError(err);
  }
};

export const createPartnerEvent = async (event) => {
  try {
    const partnerId = event?.pathParameters?.partnerId;
    if (!partnerId) {
      throw helpers.missingPathParamResponse("partner", "partnerId");
    }

    const payload = normalizePartnerEventInput(parseJsonBody(event));

    const [partner, linkedEvent] = await Promise.all([
      getPartnerOrNotFound(partnerId),
      getPartnershipEventOrNotFound(payload.eventId)
    ]);

    if (payload.eventYear && Number(payload.eventYear) !== Number(linkedEvent.year)) {
      throw helpers.inputError(
        "'eventYear' does not match the selected partnerships event year.",
        {
          eventId: linkedEvent.id,
          eventYear: payload.eventYear,
          expectedYear: linkedEvent.year
        }
      );
    }

    await ensureUniquePartnerEventAssociation(partner.id, linkedEvent.id);

    const packageTier = normalizeTier(payload.packageTier || "");
    const defaultTierAmount = packageTier
      ? getTierAmountForEvent(linkedEvent, packageTier)
      : null;

    const timestamp = toTimestamp();
    const item = {
      id: buildEventLinkId(partner.id, linkedEvent.id),
      partnerId: partner.id,
      eventId: linkedEvent.id,
      eventYear: linkedEvent.year,
      eventIdYear: toEventIdYear(linkedEvent.id, linkedEvent.year),
      eventName: linkedEvent.name,
      status: payload.status,
      packageTier,
      role: payload.role || "",
      notes: payload.notes || "",
      amount: payload.amount === undefined ? defaultTierAmount : payload.amount,
      followUpDate: payload.followUpDate === undefined ? null : payload.followUpDate,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await db.create(item, PARTNER_EVENT_LINKS_TABLE);
    await maybeAutoSyncPush("createPartnerEvent");

    return helpers.createResponse(201, {
      message: "Partner event association created successfully.",
      link: item
    });
  } catch (err) {
    return handleError(err);
  }
};

export const updatePartnerEvent = async (event) => {
  try {
    const linkId = event?.pathParameters?.linkId;
    if (!linkId) {
      throw helpers.missingPathParamResponse("partner event", "linkId");
    }

    const input = parseJsonBody(event);

    if (
      Object.prototype.hasOwnProperty.call(input, "eventId") ||
      Object.prototype.hasOwnProperty.call(input, "eventYear")
    ) {
      throw helpers.inputError(
        "'eventId' and 'eventYear' cannot be changed after the association is created.",
        input
      );
    }

    const existingLink = await db.getOne(linkId, PARTNER_EVENT_LINKS_TABLE);
    if (!existingLink) {
      throw helpers.notFoundResponse("partner event", linkId);
    }

    const payload = normalizePartnerEventInput(input, {
      partial: true
    });

    if (!Object.keys(payload).length) {
      throw helpers.inputError("At least one property must be provided.", payload);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "packageTier")) {
      payload.packageTier = normalizeTier(payload.packageTier || "");
    }

    if (
      payload.amount === undefined &&
      Object.prototype.hasOwnProperty.call(payload, "packageTier")
    ) {
      const linkedEvent = await getPartnershipEventOrNotFound(existingLink.eventId);
      payload.amount = getTierAmountForEvent(linkedEvent, payload.packageTier || "");
    }

    const updatePayload = {
      ...payload,
      updatedAt: toTimestamp()
    };

    await db.updateDB(linkId, updatePayload, PARTNER_EVENT_LINKS_TABLE);
    await maybeAutoSyncPush("updatePartnerEvent");

    const updatedLink = await db.getOne(linkId, PARTNER_EVENT_LINKS_TABLE);

    return helpers.createResponse(200, {
      message: "Partner event association updated successfully.",
      link: updatedLink
    });
  } catch (err) {
    return handleError(err);
  }
};

export const deletePartnerEvent = async (event) => {
  try {
    const linkId = event?.pathParameters?.linkId;
    if (!linkId) {
      throw helpers.missingPathParamResponse("partner event", "linkId");
    }

    const existingLink = await db.getOne(linkId, PARTNER_EVENT_LINKS_TABLE);
    if (!existingLink) {
      throw helpers.notFoundResponse("partner event", linkId);
    }

    await db.deleteOne(linkId, PARTNER_EVENT_LINKS_TABLE);
    await maybeAutoSyncPush("deletePartnerEvent");

    return helpers.createResponse(200, {
      message: "Partner event association deleted successfully."
    });
  } catch (err) {
    return handleError(err);
  }
};

export const listPartnerDocuments = async (event) => {
  try {
    const partnerId = event?.pathParameters?.partnerId;
    if (!partnerId) {
      throw helpers.missingPathParamResponse("partner", "partnerId");
    }

    await getPartnerOrNotFound(partnerId);

    const [documents, events] = await Promise.all([
      getPartnerDocuments(partnerId),
      db.scan(PARTNERSHIP_EVENTS_TABLE)
    ]);

    const eventsById = mapEventsById(events);

    return helpers.createResponse(200, {
      documents: sortByUpdatedNewest(documents).map((document) =>
        hydrateDocumentWithEvent(document, eventsById)
      )
    });
  } catch (err) {
    return handleError(err);
  }
};

export const createPartnerDocument = async (event) => {
  try {
    const partnerId = event?.pathParameters?.partnerId;
    if (!partnerId) {
      throw helpers.missingPathParamResponse("partner", "partnerId");
    }

    await getPartnerOrNotFound(partnerId);

    const payload = normalizePartnerDocumentInput(parseJsonBody(event));
    const eventPatch = await resolveDocumentEventPatch(payload, null);

    const timestamp = toTimestamp();
    const item = {
      id: uuidv4(),
      partnerId,
      title: payload.title,
      type: payload.type || DEFAULT_DOCUMENT_TYPE,
      status: payload.status || DEFAULT_DOCUMENT_STATUS,
      url: payload.url || "",
      fileName: payload.fileName || "",
      notes: payload.notes || "",
      eventId: eventPatch?.eventId || null,
      eventYear: eventPatch?.eventYear || null,
      eventIdYear: eventPatch?.eventIdYear || null,
      eventName: eventPatch?.eventName || null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await db.create(item, PARTNER_DOCUMENTS_TABLE);

    return helpers.createResponse(201, {
      message: "Document linked successfully.",
      document: item
    });
  } catch (err) {
    return handleError(err);
  }
};

export const updatePartnerDocument = async (event) => {
  try {
    const documentId = event?.pathParameters?.documentId;
    if (!documentId) {
      throw helpers.missingPathParamResponse("partner document", "documentId");
    }

    const existing = await db.getOne(documentId, PARTNER_DOCUMENTS_TABLE);
    if (!existing) {
      throw helpers.notFoundResponse("partner document", documentId);
    }

    const payload = normalizePartnerDocumentInput(parseJsonBody(event), {
      partial: true
    });

    if (!Object.keys(payload).length) {
      throw helpers.inputError("At least one property must be provided.", payload);
    }

    const eventPatch = await resolveDocumentEventPatch(payload, existing);

    const updatePayload = {
      ...payload,
      ...(eventPatch || {}),
      updatedAt: toTimestamp()
    };

    await db.updateDB(documentId, updatePayload, PARTNER_DOCUMENTS_TABLE);

    const updated = await db.getOne(documentId, PARTNER_DOCUMENTS_TABLE);

    return helpers.createResponse(200, {
      message: "Document updated successfully.",
      document: updated
    });
  } catch (err) {
    return handleError(err);
  }
};

export const deletePartnerDocument = async (event) => {
  try {
    const documentId = event?.pathParameters?.documentId;
    if (!documentId) {
      throw helpers.missingPathParamResponse("partner document", "documentId");
    }

    const existing = await db.getOne(documentId, PARTNER_DOCUMENTS_TABLE);
    if (!existing) {
      throw helpers.notFoundResponse("partner document", documentId);
    }

    await db.deleteOne(documentId, PARTNER_DOCUMENTS_TABLE);

    return helpers.createResponse(200, {
      message: "Document removed successfully."
    });
  } catch (err) {
    return handleError(err);
  }
};

export const listPartnerCommunications = async (event) => {
  try {
    const partnerId = event?.pathParameters?.partnerId;
    if (!partnerId) {
      throw helpers.missingPathParamResponse("partner", "partnerId");
    }

    await getPartnerOrNotFound(partnerId);

    const [communications, events] = await Promise.all([
      getPartnerCommunications(partnerId),
      db.scan(PARTNERSHIP_EVENTS_TABLE)
    ]);

    const eventsById = mapEventsById(events);

    return helpers.createResponse(200, {
      communications: sortByUpdatedNewest(communications).map((communication) =>
        hydrateCommunicationWithEvent(communication, eventsById)
      )
    });
  } catch (err) {
    return handleError(err);
  }
};

export const createPartnerCommunication = async (event) => {
  try {
    const partnerId = event?.pathParameters?.partnerId;
    if (!partnerId) {
      throw helpers.missingPathParamResponse("partner", "partnerId");
    }

    await getPartnerOrNotFound(partnerId);

    const payload = normalizePartnerCommunicationInput(parseJsonBody(event));
    const eventPatch = await resolveCommunicationEventPatch(payload, null);

    const timestamp = toTimestamp();
    const item = {
      id: uuidv4(),
      partnerId,
      subject: payload.subject || "",
      summary: payload.summary,
      channel: payload.channel || DEFAULT_COMMUNICATION_CHANNEL,
      direction: payload.direction || DEFAULT_COMMUNICATION_DIRECTION,
      occurredAt: payload.occurredAt || new Date().toISOString(),
      followUpDate: payload.followUpDate || null,
      eventId: eventPatch?.eventId || null,
      eventYear: eventPatch?.eventYear || null,
      eventIdYear: eventPatch?.eventIdYear || null,
      eventName: eventPatch?.eventName || null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await db.create(item, PARTNER_COMMUNICATIONS_TABLE);

    return helpers.createResponse(201, {
      message: "Communication logged successfully.",
      communication: item
    });
  } catch (err) {
    return handleError(err);
  }
};

export const updatePartnerCommunication = async (event) => {
  try {
    const communicationId = event?.pathParameters?.communicationId;
    if (!communicationId) {
      throw helpers.missingPathParamResponse(
        "partner communication",
        "communicationId"
      );
    }

    const existing = await db.getOne(communicationId, PARTNER_COMMUNICATIONS_TABLE);
    if (!existing) {
      throw helpers.notFoundResponse("partner communication", communicationId);
    }

    const payload = normalizePartnerCommunicationInput(parseJsonBody(event), {
      partial: true
    });

    if (!Object.keys(payload).length) {
      throw helpers.inputError("At least one property must be provided.", payload);
    }

    const eventPatch = await resolveCommunicationEventPatch(payload, existing);

    const updatePayload = {
      ...payload,
      ...(eventPatch || {}),
      updatedAt: toTimestamp()
    };

    await db.updateDB(
      communicationId,
      updatePayload,
      PARTNER_COMMUNICATIONS_TABLE
    );

    const updated = await db.getOne(communicationId, PARTNER_COMMUNICATIONS_TABLE);

    return helpers.createResponse(200, {
      message: "Communication log updated successfully.",
      communication: updated
    });
  } catch (err) {
    return handleError(err);
  }
};

export const deletePartnerCommunication = async (event) => {
  try {
    const communicationId = event?.pathParameters?.communicationId;
    if (!communicationId) {
      throw helpers.missingPathParamResponse(
        "partner communication",
        "communicationId"
      );
    }

    const existing = await db.getOne(communicationId, PARTNER_COMMUNICATIONS_TABLE);
    if (!existing) {
      throw helpers.notFoundResponse("partner communication", communicationId);
    }

    await db.deleteOne(communicationId, PARTNER_COMMUNICATIONS_TABLE);

    return helpers.createResponse(200, {
      message: "Communication entry removed successfully."
    });
  } catch (err) {
    return handleError(err);
  }
};

export const exportPartners = async () => {
  try {
    const [partners, links] = await Promise.all([
      db.scan(PARTNERS_TABLE),
      db.scan(PARTNER_EVENT_LINKS_TABLE)
    ]);

    const rows = buildPartnershipExportRows(partners, links);

    return helpers.createResponse(200, {
      generatedAt: new Date().toISOString(),
      alumniTag: ALUMNI_TAG,
      rows
    });
  } catch (err) {
    return handleError(err);
  }
};

export const googleSheetsStatus = async () => {
  try {
    const status = await getGoogleSheetsStatus();
    return helpers.createResponse(200, status);
  } catch (err) {
    return handleError(err);
  }
};

export const googleSheetsSync = async (event) => {
  try {
    const payload = parseJsonBody(event);
    const mode = payload?.mode || "push";
    const result = await syncPartnershipsWithGoogleSheets(mode);

    return helpers.createResponse(200, {
      ...result,
      syncedAt: new Date().toISOString()
    });
  } catch (err) {
    return handleError(err);
  }
};

export const massEmailConfig = async (event) => {
  try {
    const actorProfile = getRequesterProfile(event);
    return helpers.createResponse(200, getMassEmailConfig(actorProfile));
  } catch (err) {
    return handleError(err);
  }
};

export const listMassEmailTemplatesHandler = async () => {
  try {
    const result = await listMassEmailTemplates();
    return helpers.createResponse(200, result);
  } catch (err) {
    return handleError(err);
  }
};

export const createMassEmailTemplateHandler = async (event) => {
  try {
    const payload = parseJsonBody(event);
    const actorEmail = getRequesterEmail(event);
    const result = await createMassEmailTemplate(payload, actorEmail);
    return helpers.createResponse(201, result);
  } catch (err) {
    return handleError(err);
  }
};

export const updateMassEmailTemplateHandler = async (event) => {
  try {
    const templateId = event?.pathParameters?.templateId;
    if (!templateId) {
      throw helpers.missingPathParamResponse(
        "partnerships mass-email template",
        "templateId"
      );
    }

    const payload = parseJsonBody(event);
    const actorEmail = getRequesterEmail(event);
    const result = await updateMassEmailTemplate(templateId, payload, actorEmail);
    return helpers.createResponse(200, result);
  } catch (err) {
    return handleError(err);
  }
};

export const deleteMassEmailTemplateHandler = async (event) => {
  try {
    const templateId = event?.pathParameters?.templateId;
    if (!templateId) {
      throw helpers.missingPathParamResponse(
        "partnerships mass-email template",
        "templateId"
      );
    }

    const actorEmail = getRequesterEmail(event);
    const result = await archiveMassEmailTemplate(templateId, actorEmail);
    return helpers.createResponse(200, result);
  } catch (err) {
    return handleError(err);
  }
};

export const sendBulkMassEmailHandler = async (event) => {
  try {
    const payload = parseJsonBody(event);
    const actorProfile = getRequesterProfile(event);
    const result = await sendBulkPartnershipEmails(payload, actorProfile);
    return helpers.createResponse(200, result);
  } catch (err) {
    return handleError(err);
  }
};

export const emailSyncStatus = async (event) => {
  try {
    const result = await getEmailSyncStatus(event);
    return helpers.createResponse(200, result);
  } catch (err) {
    return handleError(err);
  }
};

export const emailSyncIngest = async (event) => {
  try {
    const payload = parseJsonBody(event);
    const result = await ingestEmailSync(event, payload);
    return helpers.createResponse(result.statusCode || 200, result);
  } catch (err) {
    return handleError(err);
  }
};
