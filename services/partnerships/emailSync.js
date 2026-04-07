import crypto from "crypto";
import db from "../../lib/db";
import helpers from "../../lib/handlerHelpers";
import { isValidEmail } from "../../lib/utils";
import {
  PARTNERS_TABLE,
  PARTNERSHIP_EVENTS_TABLE,
  PARTNER_COMMUNICATIONS_TABLE,
  PARTNERSHIPS_META_TABLE
} from "../../constants/tables";
import { normalizeText, toEventIdYear } from "./helpers";

const EMAIL_SYNC_PROVIDER = "gmail";
const EMAIL_SYNC_STATUS_ROW_ID = "partnerships_email_sync_status";
const EMAIL_SYNC_STATUS_ENTITY_TYPE = "partnerships_email_sync_status";
const MAX_ENTRIES_PER_INGEST = 500;
const MAX_UNMATCHED_EMAILS = 25;
const MAX_ENTRY_ERRORS = 15;

const toLowerEmail = (value) => normalizeText(value, 200).toLowerCase();

const parseBooleanEnv = (value, defaultValue = false) => {
  const normalized = normalizeText(value, 20).toLowerCase();
  if (!normalized) return defaultValue;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
};

const getSyncConfig = () => {
  const enabled = parseBooleanEnv(process.env.PARTNERSHIPS_EMAIL_SYNC_ENABLED, true);
  const explicitIngestUrl = normalizeText(
    process.env.PARTNERSHIPS_EMAIL_SYNC_INGEST_URL,
    1200
  );
  const allowedDomainsRaw = normalizeText(
    process.env.PARTNERSHIPS_EMAIL_SYNC_ALLOWED_DOMAINS,
    500
  );

  const allowedDomains = (allowedDomainsRaw || "ubcbiztech.com")
    .split(",")
    .map((value) => normalizeText(value, 120).toLowerCase())
    .filter(Boolean);

  return {
    provider: EMAIL_SYNC_PROVIDER,
    enabled,
    allowedDomains,
    explicitIngestUrl
  };
};

const getHeaderValue = (headers = {}, key = "") => {
  const target = normalizeText(key, 120).toLowerCase();
  if (!target) return "";

  for (const [headerName, headerValue] of Object.entries(headers || {})) {
    if (normalizeText(headerName, 120).toLowerCase() !== target) continue;
    return normalizeText(headerValue, 1000);
  }

  return "";
};

const getIngestUrlFromEvent = (event, config) => {
  if (config.explicitIngestUrl) return config.explicitIngestUrl;

  const host =
    getHeaderValue(event?.headers, "x-forwarded-host") ||
    getHeaderValue(event?.headers, "host");
  const protocol = getHeaderValue(event?.headers, "x-forwarded-proto") || "https";
  const basePath = normalizeText(event?.requestContext?.path, 400);

  if (!host) return "";

  const marker = "/partnerships/email/sync/status";
  if (basePath && basePath.includes(marker)) {
    return `${protocol}://${host}${basePath.replace(
      marker,
      "/partnerships/email/sync/ingest"
    )}`;
  }

  const stage = normalizeText(event?.requestContext?.stage, 40);
  if (stage && host.includes("localhost")) {
    return `${protocol}://${host}/${stage}/partnerships/email/sync/ingest`;
  }

  return `${protocol}://${host}/partnerships/email/sync/ingest`;
};

const parseEmailList = (value) => {
  const items = Array.isArray(value) ? value : [value];
  const emails = new Set();
  const regex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

  for (const rawItem of items) {
    const text = normalizeText(rawItem, 3000);
    if (!text) continue;

    const matches = text.match(regex) || [];
    for (const match of matches) {
      const email = toLowerEmail(match);
      if (!email || !isValidEmail(email)) continue;
      emails.add(email);
    }
  }

  return Array.from(emails.values());
};

const normalizeDirection = (value, fallback = "outbound") => {
  const normalized = normalizeText(value, 60).toLowerCase();
  if (normalized === "inbound" || normalized === "outbound") return normalized;
  return fallback;
};

const normalizeOccurredAt = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
};

const normalizeActorEmail = (value) => {
  const email = toLowerEmail(value);
  if (!email || !isValidEmail(email)) return "";
  return email;
};

const toEntryArray = (payload) => {
  if (Array.isArray(payload?.entries)) return payload.entries;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") return [payload];
  return [];
};

