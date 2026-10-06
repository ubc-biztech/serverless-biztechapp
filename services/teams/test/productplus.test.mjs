import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { TransactWriteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { runtime, conditionalFailure } from "../../productplus/test/support/runtime.mjs";

const app = await runtime({ includeTeams: true });
beforeEach(() => app.reset());
after(() => app.restore());
const registration = email => app.get(app.table("REGISTRATIONS"), { id: email, "eventID;year": "productplus;2026" });
const body = () => ({ memberID: app.email, eventID: "productplus", year: 2026, teamID: app.teamId });
const leave = (claims = {}) => app.invoke(app.leaveTeam, body(), claims);
const join = (claims = {}) => app.invoke(app.joinTeam, body(), claims);
const task = () => JSON.parse(Buffer.from(app.lambda.calls().at(-1).args[0].input.Payload));

test("last member leave atomically deletes the team, clears registration and delivers private cleanup", async () => {
  const upload = app.upload();
  await app.invoke(app.putSubmission, app.form(upload.prd_path));
  assert.equal((await leave()).status, 200);
  assert.equal(app.team(), undefined);
  assert.equal(registration(app.email).teamID, "");
  const invocation = app.lambda.calls()[0].args[0].input;
  assert.equal(invocation.InvocationType, "Event");
  assert.equal(invocation.FunctionName, process.env.PRODUCTPLUS_CLEANUP_FUNCTION);
  assert.deepEqual(task(), app.task("team_deleted", { team_id: app.teamId, team_code: app.teamCode }));
  assert.equal((await app.cleanup(task())).cleaned, 1);
  assert.equal(app.submission(), undefined);
  assert.equal(app.objects.has(app.permanent(upload)), false);
});

test("non-final leave preserves teammates, team attributes and submission", async () => {
  app.team().memberIDs.push("another@example.com");
  app.team().points = 42;
  const upload = app.upload();
  await app.invoke(app.putSubmission, app.form(upload.prd_path));
  assert.equal((await leave()).status, 200);
  assert.deepEqual(app.team().memberIDs, ["another@example.com"]);
  assert.equal(app.team().points, 42);
  assert.equal(registration(app.email).teamID, "");
  assert.ok(app.submission());
  assert.equal(app.lambda.calls().length, 0);
});

test("Product Plus join updates only membership and registration in one transaction", async () => {
  registration(app.email).teamID = "";
  app.team().memberIDs = ["other@example.com"];
  app.team().points = 23;
  assert.equal((await join()).status, 200);
  assert.deepEqual(app.team().memberIDs, ["other@example.com", app.email]);
  assert.equal(registration(app.email).teamID, app.teamId);
  assert.equal(app.team().points, 23);
  const items = app.database.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
  assert.equal(items.length, 2);
  assert.match(items[0].Update.ConditionExpression, /attribute_exists/);
  assert.equal(app.lambda.calls().length, 0);
});

test("authentication and caller-derived membership prevent removing another member", async () => {
  assert.equal((await leave({ email: undefined })).status, 401);
  assert.equal((await leave({ email_verified: "false" })).status, 401);
  app.team().memberIDs.push("other@example.com");
  const forged = { ...body(), memberID: "other@example.com" };
  assert.equal((await app.invoke(app.leaveTeam, forged)).status, 200);
  assert.deepEqual(app.team().memberIDs, ["other@example.com"]);
});

test("join rejects missing check-in, existing membership and absent teams without writes", async () => {
  assert.equal((await join()).status, 400);
  registration(app.email).teamID = "";
  registration(app.email).registrationStatus = "registered";
  assert.equal((await join()).status, 403);
  registration(app.email).registrationStatus = "checkedin";
  app.delete(app.table("TEAMS"), { id: app.teamId, "eventID;year": "productplus;2026" });
  assert.equal((await join()).status, 404);
  assert.equal(app.database.commandCalls(TransactWriteCommand).length, 0);
});

test("concurrent join winning first turns last-member leave into a non-final leave", async () => {
  const other = "new@example.com";
  app.put(app.table("REGISTRATIONS"), { id: other, "eventID;year": "productplus;2026", teamID: "", registrationStatus: "checkedin" });
  let release, reached;
  const blocked = new Promise(resolve => { reached = resolve; });
  app.beforeTransaction = input => {
    if (input.TransactItems[0].Delete && !release) return new Promise(resolve => { release = resolve; reached(); });
  };
  const leaving = leave();
  await blocked;
  assert.equal((await join({ email: other })).status, 200);
  release();
  assert.equal((await leaving).status, 200);
  assert.deepEqual(app.team().memberIDs, [other]);
  assert.equal(registration(other).teamID, app.teamId);
  assert.equal(registration(app.email).teamID, "");
  assert.equal(app.lambda.calls().length, 0);
});

test("a stale join cannot recreate a team deleted by its last member", async () => {
  const other = "new@example.com";
  app.put(app.table("REGISTRATIONS"), { id: other, "eventID;year": "productplus;2026", teamID: "", registrationStatus: "checkedin" });
  let release, reached;
  const blocked = new Promise(resolve => { reached = resolve; });
  app.beforeTransaction = input => {
    if (input.TransactItems[0].Update && !release) return new Promise(resolve => { release = resolve; reached(); });
  };
  const joining = join({ email: other });
  await blocked;
  assert.equal((await leave()).status, 200);
  release();
  assert.equal((await joining).status, 404);
  assert.equal(app.team(), undefined);
  assert.equal(registration(other).teamID, "");
});

test("membership conflicts retry three times and leave both records intact", async () => {
  app.beforeTransaction = () => { throw conditionalFailure(); };
  assert.equal((await leave()).status, 409);
  assert.equal(app.database.commandCalls(TransactWriteCommand).length, 3);
  assert.ok(app.team());
  assert.equal(registration(app.email).teamID, app.teamId);
  assert.equal(app.lambda.calls().length, 0);
});

test("cleanup delivery failure preserves the committed leave and logs a replayable task", async () => {
  app.lambda.on(InvokeCommand).rejects(new Error("Sensitive delivery details"));
  assert.equal((await leave()).status, 200);
  assert.equal(app.team(), undefined);
  assert.equal(registration(app.email).teamID, "");
  assert.match(JSON.stringify(app.logs), /team_deleted/);
  assert.doesNotMatch(JSON.stringify(app.logs), /Sensitive delivery/);
});

test("PROD membership writes and cleanup invoke the PROD resources", async () => {
  process.env.ENVIRONMENT = "PROD";
  process.env.PRODUCTPLUS_CLEANUP_FUNCTION = "biztechApi-productplus-prod-productplusCleanup";
  app.put("biztechTeamsPROD", { ...app.team() });
  app.put("biztechRegistrationsPROD", { ...registration(app.email) });
  assert.equal((await leave()).status, 200);
  for (const entry of app.database.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems) {
    assert.match((entry.Delete || entry.Update).TableName, /PROD$/);
  }
  assert.equal(app.lambda.calls()[0].args[0].input.FunctionName, "biztechApi-productplus-prod-productplusCleanup");
  assert.ok(app.team()); // dev record untouched
});

test("other events retain the existing empty-team behavior and do not invoke cleanup", async () => {
  const eventKey = "kickstart;2026";
  app.put(app.table("REGISTRATIONS"), { id: app.email, "eventID;year": eventKey, teamID: app.teamId, fname: "Member" });
  app.put(app.table("TEAMS"), { id: app.teamId, "eventID;year": eventKey, memberIDs: [app.email], teamName: "Other event" });
  const result = await app.invoke(app.leaveTeam, { ...body(), eventID: "kickstart" });
  assert.equal(result.status, 200);
  assert.deepEqual(app.get(app.table("TEAMS"), { id: app.teamId, "eventID;year": eventKey }).memberIDs, []);
  assert.equal(app.database.commandCalls(PutCommand).length, 1);
  assert.equal(app.database.commandCalls(TransactWriteCommand).length, 0);
  assert.equal(app.lambda.calls().length, 0);
});

test("transport failure after a committed leave still delivers cleanup and returns success", async () => {
  app.afterTransaction = () => { throw new Error("Timeout after commit"); };
  assert.equal((await leave()).status, 200);
  assert.equal(app.team(), undefined);
  assert.equal(app.lambda.calls().length, 1);
});

test("unexpected membership write errors are generic and preserve records", async () => {
  app.beforeTransaction = () => { throw new Error("Sensitive SDK details"); };
  const result = await leave();
  assert.equal(result.status, 500);
  assert.doesNotMatch(JSON.stringify(result), /Sensitive SDK/);
  assert.ok(app.team());
  assert.equal(registration(app.email).teamID, app.teamId);
  assert.equal(app.lambda.calls().length, 0);
});

test("missing six-digit code blocks final deletion before either membership record changes", async () => {
  delete app.team().team_code;
  assert.equal((await leave()).status, 409);
  assert.ok(app.team());
  assert.equal(registration(app.email).teamID, app.teamId);
});
