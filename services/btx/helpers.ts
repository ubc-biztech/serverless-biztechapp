import { PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { validate as validateUuid, version as uuidVersion } from "uuid";

import docClient from "../../lib/docClient";
import db from "../../lib/db.js";
import { BTX_PROJECTS_TABLE } from "../../constants/tables";
import { PROJECTS_TABLE, SOCKETS_TABLE } from "./repos/tables";
import type { BtxErrorCode, BtxEventConfig } from "./types";

export class BtxError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public data?: Record<string, unknown> & { code?: BtxErrorCode }
  ) {
    super(message);
    this.name = "BtxError";
  }
}

export function requireSafeCents(cents: number, field = "Amount") {
  if (!Number.isSafeInteger(cents))
    throw new BtxError(400, `${field} must be a safe integer in cents`, {
      code: "VALIDATION_ERROR"
    });
  return cents;
}

export function configProjectId(eventId = configuredEvent()) {
  return `config:${eventId}`;
}

export function buildProjectId(eventId: string, teamCode: string) {
  return `${eventId}:${teamCode}`;
}

export function accountId(eventId: string, userId: string) {
  return `${eventId}#${userId}`;
}

export function eventEndsAtMs(): number {
  return Date.parse(process.env.KICKSTART_EVENT_ENDS_AT!);
}

export function isUuidV7(value: unknown): value is string {
  return (
    typeof value === "string" && validateUuid(value) && uuidVersion(value) === 7
  );
}

export function assertUuidV7(tradeId: unknown): string {
  if (!isUuidV7(tradeId)) {
    throw new BtxError(400, "tradeId must be a UUIDv7", {
      code: "INVALID_TRADE_ID"
    });
  }
  return tradeId;
}

export async function getEventConfig(eventId = configuredEvent()): Promise<BtxEventConfig> {
  const projectId = configProjectId(eventId);
  const item = await db.getOneCustom({
    TableName: PROJECTS_TABLE,
    Key: { projectId },
    ConsistentRead: true
  }) as BtxEventConfig | null;
  // The config row is provisioned before the event opens; without it the market stays closed
  if (!item?.phase || item.ipoAt === undefined) {
    throw new BtxError(503, "Market configuration is unavailable. Please contact an organizer.", {
      code: "TRANSITION_UNAVAILABLE"
    });
  }
  return item;
}

export const buildMarketPhaseCheck = (config: BtxEventConfig) => {
  const check = db.build.check(BTX_PROJECTS_TABLE, { projectId: config.projectId })
    .if("phase").equals(config.phase)
    .if("ipoAt").equals(config.ipoAt);
  if (config.ipoPriceTs !== undefined) check.if("ipoPriceTs").equals(config.ipoPriceTs);
  if (config.previousIpoAt === undefined) check.if("previousIpoAt").notExists();
  else check.if("previousIpoAt").equals(config.previousIpoAt);
  return check;
};

export function requireMarketOpen(config: BtxEventConfig) {
  if (config.phase === "IPO_PREPARING" || config.phase === "IPO_RESETTING") {
    throw new BtxError(503, "Market phase is changing. Please try again shortly.", { code: "TRANSITION_UNAVAILABLE" });
  }
}

export async function saveSocketConnection(params: {
  connectionId: string;
  eventId: string;
  userId: string;
}) {
  await docClient.send(
    new PutCommand({
      TableName: SOCKETS_TABLE,
      Item: { ...params, connectedAt: Date.now() }
    })
  );
}

export async function removeSocketConnection({
  connectionId
}: {
  connectionId: string;
}): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: SOCKETS_TABLE,
      Key: { connectionId }
    })
  );
}

export function configuredEvent() {
  return process.env.KICKSTART_EVENT_KEY!;
}