const normalizeIncomingEntry = (rawEntry, defaultActorEmail = "") => {
  const subject = normalizeText(
    rawEntry?.subject || rawEntry?.title || rawEntry?.snippetSubject,
    180
  );
  const summary = normalizeText(
    rawEntry?.summary ||
      rawEntry?.snippet ||
      rawEntry?.bodySnippet ||
      rawEntry?.preview ||
      rawEntry?.bodyPreview,
    3000
  );

  const fromEmails = parseEmailList(
    rawEntry?.fromEmail || rawEntry?.from || rawEntry?.sender || rawEntry?.senderEmail
  );
  const toEmails = parseEmailList(
    rawEntry?.toEmails || rawEntry?.to || rawEntry?.recipients || rawEntry?.recipientEmails
  );
  const ccEmails = parseEmailList(rawEntry?.ccEmails || rawEntry?.cc);
  const bccEmails = parseEmailList(rawEntry?.bccEmails || rawEntry?.bcc);

  const actorEmail =
    normalizeActorEmail(rawEntry?.actorEmail || rawEntry?.userEmail) ||
    normalizeActorEmail(defaultActorEmail);

  const directionFallback =
    actorEmail && fromEmails.includes(actorEmail) ? "outbound" : "inbound";

  const direction = normalizeDirection(rawEntry?.direction, directionFallback);
  const occurredAt = normalizeOccurredAt(rawEntry?.occurredAt || rawEntry?.date || rawEntry?.timestamp);
  const messageId = normalizeText(
    rawEntry?.externalMessageId ||
      rawEntry?.messageId ||
      rawEntry?.gmailMessageId ||
      rawEntry?.id,
    240
  );
  const threadId = normalizeText(
    rawEntry?.externalThreadId || rawEntry?.threadId || rawEntry?.gmailThreadId,
    240
  );

  const provider = normalizeText(
    rawEntry?.provider || rawEntry?.sourceProvider || EMAIL_SYNC_PROVIDER,
    60
  ).toLowerCase();
  const sourceMethod = normalizeText(
    rawEntry?.source || rawEntry?.sourceMethod || "gmail_apps_script",
    80
  ).toLowerCase();

  const eventId = normalizeText(rawEntry?.eventId, 120);
  const eventYear = Number(rawEntry?.eventYear);

  return {
    provider: provider || EMAIL_SYNC_PROVIDER,
    sourceMethod: sourceMethod || "gmail_apps_script",
    direction,
    subject,
    summary,
    occurredAt,
    messageId,
    threadId,
    actorEmail,
    fromEmails,
    toEmails,
    ccEmails,
    bccEmails,
    eventId: eventId || null,
    eventYear: Number.isInteger(eventYear) ? eventYear : null
  };
};

const buildPartnerLookup = async () => {
  const partners = await db.scan(PARTNERS_TABLE);
  const byEmail = new Map();

  for (const partner of partners || []) {
    if (!partner?.id) continue;
    const email = toLowerEmail(partner.email);
    if (!email || !isValidEmail(email)) continue;

    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, partner);
      continue;
    }

    // Prefer active records when duplicate emails exist.
    if (existing.archived && !partner.archived) {
      byEmail.set(email, partner);
    }
  }

  return byEmail;
};

const toStatusMessage = (statusCode = 200) => {
  if (statusCode >= 400) return "Last sync failed.";
  return "Ready to receive synced Gmail activity.";
};

const getStatusSnapshot = async () => {
  const row = await db.getOne(EMAIL_SYNC_STATUS_ROW_ID, PARTNERSHIPS_META_TABLE);
  if (!row || row.entityType !== EMAIL_SYNC_STATUS_ENTITY_TYPE) {
    return null;
  }
  return row;
};

const upsertStatusSnapshot = async (update) => {
  const now = Date.now();
  const existing = await getStatusSnapshot();

  if (!existing) {
    const row = {
      id: EMAIL_SYNC_STATUS_ROW_ID,
      entityType: EMAIL_SYNC_STATUS_ENTITY_TYPE,
      createdAt: now,
      updatedAt: now,
      ...update
    };
    await db.create(row, PARTNERSHIPS_META_TABLE);
    return row;
  }

  await db.updateDB(
    existing.id,
    {
      ...update,
      updatedAt: now
    },
    PARTNERSHIPS_META_TABLE
  );

  return db.getOne(existing.id, PARTNERSHIPS_META_TABLE);
};

const assertIngestAuthorized = (event, config) => {
  void event;

  if (!config.enabled) {
    throw helpers.createResponse(403, {
      message: "Partnership email sync is disabled."
    });
  }
};

const isEmailAllowedByDomain = (email, allowedDomains = []) => {
  if (!email) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const domain = parts[1].toLowerCase();
  return allowedDomains.includes(domain);
};

const buildCandidatePartnerEmails = (entry) => {
  if (entry.direction === "inbound") {
    return Array.from(new Set(entry.fromEmails));
  }

  const outbound = [...entry.toEmails, ...entry.ccEmails, ...entry.bccEmails];
  return Array.from(new Set(outbound));
};

