import { GetCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import db, { field } from "../../lib/db.js";
import { USER_REGISTRATIONS_TABLE } from "../../constants/tables";
import { BTX_REGISTRATION_STATUSES } from "../../constants/registrations.js";
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
  if (!Item || !BTX_REGISTRATION_STATUSES.some(status => status === Item.registrationStatus)) {
    throw new BtxError(403, "Accepted-complete or checked-in event registration required", {
      code: "FORBIDDEN"
    });
  }
  return Item;
}

export function buildEligibilityCheck(userId: string, teamCode?: string) {
  const check = db.build.check(USER_REGISTRATIONS_TABLE, { id: userId, "eventID;year": configuredEvent() })
    .anyOf(...BTX_REGISTRATION_STATUSES.map(status => field("registrationStatus").equals(status)));
  if (teamCode !== undefined) check.if("teamID").equals(teamCode);
  return check;
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
