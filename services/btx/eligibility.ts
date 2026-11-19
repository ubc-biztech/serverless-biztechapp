import { GetCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import { BtxError, configuredEvent } from "./helpers";
import { REGISTRATIONS_TABLE, TEAMS_TABLE } from "./repos/tables";

export async function eligibleRegistration(userId: string) {
  const key = { "id": userId, "eventID;year": configuredEvent() };
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: REGISTRATIONS_TABLE,
      Key: key,
      ConsistentRead: true
    })
  );
  if (Item?.registrationStatus !== "acceptedComplete") {
    throw new BtxError(403, "Accepted-complete event registration required", {
      code: "FORBIDDEN"
    });
  }
  return Item;
}

export async function currentTeamMember(userId: string, projectId: string) {
  const eventId = configuredEvent();
  const prefix = `${eventId}:`;
  if (!projectId.startsWith(prefix) || !projectId.slice(prefix.length)) {
    throw new BtxError(400, "Invalid projectId", { code: "VALIDATION_ERROR" });
  }
  const registration = await eligibleRegistration(userId);
  const teamCode = projectId.slice(prefix.length);
  const key = { "id": teamCode, "eventID;year": eventId };
  const { Item: team } = await docClient.send(
    new GetCommand({
      TableName: TEAMS_TABLE,
      Key: key,
      ConsistentRead: true
    })
  );
  const members = new Set(team?.member_ids || []);
  if (registration.teamID !== teamCode || !members.has(userId)) {
    throw new BtxError(403, "Current team membership required", {
      code: "FORBIDDEN"
    });
  }
  return { registration, teamCode, key };
}