const selectSenderEmail = (entry) => {
  if (entry.direction === "inbound") {
    return entry.fromEmails[0] || entry.actorEmail || "";
  }

  return entry.actorEmail || entry.fromEmails[0] || "";
};

const selectRecipientEmail = (entry, matchedPartnerEmail) => {
  if (entry.direction === "inbound") {
    return matchedPartnerEmail;
  }

  return matchedPartnerEmail;
};

const createDeterministicCommunicationId = (
  entry,
  partnerId,
  matchedPartnerEmail
) => {
  const keyMaterial = [
    entry.provider,
    entry.messageId,
    entry.threadId,
    entry.direction,
    entry.occurredAt,
    entry.subject,
    partnerId,
    matchedPartnerEmail
  ]
    .filter(Boolean)
    .join("::");

  const digest = crypto.createHash("sha1").update(keyMaterial).digest("hex");
  return `sync::${entry.provider}::${partnerId}::${digest.slice(0, 20)}`;
};

const isConditionalCreateError = (error) => {
  if (!error) return false;

  if (normalizeText(error.type, 120) === "ConditionalCheckFailedException") {
    return true;
  }

  const body = normalizeText(error.body, 1000);
  return body.includes("ConditionalCheckFailedException");
};

const resolveEventPatch = async (entry, eventCache) => {
  if (!entry.eventId) {
    return {
      eventId: null,
      eventYear: null,
      eventIdYear: null,
      eventName: null
    };
  }

  if (!eventCache.has(entry.eventId)) {
    const row = await db.getOne(entry.eventId, PARTNERSHIP_EVENTS_TABLE);
    eventCache.set(entry.eventId, row || null);
  }

  const linkedEvent = eventCache.get(entry.eventId);
  if (!linkedEvent) {
    return {
      eventId: null,
      eventYear: null,
      eventIdYear: null,
      eventName: null
    };
  }

  return {
    eventId: linkedEvent.id,
    eventYear: linkedEvent.year,
    eventIdYear: toEventIdYear(linkedEvent.id, linkedEvent.year),
    eventName: linkedEvent.name || null
  };
};

const buildSummaryText = (entry, senderEmail, recipientEmail) => {
  const directionLabel = entry.direction === "inbound" ? "Inbound" : "Outbound";
  const summary = normalizeText(entry.summary, 2500);

  if (summary) {
    return normalizeText(summary, 3000);
  }

  return normalizeText(
    `${directionLabel} email synced automatically. ${senderEmail || "Unknown sender"} -> ${recipientEmail || "Unknown recipient"}.`,
    3000
  );
};

const toEntryError = (entryIndex, reason, details = {}) => ({
  entryIndex,
  reason,
  details
});

const emptySummary = () => ({
  received: 0,
  processed: 0,
  imported: 0,
  duplicates: 0,
  unmatched: 0,
  skipped: 0,
  errors: 0
});

export const getEmailSyncStatus = async (event) => {
  const config = getSyncConfig();
  const snapshot = await getStatusSnapshot();

  return {
    provider: config.provider,
    enabled: config.enabled,
    configured: config.enabled,
    ingestUrl: getIngestUrlFromEvent(event, config),
    allowedDomains: config.allowedDomains,
    message: snapshot?.message || toStatusMessage(snapshot?.lastIngestStatusCode || 200),
    lastIngestAt: snapshot?.lastIngestAt || null,
    lastSuccessAt: snapshot?.lastSuccessAt || null,
    lastIngestStatusCode: snapshot?.lastIngestStatusCode || null,
    stats: snapshot?.stats || emptySummary(),
    recentActorEmails: Array.isArray(snapshot?.recentActorEmails)
      ? snapshot.recentActorEmails
      : [],
    unmatchedEmails: Array.isArray(snapshot?.unmatchedEmails)
      ? snapshot.unmatchedEmails
      : [],
    recentErrors: Array.isArray(snapshot?.recentErrors) ? snapshot.recentErrors : []
  };
};

