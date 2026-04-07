import helpers from "../../lib/handlerHelpers";
import { isValidEmail } from "../../lib/utils";

export const ALUMNI_TAG = "alumni-partner";

export const PARTNERSHIP_STATUSES = [
  "prospecting",
  "pitched",
  "reached_out",
  "shortlist",
  "in_conversation",
  "followed_up",
  "confirmed",
  "paid",
  "declined",
  "backed_out"
];

export const DEFAULT_PARTNERSHIP_STATUS = "reached_out";
export const DEFAULT_DOCUMENT_TYPE = "general";
export const DEFAULT_DOCUMENT_STATUS = "draft";
export const DEFAULT_COMMUNICATION_CHANNEL = "email";
export const DEFAULT_COMMUNICATION_DIRECTION = "outbound";

const STATUS_ALIASES = {
  prospecting: "prospecting",
  pitched: "pitched",
  reached_out: "reached_out",
  "reached out": "reached_out",
  shortlist: "shortlist",
  in_conversation: "in_conversation",
  "in conversation": "in_conversation",
  followed_up: "followed_up",
  "followed up": "followed_up",
  confirmed: "confirmed",
  paid: "paid",
  declined: "declined",
  backed_out: "backed_out",
  "backed out": "backed_out"
};

const toSafeString = (value) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

export const normalizeText = (value, maxLength = 2000) => {
  const text = toSafeString(value);
  if (!text) return "";
  return text.slice(0, maxLength);
};

const normalizeSlug = (value, maxLength = 60, fieldName = "value") => {
  const raw = normalizeText(value, maxLength).toLowerCase();
  const slug = raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  if (!slug) {
    throw helpers.inputError(
      `'${fieldName}' must include at least one letter or number.`,
      value
    );
  }

  return slug.slice(0, maxLength);
};

const normalizeStringArrayFromUnknown = (value, options = {}) => {
  const maxItems = options.maxItems || 20;
  const maxLength = options.maxLength || 80;

  const input = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  const seen = new Set();
  const normalized = [];

  for (const rawItem of input) {
    const item = normalizeText(rawItem, maxLength);
    if (!item) continue;

    const key = item.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(item);

    if (normalized.length >= maxItems) break;
  }

  return normalized;
};

const normalizeTagsFromUnknown = (tags) =>
  normalizeStringArrayFromUnknown(tags, {
    maxItems: 30,
    maxLength: 40
  });

export const normalizeTier = (value, options = {}) => {
  const allowEmpty = options.allowEmpty !== false;
  const text = normalizeText(value, 80);

  if (!text) {
    if (allowEmpty) return "";
    throw helpers.inputError("'tier' is required.", value);
  }

  return normalizeSlug(text, 50, "tier");
};

