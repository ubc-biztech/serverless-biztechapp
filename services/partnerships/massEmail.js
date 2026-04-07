import { v4 as uuidv4 } from "uuid";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import db from "../../lib/db";
import helpers from "../../lib/handlerHelpers";
import { sesClient } from "../../lib/sesV2Client";
import { isValidEmail } from "../../lib/utils";
import {
  PARTNERS_TABLE,
  PARTNERSHIP_EVENTS_TABLE,
  PARTNER_COMMUNICATIONS_TABLE,
  PARTNERSHIPS_META_TABLE
} from "../../constants/tables";
import { normalizeText, toEventIdYear } from "./helpers";

const EMAIL_TEMPLATE_ENTITY_TYPE = "partnerships_mass_email_template";
const MAX_RECIPIENTS = 200;
const MAX_TEMPLATES = 200;
const SEND_BATCH_SIZE = 8;
const MERGE_TOKEN_REGEX = /{{\s*([a-z0-9_]+)\s*}}/gi;

const MERGE_FIELDS = [
  {
    key: "recipient_first_name",
    label: "Recipient First Name",
    description: "Partner contact first name"
  },
  {
    key: "recipient_last_name",
    label: "Recipient Last Name",
    description: "Partner contact last name"
  },
  {
    key: "recipient_full_name",
    label: "Recipient Full Name",
    description: "Partner contact full name"
  },
  {
    key: "recipient_email",
    label: "Recipient Email",
    description: "Partner contact email"
  },
  {
    key: "sender_first_name",
    label: "Sender First Name",
    description: "Signed-in sender first name"
  },
  {
    key: "sender_last_name",
    label: "Sender Last Name",
    description: "Signed-in sender last name"
  },
  {
    key: "sender_full_name",
    label: "Sender Full Name",
    description: "Signed-in sender full name"
  },
  {
    key: "sender_email",
    label: "Sender Email",
    description: "Signed-in sender email"
  },
  {
    key: "company_name",
    label: "Company Name",
    description: "Partner company name"
  },
  {
    key: "contact_name",
    label: "Contact Name",
    description: "Partner primary contact name"
  },
  {
    key: "event_name",
    label: "Event Name",
    description: "Selected CRM event name"
  },
  {
    key: "event_year",
    label: "Event Year",
    description: "Selected CRM event year"
  }
];

const MERGE_FIELD_KEYS = new Set(MERGE_FIELDS.map((field) => field.key));

const toLowerEmail = (value) => normalizeText(value, 200).toLowerCase();
const toMergeToken = (key) => `{{${key}}}`;

const normalizeWhitespacedText = (value, maxLength = 180) =>
  normalizeText(value, maxLength).replace(/\s+/g, " ").trim();

const deriveDisplayNameFromEmail = (email = "") => {
  const localPart = String(email || "").split("@")[0] || "";
  return normalizeWhitespacedText(localPart.replace(/[._-]+/g, " "), 180);
};

