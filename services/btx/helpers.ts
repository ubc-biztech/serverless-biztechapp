// services/btx/helpers.ts
// PR1: foundation helpers only. Pricing/reads → PR2; trade engine/WS fanout → PR3.

import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { validate as validateUuid, version as uuidVersion } from "uuid";

import docClient from "../../lib/docClient";
import { MIN_PRICE } from "./constants";
import { PROJECTS_TABLE, SOCKETS_TABLE } from "./repos/tables";
import type { BtxProject } from "./types";

/** Expected client/domain failures — handlers map these to HTTP responses. */
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

/** Round dollar amounts / prices to 2 decimal places. */
export function roundMoney(value: number): number {
  return Math.round(Number(value) * 100) / 100;
}

export function roundPrice(value: number): number {
  return roundMoney(value);
}

export function clampPrice(value: number): number {
  return Math.max(MIN_PRICE, roundPrice(value));
}

export function configProjectId(eventId: string): string {
  return `config:${eventId}`;
}

export function buildProjectId(eventId: string, teamCode: string): string {
  return `${eventId}:${teamCode}`;
}

export function accountId(eventId: string, userId: string): string {
  return `${eventId}#${userId}`;
}

/** Client trade IDs must be UUIDv7 (sortable, stable across retries). */
export function isUuidV7(value: unknown): value is string {
  return (
    typeof value === "string" &&
    validateUuid(value) &&
    uuidVersion(value) === 7
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

export async function saveSocketConnection({
  connectionId,
  eventId,
  userId
}: {
  connectionId: string;
  eventId: string;
  userId: string;
}): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: SOCKETS_TABLE,
      Item: {
        connectionId,
        eventId,
        userId,
        connectedAt: Date.now()
      }
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

/** Company listings via byEvent. Control rows omit eventId so they are not indexed. */
export async function listProjectsForEvent(): Promise<BtxProject[]> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: PROJECTS_TABLE,
      IndexName: "byEvent",
      KeyConditionExpression: "eventId = :e",
      ExpressionAttributeValues: {
        ":e": process.env.KICKSTART_EVENT_KEY!
      }
    })
  );
  return (res.Items ?? []) as BtxProject[];
}