const toDisplayLabelFromTierKey = (tierKey) => {
  return String(tierKey || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
};

export const normalizeTierConfigsInput = (value, options = {}) => {
  const maxItems = options.maxItems || 12;
  const normalized = [];
  const seen = new Set();

  let input = [];
  if (Array.isArray(value)) {
    input = value;
  } else if (typeof value === "string") {
    input = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  for (const rawItem of input) {
    if (normalized.length >= maxItems) break;

    let tierKey = "";
    let label = "";
    let amount = null;

    if (typeof rawItem === "string") {
      tierKey = normalizeTier(rawItem, { allowEmpty: false });
      label = normalizeText(rawItem, 60) || toDisplayLabelFromTierKey(tierKey);
    } else if (rawItem && typeof rawItem === "object" && !Array.isArray(rawItem)) {
      const candidateKey = rawItem.id ?? rawItem.key ?? rawItem.tier ?? rawItem.name;
      const candidateLabel = rawItem.label ?? rawItem.name ?? rawItem.title;
      const candidateAmount = rawItem.amount ?? rawItem.defaultAmount ?? rawItem.price;

      tierKey = normalizeTier(candidateKey || candidateLabel || "", {
        allowEmpty: false
      });
      label = normalizeText(candidateLabel || "", 60) || toDisplayLabelFromTierKey(tierKey);
      amount = normalizeAmount(candidateAmount, "tier.amount");
      if (amount === undefined) amount = null;
    } else {
      throw helpers.inputError("'tierConfigs' items must be strings or objects.", {
        tierConfig: rawItem
      });
    }

    if (seen.has(tierKey)) continue;
    seen.add(tierKey);

    normalized.push({
      id: tierKey,
      label: label.slice(0, 60) || toDisplayLabelFromTierKey(tierKey),
      amount
    });
  }

  return normalized;
};

const normalizeStoredTierConfigs = (value) => {
  const input = Array.isArray(value) ? value : [];
  const normalized = [];
  const seen = new Set();

  for (const rawItem of input) {
    try {
      const [parsed] = normalizeTierConfigsInput([rawItem], { maxItems: 1 });
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      normalized.push(parsed);
    } catch {
      continue;
    }
  }

  return normalized;
};

export const getEventTierConfigs = (event) => {
  const normalized = normalizeStoredTierConfigs(event?.tierConfigs);
  const seen = new Set(normalized.map((tier) => tier.id));

  const packageTiers = Array.isArray(event?.packageTiers) ? event.packageTiers : [];
  for (const rawTier of packageTiers) {
    try {
      const tierKey = normalizeTier(rawTier || "", { allowEmpty: false });
      if (seen.has(tierKey)) continue;
      seen.add(tierKey);
      normalized.push({
        id: tierKey,
        label: toDisplayLabelFromTierKey(tierKey),
        amount: null
      });
    } catch {
      continue;
    }
  }

  return normalized;
};

export const getTierAmountForEvent = (event, tierKey) => {
  const normalizedTier = normalizeTier(tierKey, { allowEmpty: true });
  if (!normalizedTier) return null;

  const tierConfig = getEventTierConfigs(event).find((tier) => tier.id === normalizedTier);
  if (!tierConfig) return null;

  return typeof tierConfig.amount === "number" && Number.isFinite(tierConfig.amount)
    ? tierConfig.amount
    : null;
};

const normalizeBooleanValue = (value, fieldName) => {
  if (typeof value !== "boolean") {
    throw helpers.inputError(`'${fieldName}' must be a boolean.`, {
      [fieldName]: value
    });
  }
  return value;
};

const normalizeAmount = (value, fieldName = "amount") => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw helpers.inputError(`'${fieldName}' must be a non-negative number.`, {
      [fieldName]: value
    });
  }

  return Math.round(amount * 100) / 100;
};

const normalizeDate = (value, fieldName, options = {}) => {
  const allowEmpty = options.allowEmpty !== false;

  if (value === undefined) return undefined;
  if (value === null || value === "") {
    if (allowEmpty) return null;
    throw helpers.inputError(`'${fieldName}' is required.`, { [fieldName]: value });
  }

  const normalized = normalizeText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw helpers.inputError(`'${fieldName}' must be in YYYY-MM-DD format.`, {
      [fieldName]: value
    });
  }

  return normalized;
};

const normalizeIsoDateTime = (value, fieldName, options = {}) => {
  const allowEmpty = options.allowEmpty !== false;

  if (value === undefined) return undefined;
  if (value === null || value === "") {
    if (allowEmpty) return null;
    throw helpers.inputError(`'${fieldName}' is required.`, { [fieldName]: value });
  }

  const normalized = normalizeText(value, 64);
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw helpers.inputError(`'${fieldName}' must be a valid ISO date/time.`, {
      [fieldName]: value
    });
  }

  return date.toISOString();
};

const normalizeYear = (value, fieldName = "year", options = {}) => {
  const required = options.required !== false;

  if (value === undefined || value === null || value === "") {
    if (!required) return undefined;
    throw helpers.inputError(`'${fieldName}' is required.`, { [fieldName]: value });
  }

  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw helpers.inputError(`'${fieldName}' must be a valid year.`, {
      [fieldName]: value
    });
  }

  return year;
};

const normalizeCustomStatus = (status) => normalizeSlug(status, 60, "status");

export const normalizeStatus = (status, options = {}) => {
  const allowCustom = Boolean(options.allowCustom);
  const raw = normalizeText(status, 80).toLowerCase();
  if (!raw) return DEFAULT_PARTNERSHIP_STATUS;

  const canonical = STATUS_ALIASES[raw];
  if (canonical) return canonical;

  if (allowCustom) {
    return normalizeCustomStatus(raw);
  }

  throw helpers.inputError(
    `Invalid partnership status '${status}'.`,
    PARTNERSHIP_STATUSES
  );
};

export const normalizeStoredStatus = (status) => {
  try {
    return normalizeStatus(status, { allowCustom: true });
  } catch {
    return DEFAULT_PARTNERSHIP_STATUS;
  }
};

const normalizeDocType = (value) => {
  const raw = normalizeText(value, 60).toLowerCase();
  if (!raw) return DEFAULT_DOCUMENT_TYPE;
  return normalizeSlug(raw, 50, "documentType");
};

