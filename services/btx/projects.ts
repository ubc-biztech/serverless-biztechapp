import { BTX_PRICES_TABLE, BTX_PROJECTS_TABLE } from "../../constants/tables";
import db from "../../lib/db.js";
import type { WriteBuilder } from "../../lib/db/build/WriteBuilder.js";
import { SEED_PRICE_CENTS } from "./marketConstants";
import type { CompanyProfile } from "./companyProfile";

/** Company profile and initial market state stored in bizBtxProjects. */
export interface BtxCompanyRecord extends CompanyProfile {
  projectId: string;
  eventId: string;
  teamId: string;
  netShares: number;
  seedSharesAtIpo: number | null;
  seedStartedAt: string | null;
  seedEndsAt: string | null;
  version: number;
  /** Immutable key of the company's INITIAL history point (Unix milliseconds). */
  initialPriceTs: number;
  /** Latest history timestamp; market writes advance this to avoid collisions. */
  lastPriceTs: number;
}

/** One ID rule shared by company creation and team API responses. */
export const getCompanyProjectId = (eventId: string, teamId: string): string =>
  `${eventId}:${teamId}`;

/** Prepare create-once company/history writes for the caller's transaction. */
export function buildInitialCompany(input: {
  eventId: string;
  teamId: string;
  companyName: string;
}): WriteBuilder[] {
  const initialPriceTs = Date.now();
  const company: BtxCompanyRecord = {
    projectId: getCompanyProjectId(input.eventId, input.teamId),
    eventId: input.eventId,
    teamId: input.teamId,
    companyName: input.companyName,
    blurb: "",
    youtubeURL: "",
    twitterURL: "",
    netShares: 0,
    seedSharesAtIpo: null,
    seedStartedAt: null,
    seedEndsAt: null,
    version: 0,
    initialPriceTs,
    lastPriceTs: initialPriceTs,
  };
  return [
    db.build.put(BTX_PROJECTS_TABLE, { ...company }).if("projectId").notExists(),
    db.build.put(BTX_PRICES_TABLE, {
      projectId: company.projectId,
      ts: initialPriceTs,
      price: SEED_PRICE_CENTS,
      source: "INITIAL",
    }).if("projectId").notExists(),
  ];
}