export const ingestEmailSync = async (event, payload) => {
  const config = getSyncConfig();
  assertIngestAuthorized(event, config);

  const actorEmailFromPayload = normalizeActorEmail(payload?.actorEmail || payload?.userEmail);
  if (!actorEmailFromPayload) {
    throw helpers.inputError(
      "actorEmail is required for email sync payloads.",
      payload
    );
  }

  if (
    config.allowedDomains.length &&
    !isEmailAllowedByDomain(actorEmailFromPayload, config.allowedDomains)
  ) {
    throw helpers.createResponse(403, {
      message: "actorEmail domain is not allowed for partnerships email sync."
    });
  }

  const entries = toEntryArray(payload);

  if (!entries.length) {
    throw helpers.inputError("No email sync entries were provided.", payload);
  }

  if (entries.length > MAX_ENTRIES_PER_INGEST) {
    throw helpers.inputError(
      `At most ${MAX_ENTRIES_PER_INGEST} email entries can be synced per request.`,
      {
        count: entries.length
      }
    );
  }

  const partnerByEmail = await buildPartnerLookup();
  const eventCache = new Map();

  const summary = emptySummary();
  const unmatchedEmails = new Set();
  const actorEmailsSeen = new Set();
  const recentErrors = [];
  const touchedPartnerIds = new Set();

  summary.received = entries.length;

  for (let index = 0; index < entries.length; index += 1) {
    const rawEntry = entries[index];
    const entry = normalizeIncomingEntry(rawEntry, actorEmailFromPayload);
    if (entry.actorEmail) actorEmailsSeen.add(entry.actorEmail);

    if (
      entry.actorEmail &&
      config.allowedDomains.length &&
      !isEmailAllowedByDomain(entry.actorEmail, config.allowedDomains)
    ) {
      summary.skipped += 1;
      continue;
    }

    const candidatePartnerEmails = buildCandidatePartnerEmails(entry);
    if (!candidatePartnerEmails.length) {
      summary.unmatched += 1;
      recentErrors.push(
        toEntryError(index, "no_candidate_partner_email", {
          direction: entry.direction,
          subject: entry.subject
        })
      );
      continue;
    }

    const matchedPairs = [];
    for (const candidateEmail of candidatePartnerEmails) {
      const partner = partnerByEmail.get(candidateEmail);
      if (!partner?.id) {
        unmatchedEmails.add(candidateEmail);
        continue;
      }

      matchedPairs.push({
        partner,
        matchedPartnerEmail: candidateEmail
      });
    }

    if (!matchedPairs.length) {
      summary.unmatched += 1;
      continue;
    }

    const senderEmail = selectSenderEmail(entry);
    const eventPatch = await resolveEventPatch(entry, eventCache);

    for (const pair of matchedPairs) {
      const recipientEmail = selectRecipientEmail(entry, pair.matchedPartnerEmail);
      const communicationId = createDeterministicCommunicationId(
        entry,
        pair.partner.id,
        pair.matchedPartnerEmail
      );

      const timestamp = Date.now();
      const communication = {
        id: communicationId,
        partnerId: pair.partner.id,
        subject: normalizeText(entry.subject, 180),
        summary: buildSummaryText(entry, senderEmail, recipientEmail),
        channel: "email",
        direction: entry.direction,
        occurredAt: entry.occurredAt,
        followUpDate: null,
        eventId: eventPatch.eventId,
        eventYear: eventPatch.eventYear,
        eventIdYear: eventPatch.eventIdYear,
        eventName: eventPatch.eventName,
        sender: senderEmail || "",
        recipientEmail: recipientEmail || "",
        source: "email_sync",
        sourceProvider: entry.provider,
        sourceMethod: entry.sourceMethod,
        externalMessageId: entry.messageId || null,
        externalThreadId: entry.threadId || null,
        actorEmail: entry.actorEmail || null,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      try {
        await db.create(communication, PARTNER_COMMUNICATIONS_TABLE);
        summary.imported += 1;
        touchedPartnerIds.add(pair.partner.id);
      } catch (error) {
        if (isConditionalCreateError(error)) {
          summary.duplicates += 1;
          continue;
        }

        summary.errors += 1;
        recentErrors.push(
          toEntryError(index, "create_failed", {
            partnerId: pair.partner.id,
            email: pair.matchedPartnerEmail
          })
        );
      }
    }

    summary.processed += 1;
  }

  const statusCode = summary.errors > 0 ? 207 : 200;
  const nowIso = new Date().toISOString();
  const previousSnapshot = await getStatusSnapshot();

  await upsertStatusSnapshot({
    message: toStatusMessage(statusCode),
    lastIngestAt: nowIso,
    lastSuccessAt:
      statusCode < 400
        ? nowIso
        : normalizeText(previousSnapshot?.lastSuccessAt, 80) || null,
    lastIngestStatusCode: statusCode,
    stats: summary,
    recentActorEmails: Array.from(actorEmailsSeen.values()).slice(0, 12),
    unmatchedEmails: Array.from(unmatchedEmails.values()).slice(
      0,
      MAX_UNMATCHED_EMAILS
    ),
    recentErrors: recentErrors.slice(0, MAX_ENTRY_ERRORS)
  });

  return {
    message:
      statusCode === 200
        ? "Email sync completed."
        : "Email sync completed with partial errors.",
    statusCode,
    stats: summary,
    touchedPartnerCount: touchedPartnerIds.size,
    unmatchedEmails: Array.from(unmatchedEmails.values()).slice(0, MAX_UNMATCHED_EMAILS),
    recentErrors: recentErrors.slice(0, MAX_ENTRY_ERRORS)
  };
};