const normalizeDocStatus = (value) => {
  const raw = normalizeText(value, 60).toLowerCase();
  if (!raw) return DEFAULT_DOCUMENT_STATUS;
  return normalizeSlug(raw, 50, "documentStatus");
};

const normalizeCommunicationChannel = (value) => {
  const raw = normalizeText(value, 60).toLowerCase();
  if (!raw) return DEFAULT_COMMUNICATION_CHANNEL;
  return normalizeSlug(raw, 40, "channel");
};

const normalizeCommunicationDirection = (value) => {
  const raw = normalizeText(value, 60).toLowerCase();
  if (!raw) return DEFAULT_COMMUNICATION_DIRECTION;

  const normalized = normalizeSlug(raw, 40, "direction");
  if (normalized !== "inbound" && normalized !== "outbound") {
    throw helpers.inputError("'direction' must be 'inbound' or 'outbound'.", {
      direction: value
    });
  }
  return normalized;
};

export const mergeAlumniTag = (tags = [], isAlumni = false) => {
  const normalized = normalizeTagsFromUnknown(tags).filter(
    (tag) => tag.toLowerCase() !== ALUMNI_TAG
  );

  if (isAlumni) {
    normalized.push(ALUMNI_TAG);
  }

  return normalized;
};

export const parseJsonBody = (event) => {
  try {
    return event?.body ? JSON.parse(event.body) : {};
  } catch {
    throw helpers.inputError("Invalid JSON in request body.", event?.body);
  }
};

export const normalizePartnerInput = (data, options = {}) => {
  const partial = Boolean(options.partial);

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw helpers.inputError("Request body must be a JSON object.", data);
  }

  const partner = {};

  if (!partial || Object.prototype.hasOwnProperty.call(data, "company")) {
    const company = normalizeText(data.company, 140);
    if (!company) {
      throw helpers.inputError("'company' is required.", data);
    }
    partner.company = company;
  }

  if (Object.prototype.hasOwnProperty.call(data, "email")) {
    const email = normalizeText(data.email, 180).toLowerCase();
    if (email && !isValidEmail(email)) {
      throw helpers.inputError("'email' is invalid.", data);
    }
    partner.email = email;
  }

  if (Object.prototype.hasOwnProperty.call(data, "contactName")) {
    partner.contactName = normalizeText(data.contactName, 120);
  }

  if (Object.prototype.hasOwnProperty.call(data, "phone")) {
    partner.phone = normalizeText(data.phone, 60);
  }

  if (Object.prototype.hasOwnProperty.call(data, "contactRole")) {
    partner.contactRole = normalizeText(data.contactRole, 80);
  }

  if (Object.prototype.hasOwnProperty.call(data, "linkedin")) {
    partner.linkedin = normalizeText(data.linkedin, 300);
  }

  if (Object.prototype.hasOwnProperty.call(data, "tier")) {
    partner.tier = normalizeTier(data.tier);
  }

  if (Object.prototype.hasOwnProperty.call(data, "notes")) {
    partner.notes = normalizeText(data.notes, 5000);
  }

  if (Object.prototype.hasOwnProperty.call(data, "tags")) {
    partner.tags = normalizeTagsFromUnknown(data.tags);
  }

  if (Object.prototype.hasOwnProperty.call(data, "isAlumni")) {
    partner.isAlumni = normalizeBooleanValue(data.isAlumni, "isAlumni");
  }

  if (Object.prototype.hasOwnProperty.call(data, "archived")) {
    partner.archived = normalizeBooleanValue(data.archived, "archived");
  }

  return partner;
};

