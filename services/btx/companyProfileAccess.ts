import { BTX_PROJECTS_TABLE, TEAMS_TABLE, USER_REGISTRATIONS_TABLE } from "../../constants/tables";
import db, { field } from "../../lib/db.js";
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
  const item = await db.getOneCustom({
    TableName: BTX_PROJECTS_TABLE + suffix,
    Key: { projectId },
    ConsistentRead: true,
  });
  if (!item || item.eventId !== configuredEvent() || typeof item.teamId !== "string" ||
      !/^\d{6}$/.test(item.teamId) || projectId !== buildProjectId(item.eventId, item.teamId)) {
    throw new CompanyProfileAccessError(404, "Company not found.");
  }
  const company = item as CompanyProfileContext["company"];
  const [config, registration, team] = await Promise.all([
    { table: BTX_PROJECTS_TABLE, key: { projectId: configProjectId(company.eventId) } },
    { table: USER_REGISTRATIONS_TABLE, key: { id: userID, "eventID;year": company.eventId } },
    { table: TEAMS_TABLE, key: { id: company.teamId, "eventID;year": company.eventId } },
  ].map(({ table, key }) => db.getOneCustom({
    TableName: table + suffix,
    Key: key,
    ConsistentRead: true,
  })));
  return {
    userID,
    company,
    config: config ?? undefined,
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

function hasCompanyMarketState({ company, config }: CompanyProfileContext): boolean {
  if (company.seedStartedAt === undefined) return false;
  if (company.seedSharesAtIpo !== undefined) return true;

  // Earlier resets removed the IPO snapshot field when they reopened the market.
  const reset = config?.lastReset;
  return config?.phase === "PRE_IPO" && config.ipoAt === null && reset?.status === "SUCCEEDED" &&
    Number.isSafeInteger(reset.ipoAt) && reset.ipoAt === config.previousIpoAt;
}

function nameIsLocked({ company, config }: CompanyProfileContext): boolean {
  return company.seedStartedAt !== null || company.netShares > 0 || company.seedSharesAtIpo != null ||
    config?.phase !== "PRE_IPO" || config.ipoAt !== null;
}

function requiresCompleteProfile(context: CompanyProfileContext): boolean {
  const { company } = context;
  // Unfinished companies may save partial progress after global IPO until seeding/IPO initialization.
  return company.seedStartedAt !== null || company.seedSharesAtIpo != null ||
    (nameIsLocked(context) && isCompanyProfileComplete(company));
}

/** Missing configuration or market state disables editing; profiles remain viewable. */
export function getCompanyProfilePermissions(context: CompanyProfileContext, now = Date.now()) {
  const end = eventEnd(context.config);
  const canEdit = context.isMember && hasCompanyMarketState(context) && end !== null && now < end;
  return {
    canEdit,
    canEditName: canEdit && !nameIsLocked(context),
    eventEndsAt: end,
  };
}

export function requireCompanyProfileEdit(context: CompanyProfileContext, now = Date.now()) {
  const { config } = context;
  if (!context.isMember) {
    throw new CompanyProfileAccessError(403, "Current team membership is required.");
  }
  if (!hasCompanyMarketState(context)) {
    throw new CompanyProfileAccessError(503, "Company state is unavailable. Please contact an organizer.");
  }
  const end = eventEnd(config);
  if (end === null || !config) {
    throw new CompanyProfileAccessError(503, "Company profile editing is not configured. Please contact an organizer.");
  }
  if (now >= end) {
    throw new CompanyProfileAccessError(409, "Company profile editing has closed for this event.");
  }
  return { config, end };
}

/** Prepare a targeted update and its transaction checks using fresh context and backend time. */
export function buildCompanyProfileSave(context: CompanyProfileContext, patch: CompanyProfilePatch, now = Date.now()): WriteBuilder[] {
  const { company, userID } = context;
  const { config } = requireCompanyProfileEdit(context, now);
  const nameLocked = nameIsLocked(context);
  if (patch.companyName !== undefined && patch.companyName !== company.companyName && nameLocked) {
    throw new CompanyProfileAccessError(409, "The company name is locked once it receives funding or IPO begins.");
  }
  const profile = { ...toCompanyProfile(company), ...patch };
  if (requiresCompleteProfile(context) && !isCompanyProfileComplete(profile)) {
    throw new CompanyProfileAccessError(409, "Company name, blurb, and a valid YouTube link must remain complete.");
  }

  const configCheck = db.build.check(BTX_PROJECTS_TABLE, { projectId: configProjectId(company.eventId) })
    .if("phase").equals(config.phase)
    .if("ipoAt").equals(config.ipoAt);
  const restoreMissingSnapshot = company.seedSharesAtIpo === undefined;
  const update = db.build.update(BTX_PROJECTS_TABLE, { projectId: company.projectId },
    restoreMissingSnapshot ? { ...patch, seedSharesAtIpo: null } : patch)
    .if("projectId").exists()
    .if("eventId").equals(company.eventId)
    .if("teamId").equals(company.teamId)
    .if("seedStartedAt").equals(company.seedStartedAt);
  if (!nameLocked) {
    update.anyOf(field("netShares").notExists(), field("netShares").equals(0));
  }
  if (restoreMissingSnapshot) {
    configCheck.if("previousIpoAt").equals(config.previousIpoAt);
    update.if("seedSharesAtIpo").notExists();
  } else {
    update.if("seedSharesAtIpo").equals(company.seedSharesAtIpo);
  }
  // Compare the profile we validated to prevent concurrent edits from invalidating the merged result.
  // Market version is deliberately independent; a price change alone need not reject this edit.
  for (const field of ["companyName", "blurb", "youtubeURL", "twitterURL", "logo", "demoURL"] as const) {
    if (company[field] === undefined) update.if(field).notExists();
    else update.if(field).equals(company[field]);
  }
  return [
    db.build.check(USER_REGISTRATIONS_TABLE, { id: userID, "eventID;year": company.eventId })
      .if("teamID").equals(company.teamId),
    db.build.check(TEAMS_TABLE, { id: company.teamId, "eventID;year": company.eventId })
      .if("member_ids").contains(userID),
    configCheck,
    update,
  ];
}
