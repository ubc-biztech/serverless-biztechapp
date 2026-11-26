import { QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import { BtxError, buildMarketPhaseCheck, configuredEvent, getEventConfig } from "./helpers";
import { listProjectsForIpo } from "./repos/projects";
import { PRICES_TABLE, PROJECTS_TABLE } from "./repos/tables";
import { publishMarketUpdate } from "./sockets";
import type { BtxEventConfig, BtxPricePoint, BtxProject } from "./types";

async function inspectCompany(project: BtxProject, ipoAt: number) {
  const points: BtxPricePoint[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(new QueryCommand({
      TableName: PRICES_TABLE, ConsistentRead: true,
      KeyConditionExpression: "projectId = :id AND ts >= :ipo",
      ExpressionAttributeValues: { ":id": project.projectId, ":ipo": ipoAt },
      ExclusiveStartKey: start
    }));
    points.push(...(page.Items || []) as BtxPricePoint[]);
    start = page.LastEvaluatedKey;
  } while (start);
  return { project, points };
}

async function restoreCompany(config: BtxEventConfig, project: BtxProject, points: BtxPricePoint[]) {
  const { projectId } = project;
  const prior = await docClient.send(new QueryCommand({
    TableName: PRICES_TABLE, ConsistentRead: true,
    KeyConditionExpression: "projectId = :id AND ts < :ipo",
    ExpressionAttributeValues: { ":id": projectId, ":ipo": config.ipoAt },
    ScanIndexForward: false, Limit: 1
  }));
  const seed = prior.Items?.[0];
  if (!seed) throw new BtxError(503, "Missing pre-IPO price history for " + projectId);

  // Keep the IPO row until the listing and its last history deletion commit together.
  const deletes = points.map(point => ({ Delete: {
    TableName: PRICES_TABLE, Key: { projectId, ts: point.ts }
  } }));
  while (deletes.length > 98) {
    await docClient.send(new TransactWriteCommand({ TransactItems: [
      buildMarketPhaseCheck(config).build(), ...deletes.splice(-98)
    ] }));
  }
  await docClient.send(new TransactWriteCommand({ TransactItems: [
    buildMarketPhaseCheck(config).build(),
    { Update: {
      TableName: PROJECTS_TABLE, Key: { projectId },
      UpdateExpression: "SET currentPriceCents = :price, lastPriceTs = :ts, updatedAt = :now, seedSharesAtIpo = :null REMOVE lastScheduledTickTs ADD version :one",
      ConditionExpression: "lastPriceTs = :last",
      ExpressionAttributeValues: { ":price": seed.priceCents, ":ts": seed.ts, ":now": Date.now(),
        ":last": project.lastPriceTs, ":null": null, ":one": 1 }
    } },
    ...deletes
  ] }));
}

async function changePhase(config: BtxEventConfig, phase: BtxEventConfig["phase"], lastReset?: BtxEventConfig["lastReset"]) {
  const reopen = phase === "PRE_IPO";
  await docClient.send(new UpdateCommand({
    TableName: PROJECTS_TABLE, Key: { projectId: config.projectId },
    UpdateExpression: reopen
      ? "SET phase = :phase, previousIpoAt = :ipo, ipoAt = :null, lastReset = :result REMOVE ipoPriceTs"
      : lastReset ? "SET phase = :phase, lastReset = :result" : "SET phase = :phase",
    ConditionExpression: "phase = :old AND ipoAt = :ipo",
    ExpressionAttributeValues: { ":phase": phase, ":old": config.phase, ":ipo": config.ipoAt,
      ...(lastReset ? { ":result": lastReset } : {}),
      ...(reopen ? { ":null": null } : {}) }
  }));
}

export async function resetIpo(ipoAt: number) {
  let config = await getEventConfig();
  if (config.ipoAt !== ipoAt || (config.phase !== "LIVE" && config.phase !== "IPO_RESETTING")) {
    return; // An earlier FIFO command already superseded this IPO.
  }
  if (config.phase === "LIVE") {
    await changePhase(config, "IPO_RESETTING");
    config = { ...config, phase: "IPO_RESETTING" };
  }

  // Trade fills and ticks condition their writes on the phase, so history is stable.
  const projects = await listProjectsForIpo();
  const companies = [];
  for (let i = 0; i < projects.length; i += 8) {
    companies.push(...await Promise.all(projects.slice(i, i + 8).map(p => inspectCompany(p, ipoAt))));
  }
  for (const { points } of companies) {
    const conflict = points.some(({ ts, source }) =>
      ts === ipoAt ? source !== "IPO" : source !== "NOISE" && source !== "TRADE"
    );
    if (conflict) {
      await changePhase(config, "LIVE", {
        ipoAt, status: "DECLINED", message: "Reset declined because the price history needs reconciliation."
      });
      return;
    }
  }
  // Restore the price series while carrying netShares and the trade ledger into seed.
  // Restore transactions all check the same market row, so run them in sequence.
  for (const { project, points } of companies) {
    if (project.seedSharesAtIpo != null) await restoreCompany(config, project, points);
  }
  await changePhase(config, "PRE_IPO", { ipoAt, status: "SUCCEEDED" });
  await publishMarketUpdate({ eventId: configuredEvent(), phase: "SEED", ipoAt: null, serverTime: Date.now() });
}