export const normalizePartnershipEventInput = (data, options = {}) => {
  const partial = Boolean(options.partial);

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw helpers.inputError("Request body must be a JSON object.", data);
  }

  const event = {};

  if (!partial || Object.prototype.hasOwnProperty.call(data, "name")) {
    const name = normalizeText(data.name, 140);
    if (!name) {
      throw helpers.inputError("'name' is required.", data);
    }
    event.name = name;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(data, "year")) {
    event.year = normalizeYear(data.year, "year");
  }

  if (Object.prototype.hasOwnProperty.call(data, "startDate")) {
    event.startDate = normalizeDate(data.startDate, "startDate");
  }

  if (Object.prototype.hasOwnProperty.call(data, "endDate")) {
    event.endDate = normalizeDate(data.endDate, "endDate");
  }

  if (Object.prototype.hasOwnProperty.call(data, "outreachStartDate")) {
    event.outreachStartDate = normalizeDate(
      data.outreachStartDate,
      "outreachStartDate"
    );
  }

  if (Object.prototype.hasOwnProperty.call(data, "sponsorshipGoal")) {
    event.sponsorshipGoal = normalizeAmount(data.sponsorshipGoal, "sponsorshipGoal");
  }

  if (Object.prototype.hasOwnProperty.call(data, "packageTiers")) {
    const packageTiers = normalizeStringArrayFromUnknown(data.packageTiers, {
      maxItems: 12,
      maxLength: 50
    }).map((tier) => normalizeTier(tier, { allowEmpty: false }));

    const existingConfigs = Array.isArray(event.tierConfigs) ? event.tierConfigs : [];
    const existingIds = new Set(existingConfigs.map((tier) => tier.id));
    for (const tier of packageTiers) {
      if (existingIds.has(tier)) continue;
      existingConfigs.push({
        id: tier,
        label: getTierLabel(tier),
        amount: null
      });
    }

    event.packageTiers = packageTiers;
    event.tierConfigs = existingConfigs;
  }

  if (Object.prototype.hasOwnProperty.call(data, "tierConfigs")) {
    const tierConfigs = normalizeTierConfigsInput(data.tierConfigs, {
      maxItems: 12
    });
    event.tierConfigs = tierConfigs;
    event.packageTiers = tierConfigs.map((tier) => tier.id);
  }

  if (Object.prototype.hasOwnProperty.call(data, "notes")) {
    event.notes = normalizeText(data.notes, 5000);
  }

  if (Object.prototype.hasOwnProperty.call(data, "linkedMainEventId")) {
    event.linkedMainEventId = normalizeText(data.linkedMainEventId, 80);
  }

  if (Object.prototype.hasOwnProperty.call(data, "linkedMainEventYear")) {
    event.linkedMainEventYear = normalizeYear(
      data.linkedMainEventYear,
      "linkedMainEventYear",
      { required: false }
    );
  }

  if (Object.prototype.hasOwnProperty.call(data, "archived")) {
    event.archived = normalizeBooleanValue(data.archived, "archived");
  }

  return event;
};

export const normalizePartnerEventInput = (data, options = {}) => {
  const partial = Boolean(options.partial);

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw helpers.inputError("Request body must be a JSON object.", data);
  }

  const partnerEvent = {};

  if (!partial || Object.prototype.hasOwnProperty.call(data, "eventId")) {
    const eventId = normalizeText(data.eventId, 120);
    if (!eventId) {
      throw helpers.inputError("'eventId' is required.", data);
    }
    partnerEvent.eventId = eventId;
  }

  if (Object.prototype.hasOwnProperty.call(data, "eventYear")) {
    partnerEvent.eventYear = normalizeYear(data.eventYear, "eventYear", {
      required: false
    });
  }

  if (!partial || Object.prototype.hasOwnProperty.call(data, "status")) {
    partnerEvent.status = normalizeStatus(data.status, { allowCustom: true });
  }

  const packageTierInput = Object.prototype.hasOwnProperty.call(
    data,
    "packageTier"
  )
    ? data.packageTier
    : Object.prototype.hasOwnProperty.call(data, "tier")
      ? data.tier
      : undefined;

  if (packageTierInput !== undefined) {
    partnerEvent.packageTier = normalizeTier(packageTierInput);
  }

  if (Object.prototype.hasOwnProperty.call(data, "role")) {
    partnerEvent.role = normalizeText(data.role, 80);
  }

  if (Object.prototype.hasOwnProperty.call(data, "notes")) {
    partnerEvent.notes = normalizeText(data.notes, 3000);
  }

  if (Object.prototype.hasOwnProperty.call(data, "amount")) {
    partnerEvent.amount = normalizeAmount(data.amount);
  }

  if (Object.prototype.hasOwnProperty.call(data, "followUpDate")) {
    partnerEvent.followUpDate = normalizeDate(data.followUpDate, "followUpDate");
  }

  return partnerEvent;
};

export const normalizePartnerDocumentInput = (data, options = {}) => {
  const partial = Boolean(options.partial);

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw helpers.inputError("Request body must be a JSON object.", data);
  }

  const document = {};

  if (!partial || Object.prototype.hasOwnProperty.call(data, "title")) {
    const title = normalizeText(data.title, 160);
    if (!title) {
      throw helpers.inputError("'title' is required.", data);
    }
    document.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(data, "type")) {
    document.type = normalizeDocType(data.type);
  }

  if (Object.prototype.hasOwnProperty.call(data, "status")) {
    document.status = normalizeDocStatus(data.status);
  }

  if (Object.prototype.hasOwnProperty.call(data, "url")) {
    document.url = normalizeText(data.url, 600);
  }

  if (Object.prototype.hasOwnProperty.call(data, "fileName")) {
    document.fileName = normalizeText(data.fileName, 180);
  }

  if (Object.prototype.hasOwnProperty.call(data, "notes")) {
    document.notes = normalizeText(data.notes, 3000);
  }

  if (Object.prototype.hasOwnProperty.call(data, "eventId")) {
    document.eventId = normalizeText(data.eventId, 120);
  }

  if (Object.prototype.hasOwnProperty.call(data, "eventYear")) {
    document.eventYear = normalizeYear(data.eventYear, "eventYear", {
      required: false
    });
  }

  return document;
};

