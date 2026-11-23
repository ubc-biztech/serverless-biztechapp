import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { BTX_PROJECTS_TABLE, TEAMS_TABLE, USER_REGISTRATIONS_TABLE } from "../../constants/tables";
import db from "../../lib/db.js";
import docClient from "../../lib/docClient.js";
import type { WriteBuilder } from "../../lib/db/build/WriteBuilder.js";
import { isCompanyProfileComplete, toCompanyProfile } from "./companyProfile";
import type { CompanyProfile, CompanyProfilePatch } from "./companyProfile";
import { buildProjectId, configuredEvent, configProjectId, eventEndsAtMs } from "./helpers";
import type { BtxProject, BtxEventConfig } from "./types";

export class CompanyProfileAccessError extends Error {
  constructor(public statusCode: 403 | 404 | 409 | 503, message: string) {
    super(message);
    this.name = "CompanyProfileAccessError";
  }
}

export interface CompanyProfileContext {
  userID: string;
  company: BtxProject & CompanyProfile & { teamId: string };
  config: Partial<BtxEventConfig> | undefined;
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
  if (!Item || Item.eventId !== configuredEvent() || typeof Item.teamId !== "string" ||
      !/^\d{6}$/.test(Item.teamId) || projectId !== buildProjectId(Item.eventId, Item.teamId)) {
    throw new CompanyProfileAccessError(404, "Company not found.");
  }
  const company = Item as CompanyProfileContext["company"];
  const [config, registration, team] = await Promise.all([
    { table: BTX_PROJECTS_TABLE, key: { projectId: configProjectId(company.eventId) } },
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

function eventEnd(config: CompanyProfileContext["config"]): number | null {
  if (!config || !["PRE_IPO", "IPO_PREPARING", "LIVE"].includes(config.phase ?? "") ||
      (config.ipoAt !== null && !Number.isFinite(config.ipoAt))) return null;
  const end = eventEndsAtMs();
  return Number.isFinite(end) ? end : null;
}

function hasCompanyMarketState(company: CompanyProfileContext["company"]): boolean {
  return company.seedStartedAt !== undefined && company.seedSharesAtIpo !== undefined;
}

function nameIsLocked({ company, config }: CompanyProfileContext): boolean {
  return company.seedStartedAt !== null || company.seedSharesAtIpo !== null ||
    config?.phase !== "PRE_IPO" || config.ipoAt !== null;
}

function requiresCompleteProfile(context: CompanyProfileContext): boolean {
  const { company } = context;
  // Unfinished companies may save partial progress after global IPO until seeding/IPO initialization.
  return company.seedStartedAt !== null || company.seedSharesAtIpo !== null ||
    (nameIsLocked(context) && isCompanyProfileComplete(company));
}

/** Missing configuration or market state disables editing; profiles remain viewable. */
export function getCompanyProfilePermissions(context: CompanyProfileContext, now = Date.now()) {
  const end = eventEnd(context.config);
  const canEdit = context.isMember && hasCompanyMarketState(context.company) && end !== null && now < end;
  return {
    canEdit,
    canEditName: canEdit && !nameIsLocked(context),
    eventEndsAt: end,
  };
}

/** Prepare, but do not execute, a targeted update and its transaction checks.
 * The caller must load fresh context and use backend time for every save attempt.
 */
export function buildCompanyProfileSave(context: CompanyProfileContext, patch: CompanyProfilePatch, now = Date.now()): WriteBuilder[] {
  const { company, config, userID } = context;
  if (!context.isMember) {
    throw new CompanyProfileAccessError(403, "Current team membership is required.");
  }
  if (!hasCompanyMarketState(company)) {
    throw new CompanyProfileAccessError(503, "Company state is unavailable. Please contact an organizer.");
  }
  const end = eventEnd(config);
  if (end === null || !config) {
    throw new CompanyProfileAccessError(503, "Company profile editing is not configured. Please contact an organizer.");
  }
  if (now >= end) {
    throw new CompanyProfileAccessError(409, "Company profile editing has closed for this event.");
  }
  if (patch.companyName !== undefined && patch.companyName !== company.companyName && nameIsLocked(context)) {
    throw new CompanyProfileAccessError(409, "The company name is locked once seeding or IPO begins.");
  }
  const profile = { ...toCompanyProfile(company), ...patch };
  if (requiresCompleteProfile(context) && !isCompanyProfileComplete(profile)) {
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
    db.build.check(USER_REGISTRATIONS_TABLE, { id: userID, "eventID;year": company.eventId })
      .if("teamID").equals(company.teamId),
    db.build.check(TEAMS_TABLE, { id: company.teamId, "eventID;year": company.eventId })
      .if("member_ids").contains(userID),
    db.build.check(BTX_PROJECTS_TABLE, { projectId: configProjectId(company.eventId) })
      .if("phase").equals(config.phase)
      .if("ipoAt").equals(config.ipoAt),
    update,
  ];
}
