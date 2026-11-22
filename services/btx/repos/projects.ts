import { GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../../lib/docClient";
import { BtxError, configuredEvent } from "../helpers";
import { PRICES_TABLE, PROJECTS_TABLE } from "./tables";
import type { BtxPricePoint, BtxProject } from "../types";

export async function getProject(projectId: string) {
  if (!projectId.startsWith(`${configuredEvent()}:`))
    throw new BtxError(400, "Project is not for the configured event", {
      code: "VALIDATION_ERROR"
    });
  const res = await docClient.send(
    new GetCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId },
      ConsistentRead: true
    })
  );
  const project = res.Item as BtxProject | undefined;
  if (!project) throw new BtxError(404, "Project not found");
  return project;
}

export async function listProjectsForEvent() {
  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: PROJECTS_TABLE,
      IndexName: "byEvent",
      KeyConditionExpression: "eventId = :e",
      ExpressionAttributeValues: { ":e": configuredEvent() }
    })
  );
  return (Items || []) as BtxProject[];
}

/** Use only after the IPO gate closes creation/deletion; the GSI can lag new teams. */
export async function listProjectsForIpo() {
  const projects: BtxProject[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(new ScanCommand({
      TableName: PROJECTS_TABLE,
      ConsistentRead: true,
      FilterExpression: "eventId = :event",
      ExpressionAttributeValues: { ":event": configuredEvent() },
      ExclusiveStartKey: start
    }));
    projects.push(...(page.Items || []) as BtxProject[]);
    start = page.LastEvaluatedKey;
  } while (start);
  return projects;
}

export async function getPriceHistory(
  projectId: string,
  limit = 500,
  prevPageKey?: string
) {
  await getProject(projectId);
  // Pass the previous page's DynamoDB key to continue from where it ended.
  const start = prevPageKey ? JSON.parse(prevPageKey) : undefined;
  const res = await docClient.send(
    new QueryCommand({
      TableName: PRICES_TABLE,
      KeyConditionExpression: "projectId = :p",
      ExpressionAttributeValues: { ":p": projectId },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: start
    })
  );
  return {
    items: (res.Items || []) as BtxPricePoint[],
    nextPageKey: res.LastEvaluatedKey
      ? JSON.stringify(res.LastEvaluatedKey)
      : null
  };
}
