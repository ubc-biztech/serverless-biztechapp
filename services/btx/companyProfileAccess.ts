import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { BTX_PROJECTS_TABLE, TEAMS_TABLE, USER_REGISTRATIONS_TABLE } from "../../constants/tables";
import { KICKSTART_EVENT_KEY } from "../../constants/kickstart";
import db from "../../lib/db.js";
import docClient from "../../lib/docClient.js";
import type { WriteBuilder } from "../../lib/db/build/WriteBuilder.js";
import { isCompanyProfileComplete, toCompanyProfile, validateCompanyProfilePatch } from "./companyProfile";
import { getCompanyProjectId } from "./projects";
import type { BtxCompanyRecord } from "./projects";
import { getBtxEventConfigId } from "./teamFormation";
import type { BtxEventConfigRecord } from "./teamFormation";

export class CompanyProfileAccessError extends Error {
  constructor(public statusCode: 403 | 404 | 409 | 503, message: string) {
    super(message);
    this.name = "CompanyProfileAccessError";
  }
}

export interface CompanyProfileContext {
  userID: string;
  company: BtxCompanyRecord;
  config: Partial<BtxEventConfigRecord> | undefined;
  isMember: boolean;
}

/** The endpoint must first verify the signed-in identity. Viewing needs no event registration. */
export async function loadCompanyProfileContext(projectId: string, userID: string): Promise<CompanyProfileContext> {
  const suffix = process.env.ENVIRONMENT || "";
  const { Item } = await docClient.send(new GetCommand({
    TableName: BTX_PROJECTS_TABLE + suffix,
    Key: { projectId },
    ConsistentRead: true,
  }));
  if (!Item || Item.eventId !== KICKSTART_EVENT_KEY || typeof Item.teamId !== "string" ||
      !/^\d{6}$/.test(Item.teamId) || projectId !== getCompanyProjectId(Item.eventId, Item.teamId)) {
    throw new CompanyProfileAccessError(404, "Company not found.");
  }
  const company = Item as BtxCompanyRecord;
  const [config, registration, team] = await Promise.all([
    { table: BTX_PROJECTS_TABLE, key: { projectId: getBtxEventConfigId(company.eventId) } },
    { table: USER_REGISTRATIONS_TABLE, key: { id: userID, "eventID;year": company.eventId } },
    { table: TEAMS_TABLE, key: { id: company.teamId, "eventID;year": company.eventId } },
  ].map(async ({ table, key }) => {
    const result = await docClient.send(new GetCommand({ TableName: table + suffix, Key: key, ConsistentRead: true }));
    return result.Item;
  }));
  return {
    userID,
    company,
    config,
    isMember: registration?.teamID === company.teamId &&
      team?.member_ids instanceof Set && team.member_ids.has(userID),
  };
}

/** Accept exact UTC timestamps, rather than a date interpreted in the server's timezone. */
function utcTime(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z")
    ? time : null;
}

function eventEnd(config: CompanyProfileContext["config"]): number | null {
  if (!config || !["PRE_IPO", "IPO_PREPARING", "LIVE"].includes(config.phase ?? "") ||
      (config.ipoAt !== null && utcTime(config.ipoAt) === null)) return null;
  return utcTime(config.eventEndsAt);
}

function nameIsLocked({ company, config }: CompanyProfileContext): boolean {
  return company.seedStartedAt !== null || company.seedSharesAtIpo !== null ||
    config?.phase !== "PRE_IPO" || config.ipoAt !== null;
}

/** Missing configuration disables editing, but does not hide a visible company profile. */
export function getCompanyProfilePermissions(context: CompanyProfileContext, now = Date.now()) {
  const end = eventEnd(context.config);
  const canEdit = context.isMember && end !== null && now < end;
  return {
    canEdit,
    canEditName: canEdit && !nameIsLocked(context),
    eventEndsAt: end === null ? null : context.config?.eventEndsAt ?? null,
  };
}

/** Prepare, but do not execute, a targeted update and its transaction checks.
 * The caller must load fresh context and use backend time for every save attempt.
 */
export function buildCompanyProfileSave(context: CompanyProfileContext, value: unknown, now = Date.now()): WriteBuilder[] {
  const { company, config, userID } = context;
  if (!context.isMember) {
    throw new CompanyProfileAccessError(403, "Current team membership is required.");
  }
  const end = eventEnd(config);
  if (end === null || !config) {
    throw new CompanyProfileAccessError(503, "Company profile editing is not configured. Please contact an organizer.");
  }
  if (now >= end) {
    throw new CompanyProfileAccessError(409, "Company profile editing has closed for this event.");
  }
  const patch = validateCompanyProfilePatch(value);
  if (patch.companyName !== undefined && patch.companyName !== company.companyName && nameIsLocked(context)) {
    throw new CompanyProfileAccessError(409, "The company name is locked once seeding or IPO begins.");
  }
  const profile = { ...toCompanyProfile(company), ...patch };
  // Late unfinished companies can still complete their profile after global IPO.
  // A seeded/initialized company, or an already complete post-IPO profile, cannot become incomplete.
  const mustStayComplete = company.seedStartedAt !== null || company.seedSharesAtIpo !== null ||
    (nameIsLocked(context) && isCompanyProfileComplete(company));
  if (mustStayComplete && !isCompanyProfileComplete(profile)) {
    throw new CompanyProfileAccessError(409, "Company name, blurb, and a valid YouTube link must remain complete.");
  }

  const update = db.build.update(BTX_PROJECTS_TABLE, { projectId: company.projectId }, patch)
    .if("projectId").exists()
    .if("eventId").equals(company.eventId)
    .if("teamId").equals(company.teamId)
    .if("seedStartedAt").equals(company.seedStartedAt)
    .if("seedSharesAtIpo").equals(company.seedSharesAtIpo);
  // Compare the profile we validated to prevent concurrent edits from invalidating the merged result.
  // Market version is deliberately independent; a price change alone need not reject this edit.
  for (const field of ["companyName", "blurb", "youtubeURL", "twitterURL"] as const) {
    if (company[field] === undefined) update.if(field).notExists();
    else update.if(field).equals(company[field]);
  }
  return [
    db.build.conditionCheck(USER_REGISTRATIONS_TABLE, { id: userID, "eventID;year": company.eventId })
      .if("teamID").equals(company.teamId),
    db.build.conditionCheck(TEAMS_TABLE, { id: company.teamId, "eventID;year": company.eventId })
      .if("member_ids").contains(userID),
    db.build.conditionCheck(BTX_PROJECTS_TABLE, { projectId: getBtxEventConfigId(company.eventId) })
      .if("phase").equals(config.phase)
      .if("ipoAt").equals(config.ipoAt)
      .if("eventEndsAt").equals(config.eventEndsAt),
    update,
  ];
}
