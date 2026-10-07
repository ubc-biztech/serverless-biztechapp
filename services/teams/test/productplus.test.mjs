import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { GetCommand, TransactWriteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { runtime } from "../../productplus/test/support/runtime.mjs";

const app = await runtime({ includeTeams: true });
beforeEach(() => app.reset());
after(() => app.restore());
const eventKey = "productplus;2026";
const teamKey = () => ({ event_key: eventKey, team_code: app.teamCode });
const membershipKey = user_id => ({ event_key: eventKey, user_id });
const cleanupTask = () => app.task("team_deleted", { team_code: app.teamCode });

// These tests seed completed team-workflow writes and call the real Product Plus
// handlers. They verify the shared storage/task contract, not unfinished team APIs.
test("final-member deletion uses the new cleanup payload and removes the submission and PDFs", async () => {
  const referenced = app.upload(1), pending = app.upload(2);
  assert.equal((await app.invoke(app.putSubmission, app.form(referenced.prd_path))).status, 200);

  // The team workflow commits these deletions before invoking Product Plus.
  app.delete(app.table("MEMBERSHIPS"), membershipKey(app.email));
  app.delete(app.table("TEAMS"), teamKey());
  assert.deepEqual(cleanupTask(), {
    internalTask: "team_deleted", payload: { event_key: eventKey, team_code: "012345" }
  });
  assert.equal((await app.cleanup(cleanupTask())).cleaned, 2);
  assert.equal(app.submission(), undefined);
  assert.equal(app.objects.has(app.permanent(referenced)), false);
  assert.equal(app.objects.has(pending.prd_path), false);
  assert.ok(app.config());
  assert.equal((await app.cleanup(cleanupTask())).cleaned, 0);
});

test("removing one member denies that user while remaining members retain submission access", async () => {
  const remaining = "remaining@example.com";
  app.team().member_ids.add(remaining);
  app.team().leader_user_id = remaining;
  app.put(app.table("MEMBERSHIPS"), { ...membershipKey(remaining), team_code: app.teamCode });
  const upload = app.upload();
  assert.equal((await app.invoke(app.putSubmission, app.form(upload.prd_path))).status, 200);

  app.delete(app.table("MEMBERSHIPS"), membershipKey(app.email));
  app.team().member_ids.delete(app.email);
  assert.equal((await app.invoke(app.getSubmission)).status, 403);
  assert.equal((await app.invoke(app.putSubmission, app.form(app.permanent(upload)))).status, 403);
  const result = await app.invoke(app.getSubmission, null, { email: remaining });
  assert.equal(result.status, 200);
  assert.equal(result.body.submission.team_code, app.teamCode);
  assert.equal((await app.invoke(app.putSubmission, {
    ...app.form(app.permanent(upload)), team_name: "Updated by teammate"
  }, { email: remaining })).status, 200);
  assert.equal(app.submission().team_name, "Updated by teammate");
  assert.equal(app.lambda.calls().length, 0);
});

test("annual BizTech membership and old registrations do not grant team access", async () => {
  app.delete(app.table("MEMBERSHIPS"), membershipKey(app.email));
  app.rows.set(app.key("biztechMembers2027", { id: app.email }), { id: app.email, isMember: true });
  app.put("biztechRegistrations", { id: app.email, "eventID;year": eventKey, teamID: "legacy-team" });
  assert.equal((await app.invoke(app.getSubmission)).status, 403);
  assert.equal((await app.invoke(app.createUpload, { content_type: "application/pdf" })).status, 403);
  for (const call of app.database.commandCalls(GetCommand)) {
    assert.ok([app.table("MEMBERSHIPS"), app.table("SUBMISSIONS")].includes(call.args[0].input.TableName));
  }
  assert.equal(app.database.commandCalls(TransactWriteCommand).length, 0);
});

test("a cleanup task for another event cannot affect Product Plus data", async () => {
  const upload = app.upload();
  assert.equal((await app.invoke(app.putSubmission, app.form(upload.prd_path))).status, 200);
  const task = { internalTask: "team_deleted", payload: { event_key: "kickstart;2026", team_code: app.teamCode } };
  await assert.rejects(app.cleanup(task), /Invalid cleanup event/);
  assert.ok(app.submission());
  assert.equal(app.objects.has(app.permanent(upload)), true);
});

test("PROD team deletion reads only PROD resources and preserves the dev team", async () => {
  const devTable = app.table("TEAMS");
  const team = structuredClone(app.team()), membership = structuredClone(app.membership()), config = structuredClone(app.config());
  for (const kind of ["TEAMS", "MEMBERSHIPS", "SUBMISSIONS", "UPLOADS"]) process.env[`PRODUCTPLUS_${kind}_TABLE`] += "PROD";
  process.env.PRODUCTPLUS_PRD_BUCKET = "biztech-pp-prd-prod";
  app.put(app.table("TEAMS"), team);
  app.put(app.table("MEMBERSHIPS"), membership);
  app.put(app.table("SUBMISSIONS"), config);
  const upload = app.upload();
  assert.equal((await app.invoke(app.putSubmission, app.form(upload.prd_path))).status, 200);

  app.delete(app.table("MEMBERSHIPS"), membershipKey(app.email));
  app.delete(app.table("TEAMS"), teamKey());
  assert.equal((await app.cleanup(cleanupTask())).cleaned, 1);
  assert.deepEqual(app.get(devTable, teamKey()), team);
  assert.equal(app.submission(), undefined);
  for (const call of app.database.calls()) {
    const input = call.args[0].input;
    if (input.TableName) assert.match(input.TableName, /PROD$/);
    for (const entry of input.TransactItems || []) assert.match((entry.Update || entry.Delete || entry.ConditionCheck).TableName, /PROD$/);
  }
  assert.ok(app.s3.calls().every(call => call.args[0].input.Bucket === "biztech-pp-prd-prod"));
});

// Preserve the existing regression for other events using their own legacy tables.
test("other events retain the existing empty-team behavior and do not invoke cleanup", async () => {
  const otherEvent = "kickstart;2026", legacyTeamID = "legacy-team";
  app.put("biztechRegistrations", { id: app.email, "eventID;year": otherEvent, teamID: legacyTeamID, fname: "Member" });
  app.put("biztechTeams", { id: legacyTeamID, "eventID;year": otherEvent, memberIDs: [app.email], teamName: "Other event" });
  const result = await app.invoke(app.leaveTeam, { memberID: app.email, eventID: "kickstart", year: 2026, teamID: legacyTeamID });
  assert.equal(result.status, 200);
  assert.deepEqual(app.get("biztechTeams", { id: legacyTeamID, "eventID;year": otherEvent }).memberIDs, []);
  assert.equal(app.database.commandCalls(PutCommand).length, 1);
  assert.equal(app.database.commandCalls(TransactWriteCommand).length, 0);
  assert.equal(app.lambda.calls().length, 0);
});
