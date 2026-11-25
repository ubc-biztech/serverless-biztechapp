import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import { MIN_PRICE_CENTS, NOISE_MAX_PCT } from "./constants";
import { buildMarketPhaseCheck, eventEndsAtMs, getEventConfig } from "./helpers";
import { launchIpo } from "./market";
import { getProject, listProjectsForEvent } from "./repos/projects";
import { PRICES_TABLE, PROJECTS_TABLE } from "./repos/tables";
import { enqueueMarketCommand, processTrade } from "./trades";
import { publishMarketUpdate } from "./sockets";
import type { MarketCommand } from "./types";

interface PendingTradeStreamRecord {
  eventName: string;
  dynamodb: { Keys: { projectId: { S: string }; tradeId: { S: string } } };
}

export async function enqueuePendingTrades(event: { Records: PendingTradeStreamRecord[] }) {
  const [record] = event.Records;
  if (record.eventName !== "INSERT") return;
  const { projectId, tradeId } = record.dynamodb.Keys;
  await enqueueMarketCommand({ type: "TRADE", projectId: projectId.S, tradeId: tradeId.S });
}

export async function processMarketQueue(event: { Records: { body: string }[] }) {
  // One group, one consumer, one command per invocation.
  const command: MarketCommand = JSON.parse(event.Records[0].body);
  switch (command.type) {
    case "TRADE":
      await processTrade(command.projectId, command.tradeId);
      break;
    case "TICK":
      await processCompanyTick(command.projectId, command.scheduledTickTs);
      break;
    case "IPO":
      await launchIpo(command.previousIpoAt);
      break;
  }
}

export async function marketTick(event?: { time?: string }) {
  const projects = await listProjectsForEvent();
  let scheduledTime = Date.now();
  if (event?.time) scheduledTime = Date.parse(event.time);
  const scheduledTickTs = Math.floor(scheduledTime / 60000) * 60000;

  for (const project of projects) {
    await enqueueMarketCommand({
      type: "TICK",
      projectId: project.projectId,
      scheduledTickTs
    });
  }
}

async function processCompanyTick(projectId: string, scheduledTickTs: number) {
  const [project, config] = await Promise.all([
    getProject(projectId),
    getEventConfig()
  ]);

  if (config.phase !== "LIVE") {
    return;
  }

  if (
    project.lastScheduledTickTs &&
    project.lastScheduledTickTs >= scheduledTickTs
  ) {
    return;
  }

  const now = Date.now();
  if (now >= eventEndsAtMs()) {
    return;
  }

  const priceChangePct = (Math.random() * 2 - 1) * NOISE_MAX_PCT;
  const currentPriceCents = Math.round(
    Math.max(MIN_PRICE_CENTS, project.currentPriceCents * (1 + priceChangePct))
  );
  const ts = Math.max(now, project.lastPriceTs + 1);
  
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        buildMarketPhaseCheck(config).build(),
        {
          Update: {
            TableName: PROJECTS_TABLE,
            Key: { projectId },
            UpdateExpression:
              "SET currentPriceCents = :price, lastPriceTs = :ts, updatedAt = :now, lastScheduledTickTs = :tick ADD version :one",
            ExpressionAttributeValues: {
              ":price": currentPriceCents,
              ":ts": ts,
              ":now": now,
              ":tick": scheduledTickTs,
              ":one": 1
            }
          }
        },
        {
          Put: {
            TableName: PRICES_TABLE,
            Item: { projectId, ts, priceCents: currentPriceCents, source: "NOISE" },
            ConditionExpression: "attribute_not_exists(projectId)"
          }
        }
      ]
    })
  );
  await publishMarketUpdate({
    projectId,
    eventId: project.eventId,
    priceCents: currentPriceCents,
    asOf: ts,
    ipoAt: config.ipoAt
  });
}
