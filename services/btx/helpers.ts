import { PutCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { validate as validateUuid, version as uuidVersion } from "uuid";

import docClient from "../../lib/docClient";
import { PROJECTS_TABLE, SOCKETS_TABLE } from "./repos/tables";
import type { BtxEventConfig } from "./types";

export class BtxError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public data?: Record<string, unknown>
  ) {
    super(message);
    this.name = "BtxError";
  }
}

export function roundMoney(value: number): number {
  return Math.round(Number(value) * 100) / 100;
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

export async function getEventConfig(): Promise<BtxEventConfig> {
  const projectId = configProjectId();
  const res = await docClient.send(
    new GetCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId },
      ConsistentRead: true
    })
  );
  if (!res.Item) return { projectId, ipoAt: null };
  return { projectId, ipoAt: (res.Item as BtxEventConfig).ipoAt ?? null };
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
