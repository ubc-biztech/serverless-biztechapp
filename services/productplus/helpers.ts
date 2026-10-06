import response from "../../lib/responseHelpers";
import type { APIGatewayResponse } from "../../lib/types";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient.js";
import type { Config, ConfigRecord } from "./types";

/** Keeps scaffolded endpoints explicit until their behavior is implemented. */
export function notImplemented(endpoint: string): APIGatewayResponse {
  return response.send(501, {
    message: `${endpoint} is not implemented yet.`
  });
}

export class ConfigValidationError extends Error {}

/** Select public fields explicitly; never expose storage keys or version metadata. */
export function configResponse(value: Record<string, unknown>): Config {
  const { submission_deadline, voting_deadline } = value;
  if (typeof submission_deadline !== "string" || typeof voting_deadline !== "string") {
    throw new ConfigValidationError("Deadlines must be valid UTC ISO timestamps.");
  }
  // Validate the supplied strings without changing their stored/returned format.
  for (const [field, deadline] of [
    ["submission_deadline", submission_deadline],
    ["voting_deadline", voting_deadline]
  ]) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+00:00)$/.test(deadline) ||
      !Number.isFinite(Date.parse(deadline)) ||
      // Reject invalid calendar dates that Date silently rolls into another day.
      new Date(deadline).toISOString().slice(0, 19) !== deadline.slice(0, 19)) {
      throw new ConfigValidationError(`${field} must be a valid UTC ISO timestamp.`);
    }
  }
  if (Date.parse(voting_deadline) <= Date.parse(submission_deadline)) {
    throw new ConfigValidationError("voting_deadline must be after submission_deadline.");
  }
  return { submission_deadline, voting_deadline };
}

export function parseConfigBody(body: string | null, isBase64Encoded = false): Config {
  let value: unknown;
  try {
    value = JSON.parse(isBase64Encoded
      ? Buffer.from(body || "", "base64").toString("utf8")
      : body || "");
  } catch {
    throw new ConfigValidationError("Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigValidationError("Request body must be a config object.");
  }
  const fields = ["submission_deadline", "voting_deadline"];
  if (Object.keys(value).some(key => !fields.includes(key))) {
    throw new ConfigValidationError(`Only ${fields.join(", ")} are allowed.`);
  }
  return configResponse(value as Record<string, unknown>);
}

function configLocation() {
  const TableName = process.env.PRODUCTPLUS_SUBMISSIONS_TABLE;
  const event_key = process.env.PRODUCTPLUS_EVENT_KEY;
  if (!TableName || !event_key) {
    throw new Error("Product Plus table and event configuration are required.");
  }
  // The full environment-selected table name already includes its PROD suffix.
  return { TableName, Key: { event_key, team_code: "config" } };
}

export async function getConfigRecord(): Promise<ConfigRecord | null> {
  const result = await docClient.send(new GetCommand({
    ...configLocation(),
    ConsistentRead: true
  }));
  return result.Item ? result.Item as ConfigRecord : null;
}

export async function saveConfig(config: Config): Promise<Config> {
  const result = await docClient.send(new UpdateCommand({
    ...configLocation(),
    UpdateExpression: "SET #submission = :submission, #voting = :voting, " +
      "#updated = :updated, " +
      "#version = if_not_exists(#version, :zero) + :one",
    ExpressionAttributeNames: {
      "#submission": "submission_deadline",
      "#voting": "voting_deadline",
      "#updated": "updated_at",
      "#version": "version"
    },
    ExpressionAttributeValues: {
      ":submission": config.submission_deadline,
      ":voting": config.voting_deadline,
      ":updated": new Date().toISOString(),
      ":zero": 0,
      ":one": 1
    },
    ReturnValues: "ALL_NEW"
  }));
  if (!result.Attributes) throw new Error("DynamoDB did not return the saved config.");
  return configResponse(result.Attributes);
}