const splitFullName = (value = "") => {
  const normalized = normalizeWhitespacedText(value, 180);
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

const normalizeActorContext = (actor = "") => {
  const source =
    actor && typeof actor === "object" && !Array.isArray(actor) ? actor : {};

  const email = toLowerEmail(
    typeof actor === "string" ? actor : normalizeWhitespacedText(source.email, 180)
  );

  let firstName = normalizeWhitespacedText(source.firstName, 80);
  let lastName = normalizeWhitespacedText(source.lastName, 120);
  let fullName = normalizeWhitespacedText(source.fullName, 180);

  if (!fullName && (firstName || lastName)) {
    fullName = `${firstName} ${lastName}`.trim();
  }

  if (!fullName && email) {
    fullName = deriveDisplayNameFromEmail(email);
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

const resolveSenderFromActor = (actorEmail) => {
  const sender = toLowerEmail(actorEmail);
  if (!sender || !isValidEmail(sender)) {
    throw helpers.inputError(
      "Unable to determine sender email from the signed-in account.",
      {
        actorEmail
      }
    );
  }
  return sender;
};

const findUnknownMergeTokens = (value, allowedKeys = MERGE_FIELD_KEYS) => {
  const unknown = new Set();

  if (!value) return [];

  let match;
  MERGE_TOKEN_REGEX.lastIndex = 0;

  while ((match = MERGE_TOKEN_REGEX.exec(value)) !== null) {
    const token = String(match[1] || "").toLowerCase();
    if (!token) continue;
    if (!allowedKeys.has(token)) {
      unknown.add(token);
    }
  }

  return Array.from(unknown.values());
};

const assertSupportedMergeTokens = (
  value,
  fieldName,
  allowedKeys = MERGE_FIELD_KEYS
) => {
  const unknown = findUnknownMergeTokens(value, allowedKeys);
  if (!unknown.length) return;

  throw helpers.inputError(
    `'${fieldName}' includes unsupported merge field token(s): ${unknown
      .map((token) => `{{${token}}}`)
      .join(", ")}.`,
    {
      field: fieldName,
      unknownTokens: unknown,
      allowedTokens: Array.from(allowedKeys.values()).map(toMergeToken)
    }
  );
};

const normalizeTemplatePayload = (payload, options = {}) => {
  const partial = Boolean(options.partial);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw helpers.inputError("Request body must be a JSON object.", payload);
  }

  const template = {};

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "name")) {
    const name = normalizeText(payload.name, 100);
    if (!name) {
      throw helpers.inputError("'name' is required.", payload);
    }
    template.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "description")) {
    template.description = normalizeText(payload.description, 300);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "subjectTemplate")) {
    const subjectTemplate = normalizeText(payload.subjectTemplate, 240);
    if (!subjectTemplate) {
      throw helpers.inputError("'subjectTemplate' is required.", payload);
    }
    assertSupportedMergeTokens(subjectTemplate, "subjectTemplate");
    template.subjectTemplate = subjectTemplate;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "bodyTemplate")) {
    const bodyTemplate = normalizeText(payload.bodyTemplate, 12000);
    if (!bodyTemplate) {
      throw helpers.inputError("'bodyTemplate' is required.", payload);
    }
    assertSupportedMergeTokens(bodyTemplate, "bodyTemplate");
    template.bodyTemplate = bodyTemplate;
  }

  return template;
};

const toTemplateResponse = (template) => ({
  id: template.id,
  name: template.name || "",
  description: template.description || "",
  subjectTemplate: template.subjectTemplate || "",
  bodyTemplate: template.bodyTemplate || "",
  archived: Boolean(template.archived),
  createdBy: template.createdBy || "",
  updatedBy: template.updatedBy || "",
  lastUsedAt: template.lastUsedAt || null,
  createdAt: template.createdAt || null,
  updatedAt: template.updatedAt || null
});

const sortTemplatesByUpdatedAt = (templates) => {
  return [...(templates || [])].sort((left, right) => {
    const rightTime = Number(right.updatedAt) || Number(right.createdAt) || 0;
    const leftTime = Number(left.updatedAt) || Number(left.createdAt) || 0;
    return rightTime - leftTime;
  });
};

const listTemplateRows = async (includeArchived = false) => {
  const filters = includeArchived
    ? {
      ExpressionAttributeNames: {
        "#entityType": "entityType"
      },
      ExpressionAttributeValues: {
        ":entityType": EMAIL_TEMPLATE_ENTITY_TYPE
      },
      FilterExpression: "#entityType = :entityType"
    }
    : {
      ExpressionAttributeNames: {
        "#entityType": "entityType",
        "#archived": "archived"
      },
      ExpressionAttributeValues: {
        ":entityType": EMAIL_TEMPLATE_ENTITY_TYPE,
        ":archivedFalse": false
      },
      FilterExpression:
          "#entityType = :entityType AND (attribute_not_exists(#archived) OR #archived = :archivedFalse)"
    };

  const rows = await db.scan(PARTNERSHIPS_META_TABLE, filters);
  return sortTemplatesByUpdatedAt(rows);
};

const getTemplateByIdOrNotFound = async (templateId) => {
  const row = await db.getOne(templateId, PARTNERSHIPS_META_TABLE);
  if (!row || row.entityType !== EMAIL_TEMPLATE_ENTITY_TYPE) {
    throw helpers.notFoundResponse("partnerships mass-email template", templateId);
  }
  return row;
};

const normalizeBulkSendPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw helpers.inputError("Request body must be a JSON object.", payload);
  }

  const subject = normalizeText(payload.subject, 240);
  if (!subject) {
    throw helpers.inputError("'subject' is required.", payload);
  }

  const body = normalizeText(payload.body, 12000);
  if (!body) {
    throw helpers.inputError("'body' is required.", payload);
  }

  assertSupportedMergeTokens(subject, "subject");
  assertSupportedMergeTokens(body, "body");

  const partnerIdsInput = Array.isArray(payload.partnerIds) ? payload.partnerIds : [];
  const dedupedPartnerIds = Array.from(
    new Set(
      partnerIdsInput
        .map((value) => normalizeText(value, 120))
        .filter(Boolean)
    )
  );

  if (!dedupedPartnerIds.length) {
    throw helpers.inputError(
      "'partnerIds' must include at least one partner id.",
      payload
    );
  }

  if (dedupedPartnerIds.length > MAX_RECIPIENTS) {
    throw helpers.inputError(
      `'partnerIds' cannot exceed ${MAX_RECIPIENTS} recipients in one send.`,
      {
        recipientCount: dedupedPartnerIds.length,
        maxRecipients: MAX_RECIPIENTS
      }
    );
  }

  return {
    subject,
    body,
    partnerIds: dedupedPartnerIds,
    eventId: normalizeText(payload.eventId, 120) || "",
    templateId: normalizeText(payload.templateId, 120) || "",
    campaignName: normalizeText(payload.campaignName, 140) || ""
  };
};

const buildMergeValues = (partner, eventRecord, actorContext) => {
  const companyName = normalizeText(partner?.company, 140) || "your organization";
  const rawRecipientName = normalizeWhitespacedText(partner?.contactName, 140);
  const recipientFallbackName = rawRecipientName || companyName || "there";
  const recipientName = splitFullName(recipientFallbackName);

  const actorFirstName = normalizeWhitespacedText(actorContext?.firstName, 80);
  const actorLastName = normalizeWhitespacedText(actorContext?.lastName, 120);
  const actorFullName =
    normalizeWhitespacedText(actorContext?.fullName, 180) ||
    `${actorFirstName} ${actorLastName}`.trim();
  const senderName = splitFullName(actorFullName);

  return {
    company_name: companyName,
    contact_name: recipientName.fullName || recipientFallbackName,
    recipient_first_name:
      recipientName.firstName || recipientName.fullName || "there",
    recipient_last_name: recipientName.lastName || "",
    recipient_full_name: recipientName.fullName || recipientFallbackName,
    recipient_email: toLowerEmail(partner?.email) || "",
    sender_first_name: senderName.firstName || "",
    sender_last_name: senderName.lastName || "",
    sender_full_name: senderName.fullName || "",
    sender_email: toLowerEmail(actorContext?.email) || "",
    event_name: normalizeText(eventRecord?.name, 140) || "",
    event_year:
      eventRecord && Number.isFinite(Number(eventRecord.year))
        ? String(Number(eventRecord.year))
        : ""
  };
};

const renderTemplate = (template, values) => {
  if (!template) return "";
  MERGE_TOKEN_REGEX.lastIndex = 0;

  return template.replace(MERGE_TOKEN_REGEX, (_, tokenRaw) => {
    const token = String(tokenRaw || "").toLowerCase();
    if (!token) return "";
    return values[token] || "";
  });
};

const processInBatches = async (items, batchSize, task) => {
  const results = [];

  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    const batchResults = await Promise.all(batch.map((item) => task(item)));
    results.push(...batchResults);
  }

  return results;
};

const buildCommunicationSummary = ({ sender, recipientEmail, body }) => {
  const header = `Mass email sent from ${sender} to ${recipientEmail}.\n\n`;
  return normalizeText(`${header}${body}`, 3000);
};

const touchTemplateLastUsedAt = async (templateId, actorEmail = "") => {
  if (!templateId) return;

  try {
    const template = await getTemplateByIdOrNotFound(templateId);
    if (template.archived) return;

    await db.updateDB(
      template.id,
      {
        lastUsedAt: new Date().toISOString(),
        updatedBy: actorEmail || template.updatedBy || ""
      },
      PARTNERSHIPS_META_TABLE
    );
  } catch (error) {
    console.error("Unable to update mass email template lastUsedAt.", error);
  }
};

export const getMassEmailConfig = (actor = "") => {
  const actorContext = normalizeActorContext(actor);
  const sender = resolveSenderFromActor(actorContext.email);
  return {
    sender,
    senderFirstName: actorContext.firstName || "",
    senderLastName: actorContext.lastName || "",
    senderFullName: actorContext.fullName || "",
    maxRecipients: MAX_RECIPIENTS,
    mergeFields: MERGE_FIELDS.map((field) => ({
      ...field,
      token: `{{${field.key}}}`
    }))
  };
};

export const listMassEmailTemplates = async () => {
  const rows = await listTemplateRows(false);
  return {
    templates: rows.map(toTemplateResponse)
  };
};

