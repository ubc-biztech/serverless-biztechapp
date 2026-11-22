import { BTX_PRICES_TABLE, BTX_PROJECTS_TABLE } from "../../constants/tables";
import db from "../../lib/db.js";
import type { WriteBuilder } from "../../lib/db/build/WriteBuilder.js";
import { BtxError, buildMarketPhaseCheck, buildProjectId, getEventConfig } from "./helpers";
import type { BtxEventConfig } from "./types";

export class TeamFormationError extends Error {
  constructor(public statusCode: 409 | 503, message: string) {
    super(message);
    this.name = "TeamFormationError";
  }
}

const getCompany = (projectId: string) => db.getOneCustom({
  TableName: BTX_PROJECTS_TABLE + (process.env.ENVIRONMENT || ""),
  Key: { projectId },
  ConsistentRead: true,
});

/** Deletes an unused company and its INITIAL price point. Every market write bumps version. */
export async function getUnusedCompanyDeletes(eventId: string, teamId: string): Promise<WriteBuilder[]> {
  const projectId = buildProjectId(eventId, teamId);
  const company = await getCompany(projectId);
  if (!company) throw new TeamFormationError(503, "This team's company is unavailable. Please contact an organizer.");
  return [
    db.build.delete(BTX_PROJECTS_TABLE, { projectId }).if("version").equals(0),
    db.build.delete(BTX_PRICES_TABLE, { projectId, ts: company.initialPriceTs }),
  ];
}

/** Membership changes are open only before IPO, and for a team only until it starts seeding. */
export async function getTeamFormationChecks(eventId: string, teamId?: string): Promise<WriteBuilder[]> {
  let config: BtxEventConfig;
  try {
    config = await getEventConfig(eventId);
  } catch (error) {
    if (error instanceof BtxError) throw new TeamFormationError(503, error.message);
    throw error;
  }
  if (config.phase !== "PRE_IPO") {
    throw new TeamFormationError(409, "Team membership changes are closed during and after IPO. Please contact an organizer.");
  }

  const checks: WriteBuilder[] = [buildMarketPhaseCheck(config)];
  if (teamId === undefined) return checks;

  const projectId = buildProjectId(eventId, teamId);
  const company = await getCompany(projectId);
  if (!company) throw new TeamFormationError(503, "This team's company is unavailable. Please contact an organizer.");
  if (company.seedStartedAt !== null) {
    throw new TeamFormationError(409, "Team membership is locked once a company starts seeding.");
  }
  checks.push(db.build.check(BTX_PROJECTS_TABLE, { projectId }).if("seedStartedAt").equals(null));
  return checks;
}