export const normalizePartnerCommunicationInput = (data, options = {}) => {
  const partial = Boolean(options.partial);

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw helpers.inputError("Request body must be a JSON object.", data);
  }

  const communication = {};

  if (!partial || Object.prototype.hasOwnProperty.call(data, "summary")) {
    const summary = normalizeText(data.summary, 3000);
    if (!summary) {
      throw helpers.inputError("'summary' is required.", data);
    }
    communication.summary = summary;
  }

  if (Object.prototype.hasOwnProperty.call(data, "subject")) {
    communication.subject = normalizeText(data.subject, 180);
  }

  if (Object.prototype.hasOwnProperty.call(data, "channel")) {
    communication.channel = normalizeCommunicationChannel(data.channel);
  }

  if (Object.prototype.hasOwnProperty.call(data, "direction")) {
    communication.direction = normalizeCommunicationDirection(data.direction);
  }

  if (Object.prototype.hasOwnProperty.call(data, "occurredAt")) {
    communication.occurredAt = normalizeIsoDateTime(
      data.occurredAt,
      "occurredAt"
    );
  }

  if (Object.prototype.hasOwnProperty.call(data, "followUpDate")) {
    communication.followUpDate = normalizeDate(data.followUpDate, "followUpDate");
  }

  if (Object.prototype.hasOwnProperty.call(data, "eventId")) {
    communication.eventId = normalizeText(data.eventId, 120);
  }

  if (Object.prototype.hasOwnProperty.call(data, "eventYear")) {
    communication.eventYear = normalizeYear(data.eventYear, "eventYear", {
      required: false
    });
  }

  return communication;
};

export const parseBooleanQuery = (value) => {
  if (value === undefined || value === null || value === "") return null;

  const normalized = String(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  return null;
};

export const toEventIdYear = (eventId, eventYear) => `${eventId}#${eventYear}`;

export const sortPartners = (partners) => {
  return [...partners].sort((a, b) => {
    const companyA = normalizeText(a.company, 140).toLowerCase();
    const companyB = normalizeText(b.company, 140).toLowerCase();
    if (companyA !== companyB) {
      return companyA > companyB ? 1 : -1;
    }

    const contactA = normalizeText(a.contactName, 120).toLowerCase();
    const contactB = normalizeText(b.contactName, 120).toLowerCase();
    if (contactA !== contactB) {
      return contactA > contactB ? 1 : -1;
    }

    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
};

export const sortLinksNewestFirst = (links) => {
  return [...links].sort((a, b) => {
    const bTime = b.updatedAt || b.createdAt || 0;
    const aTime = a.updatedAt || a.createdAt || 0;
    return bTime - aTime;
  });
};

export const sortByUpdatedNewest = (items) => {
  return [...(items || [])].sort((a, b) => {
    const bTime = b.updatedAt || b.createdAt || 0;
    const aTime = a.updatedAt || a.createdAt || 0;
    return bTime - aTime;
  });
};

export const buildPartnerSearchIndex = (partner) => {
  const parts = [
    partner.company,
    partner.contactName,
    partner.email,
    partner.phone,
    partner.contactRole,
    partner.tier,
    partner.notes,
    ...(Array.isArray(partner.tags) ? partner.tags : [])
  ];

  return parts.filter(Boolean).join(" ").toLowerCase();
};

export const buildStatusCounts = (links) => {
  const counts = {};

  for (const link of links) {
    const status = normalizeStoredStatus(
      link.status || DEFAULT_PARTNERSHIP_STATUS
    );
    counts[status] = (counts[status] || 0) + 1;
  }

  return counts;
};

export const buildPackageTierCounts = (links) => {
  const counts = {};

  for (const link of links || []) {
    const tier = normalizeTier(link.packageTier || "");
    if (!tier) continue;
    counts[tier] = (counts[tier] || 0) + 1;
  }

  return counts;
};

export const getStatusLabel = (status) => {
  return String(status || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
};

export const getTierLabel = (tier) => {
  return String(tier || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
};