export const createMassEmailTemplate = async (payload, actorEmail = "") => {
  const template = normalizeTemplatePayload(payload);
  const existing = await listTemplateRows(true);

  if (existing.length >= MAX_TEMPLATES) {
    throw helpers.inputError(
      `Template limit reached (${MAX_TEMPLATES}). Archive unused templates before creating more.`,
      {
        maxTemplates: MAX_TEMPLATES
      }
    );
  }

  const timestamp = Date.now();
  const row = {
    id: uuidv4(),
    entityType: EMAIL_TEMPLATE_ENTITY_TYPE,
    name: template.name,
    description: template.description || "",
    subjectTemplate: template.subjectTemplate,
    bodyTemplate: template.bodyTemplate,
    archived: false,
    createdBy: actorEmail || "",
    updatedBy: actorEmail || "",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: null
  };

  await db.create(row, PARTNERSHIPS_META_TABLE);

  return {
    message: "Mass email template created.",
    template: toTemplateResponse(row)
  };
};

export const updateMassEmailTemplate = async (
  templateId,
  payload,
  actorEmail = ""
) => {
  const existing = await getTemplateByIdOrNotFound(templateId);
  const update = normalizeTemplatePayload(payload, { partial: true });

  if (!Object.keys(update).length) {
    throw helpers.inputError(
      "At least one template field must be provided.",
      payload
    );
  }

  await db.updateDB(
    existing.id,
    {
      ...update,
      updatedBy: actorEmail || existing.updatedBy || ""
    },
    PARTNERSHIPS_META_TABLE
  );

  const updated = await getTemplateByIdOrNotFound(existing.id);

  return {
    message: "Mass email template updated.",
    template: toTemplateResponse(updated)
  };
};

export const archiveMassEmailTemplate = async (templateId, actorEmail = "") => {
  const existing = await getTemplateByIdOrNotFound(templateId);

  await db.updateDB(
    existing.id,
    {
      archived: true,
      updatedBy: actorEmail || existing.updatedBy || ""
    },
    PARTNERSHIPS_META_TABLE
  );

  const updated = await getTemplateByIdOrNotFound(existing.id);

  return {
    message: "Mass email template archived.",
    template: toTemplateResponse(updated)
  };
};

