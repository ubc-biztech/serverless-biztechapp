import { BTX_PRICES_TABLE, BTX_PROJECTS_TABLE } from "../../constants/tables";
import db, { field } from "../../lib/db.js";
import type { WriteBuilder } from "../../lib/db/build/WriteBuilder.js";
import { getCompanyProjectId } from "./projects";
import { SEED_PRICE_CENTS } from "./constants";
import { BtxError, buildMarketPhaseCheck, getEventConfig } from "./helpers";
import type { BtxEventConfig } from "./types";

/** Workflow 3/event setup creates this item before team formation is enabled.
 * IPO_PREPARING closes formation before ipoAt is set. Missing config fails closed.
 */
export type BtxEventConfigRecord = BtxEventConfig;

export class TeamFormationError extends Error {
  constructor(public statusCode: 409 | 503, message: string) {
    super(message);
    this.name = "TeamFormationError";
  }
}

export const getBtxEventConfigId = (eventId: string): string => `config:${eventId}`;

/** Shared conditions for either checking a company or deleting an unused one. */
const requireUnstartedCompany = (write: WriteBuilder, eventId: string, teamId: string): WriteBuilder =>
  write.if("projectId").exists()
    .if("eventId").equals(eventId)
    .if("teamId").equals(teamId)
    .if("seedStartedAt").equals(null)
    .if("seedEndsAt").equals(null);

/** Creation's market version is zero; every Workflow 3 market mutation must advance it.
 * Also reject legacy trade/funding counters, even if current holdings returned to zero.
 * Delete only its known INITIAL point alongside the unused company. Never delete history
 * by querying a whole company partition. These builders run in the membership transaction.
 */
export async function getUnusedCompanyDeletes(eventId: string, teamId: string): Promise<WriteBuilder[]> {
  const projectId = getCompanyProjectId(eventId, teamId);
  const company = await db.getOneCustom({
    TableName: BTX_PROJECTS_TABLE + (process.env.ENVIRONMENT || ""),
    Key: { projectId },
    ConsistentRead: true,
  });
  if (!company || company.eventId !== eventId || company.teamId !== teamId ||
      !Number.isSafeInteger(company.initialPriceTs) || company.initialPriceTs < 0) {
    throw new TeamFormationError(503, "This team's company history is unavailable. Please contact an organizer.");
  }
  const initialPriceTs: number = company.initialPriceTs;
  const companyDelete = requireUnstartedCompany(
    db.build.delete(BTX_PROJECTS_TABLE, { projectId }),
    eventId, teamId,
  )
    .if("version").equals(0)
    .if("netShares").equals(0)
    .if("seedSharesAtIpo").equals(null)
    .if("initialPriceTs").equals(initialPriceTs)
    .if("lastPriceTs").equals(initialPriceTs)
    .anyOf(field("totalTrades").notExists(), field("totalTrades").equals(0))
    .anyOf(field("seedAmount").notExists(), field("seedAmount").equals(0));
  const initialPriceDelete = db.build.delete(BTX_PRICES_TABLE, { projectId, ts: initialPriceTs })
    .if("source").equals("INITIAL")
    .if("priceCents").equals(SEED_PRICE_CENTS);
  return [companyDelete, initialPriceDelete];
}

/** Read current availability and prepare the same checks for the membership transaction. */
export async function getTeamFormationChecks(eventId: string, teamId?: string): Promise<WriteBuilder[]> {
  const table = BTX_PROJECTS_TABLE + (process.env.ENVIRONMENT || "");
  let config: BtxEventConfig;
  try {
    config = await getEventConfig(eventId);
  } catch (error) {
    if (error instanceof BtxError) throw new TeamFormationError(503, error.message);
    throw error;
  }
  if (config.phase !== "PRE_IPO" || config.ipoAt !== null) {
    throw new TeamFormationError(409, "Team membership changes are closed during and after IPO. Please contact an organizer.");
  }

  const checks: WriteBuilder[] = [
    buildMarketPhaseCheck(config),
  ];
  if (teamId === undefined) return checks;

  const projectId = getCompanyProjectId(eventId, teamId);
  const company = await db.getOneCustom({
    TableName: table,
    Key: { projectId },
    ConsistentRead: true,
  });
  if (!company || company.eventId !== eventId || company.teamId !== teamId ||
      company.seedStartedAt === undefined || company.seedEndsAt === undefined) {
    throw new TeamFormationError(503, "This team's company is unavailable. Please contact an organizer.");
  }
  if (company.seedStartedAt !== null || company.seedEndsAt !== null) {
    throw new TeamFormationError(409, "Team membership is locked once a company starts seeding.");
  }

  checks.push(
    requireUnstartedCompany(db.build.check(BTX_PROJECTS_TABLE, { projectId }), eventId, teamId),
  );
  return checks;
}
