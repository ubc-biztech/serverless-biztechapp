import { BTX_PRICES_TABLE, BTX_PROJECTS_TABLE } from "../../constants/tables";
import db from "../../lib/db.js";
import type { WriteBuilder } from "../../lib/db/build/WriteBuilder.js";
import { SEED_PRICE_CENTS } from "./constants";
import { buildProjectId } from "./helpers";
import type { BtxProject } from "./types";

/** Create-once company and INITIAL price writes, for the caller's team-creation transaction. */
export function buildInitialCompany(input: {
  eventId: string;
  teamId: string;
  companyName: string;
}): WriteBuilder[] {
  const initialPriceTs = Date.now();
  const company: BtxProject = {
    projectId: buildProjectId(input.eventId, input.teamId),
    eventId: input.eventId,
    teamId: input.teamId,
    companyName: input.companyName,
    blurb: "",
    youtubeURL: "",
    currentPriceCents: SEED_PRICE_CENTS,
    netShares: 0,
    seedSharesAtIpo: null,
    seedStartedAt: null,
    seedEndsAt: null,
    version: 0,
    // Team cleanup deletes the INITIAL price point by this key
    initialPriceTs,
    lastPriceTs: initialPriceTs,
  };
  return [
    db.build.put(BTX_PROJECTS_TABLE, company).if("projectId").notExists(),
    db.build.put(BTX_PRICES_TABLE, {
      projectId: company.projectId,
      ts: initialPriceTs,
      priceCents: SEED_PRICE_CENTS,
      source: "INITIAL",
    }).if("projectId").notExists(),
  ];
}