export const sendBulkPartnershipEmails = async (payload, actor = "") => {
  const normalized = normalizeBulkSendPayload(payload);
  const actorContext = normalizeActorContext(actor);
  const sender = resolveSenderFromActor(actorContext.email);

  let eventRecord = null;
  if (normalized.eventId) {
    eventRecord = await db.getOne(normalized.eventId, PARTNERSHIP_EVENTS_TABLE);
    if (!eventRecord) {
      throw helpers.notFoundResponse("partnership event", normalized.eventId);
    }
  }

  if (normalized.templateId) {
    const template = await getTemplateByIdOrNotFound(normalized.templateId);
    if (template.archived) {
      throw helpers.inputError("The selected template is archived.", {
        templateId: normalized.templateId
      });
    }
  }

  const partnerRows = await Promise.all(
    normalized.partnerIds.map((partnerId) => db.getOne(partnerId, PARTNERS_TABLE))
  );
  const partnersById = new Map();

  for (const partner of partnerRows) {
    if (partner?.id) {
      partnersById.set(partner.id, partner);
    }
  }

  const sendableTargets = [];
  const precheckResults = [];
  const seenEmails = new Set();

  for (const partnerId of normalized.partnerIds) {
    const partner = partnersById.get(partnerId);
    if (!partner) {
      precheckResults.push({
        partnerId,
        status: "skipped_missing_partner",
        message: "Partner no longer exists."
      });
      continue;
    }

    const recipientEmail = toLowerEmail(partner.email);
    if (!recipientEmail) {
      precheckResults.push({
        partnerId,
        company: partner.company || "",
        contactName: partner.contactName || "",
        status: "skipped_missing_email",
        message: "Partner has no email configured."
      });
      continue;
    }

    if (!isValidEmail(recipientEmail)) {
      precheckResults.push({
        partnerId,
        company: partner.company || "",
        contactName: partner.contactName || "",
        email: recipientEmail,
        status: "skipped_invalid_email",
        message: "Partner email is invalid."
      });
      continue;
    }

    if (seenEmails.has(recipientEmail)) {
      precheckResults.push({
        partnerId,
        company: partner.company || "",
        contactName: partner.contactName || "",
        email: recipientEmail,
        status: "skipped_duplicate_email",
        message: "Another selected partner already uses this email address."
      });
      continue;
    }

    seenEmails.add(recipientEmail);
    sendableTargets.push({
      partner,
      recipientEmail
    });
  }

  if (!sendableTargets.length) {
    return {
      message: "No emails were sent because no selected partners had unique valid emails.",
      summary: {
        totalRequested: normalized.partnerIds.length,
        totalEligible: 0,
        sentCount: 0,
        loggedCount: 0,
        skippedCount: precheckResults.length,
        failedCount: 0,
        warningCount: 0
      },
      results: precheckResults
    };
  }

  const occurredAtIso = new Date().toISOString();
  const occurredAtEpoch = Date.now();
  const campaignId = uuidv4();

  const sendResults = await processInBatches(
    sendableTargets,
    SEND_BATCH_SIZE,
    async ({ partner, recipientEmail }) => {
      const mergeValues = buildMergeValues(partner, eventRecord, actorContext);
      const renderedSubject = normalizeText(
        renderTemplate(normalized.subject, mergeValues),
        240
      );
      const renderedBody = normalizeText(
        renderTemplate(normalized.body, mergeValues),
        12000
      );

      if (!renderedSubject || !renderedBody) {
        return {
          partnerId: partner.id,
          company: partner.company || "",
          contactName: partner.contactName || "",
          email: recipientEmail,
          status: "failed_render",
          message:
            "Rendered subject/body was empty for this recipient. Check merge fields."
        };
      }

      try {
        await sesClient.send(
          new SendEmailCommand({
            FromEmailAddress: sender,
            ReplyToAddresses: [sender],
            Destination: {
              ToAddresses: [recipientEmail]
            },
            Content: {
              Simple: {
                Subject: {
                  Data: renderedSubject,
                  Charset: "UTF-8"
                },
                Body: {
                  Text: {
                    Data: renderedBody,
                    Charset: "UTF-8"
                  }
                }
              }
            }
          })
        );
      } catch (sendError) {
        return {
          partnerId: partner.id,
          company: partner.company || "",
          contactName: partner.contactName || "",
          email: recipientEmail,
          status: "failed_send",
          message:
            sendError?.message || "SES rejected this recipient send attempt."
        };
      }

      const communicationRow = {
        id: uuidv4(),
        partnerId: partner.id,
        subject: normalizeText(renderedSubject, 180),
        summary: buildCommunicationSummary({
          sender,
          recipientEmail,
          body: renderedBody
        }),
        channel: "email",
        direction: "outbound",
        occurredAt: occurredAtIso,
        followUpDate: null,
        eventId: eventRecord?.id || null,
        eventYear: eventRecord?.year || null,
        eventIdYear: eventRecord
          ? toEventIdYear(eventRecord.id, eventRecord.year)
          : null,
        eventName: eventRecord?.name || null,
        sender,
        recipientEmail,
        templateId: normalized.templateId || null,
        campaignId,
        campaignName: normalized.campaignName || null,
        source: "mass_email",
        createdAt: occurredAtEpoch,
        updatedAt: occurredAtEpoch
      };

      try {
        await db.create(communicationRow, PARTNER_COMMUNICATIONS_TABLE);
      } catch (logError) {
        return {
          partnerId: partner.id,
          company: partner.company || "",
          contactName: partner.contactName || "",
          email: recipientEmail,
          status: "warning_log_failed",
          message:
            logError?.message ||
            "Email sent, but communication history could not be written."
        };
      }

      return {
        partnerId: partner.id,
        company: partner.company || "",
        contactName: partner.contactName || "",
        email: recipientEmail,
        status: "sent",
        message: "Sent successfully."
      };
    }
  );

  const results = [...precheckResults, ...sendResults];
  const sentCount = results.filter(
    (result) => result.status === "sent" || result.status === "warning_log_failed"
  ).length;
  const loggedCount = results.filter((result) => result.status === "sent").length;
  const failedCount = results.filter((result) =>
    ["failed_render", "failed_send"].includes(result.status)
  ).length;
  const warningCount = results.filter(
    (result) => result.status === "warning_log_failed"
  ).length;
  const skippedCount = results.filter((result) =>
    result.status.startsWith("skipped_")
  ).length;

  await touchTemplateLastUsedAt(normalized.templateId, actorContext.email);

  return {
    message:
      warningCount > 0
        ? "Bulk email sent with warnings. Some history entries could not be logged."
        : failedCount > 0
          ? "Bulk email finished with partial failures."
          : "Bulk email sent successfully.",
    campaignId,
    summary: {
      totalRequested: normalized.partnerIds.length,
      totalEligible: sendableTargets.length,
      sentCount,
      loggedCount,
      skippedCount,
      failedCount,
      warningCount
    },
    results
  };
};
