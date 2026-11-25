import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBtx } from "./load-btx.mjs";
import { claims, condition, conflict } from "../../../test/helpers.mjs";

const { client, tables, getCompanyProfile, patchCompanyProfile } = await loadBtx(`
  export { default as client } from "../../lib/docClient.js";
  export * as tables from "./repos/tables";
  export { getCompanyProfile, patchCompanyProfile } from "./profileHandler";
`);
const eventId = "kickstart;2026", teamId = "004218", projectId = eventId + ":" + teamId;
const email = "alice@example.com";
const request = (body, pathProjectId = projectId) => ({
  pathParameters: { projectId: pathProjectId }, requestContext: claims(email), body,
});

function fixture(t) {
  t.mock.method(Date, "now", () => 1000);
  const previous = { event: process.env.KICKSTART_EVENT_KEY, end: process.env.KICKSTART_EVENT_ENDS_AT };
  process.env.KICKSTART_EVENT_KEY = eventId;
  process.env.KICKSTART_EVENT_ENDS_AT = new Date(2000).toISOString();
  t.after(() => {
    for (const [key, value] of [["KICKSTART_EVENT_KEY", previous.event], ["KICKSTART_EVENT_ENDS_AT", previous.end]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const f = {
    company: { projectId, eventId, teamId, companyName: "Northstar", blurb: "", youtubeURL: "",
      seedStartedAt: null, seedSharesAtIpo: null },
    registration: { teamID: teamId }, team: { member_ids: new Set([email]) }, writes: [], failWrite: false,
    config: { projectId: "config:" + eventId, phase: "PRE_IPO", ipoAt: null },
  };
  t.mock.method(client, "send", async command => {
    const { Key, TableName } = command.input;
    if (command.constructor.name === "GetCommand") {
      assert.equal(command.input.ConsistentRead, true);
      if (TableName === tables.PROJECTS_TABLE) {
        if (Key.projectId === "config:" + eventId) return { Item: f.config };
        return { Item: Key.projectId === projectId ? f.company : undefined };
      }
      if (TableName === tables.REGISTRATIONS_TABLE) return { Item: f.registration };
      if (TableName === tables.TEAMS_TABLE) return { Item: f.team };
    }
    assert.equal(command.constructor.name, "TransactWriteCommand");
    f.writes.push(command.input.TransactItems);
    if (f.failWrite) throw conflict(command.input.TransactItems, 3);
    return {};
  });
  return f;
}

test("both profile endpoints require a verified signed-in caller before database access", async t => {
  t.mock.method(client, "send", async () => assert.fail("Unverified caller must not reach DynamoDB"));
  for (const handler of [getCompanyProfile, patchCompanyProfile]) {
    for (const requestContext of [{}, { authorizer: { claims: { email, email_verified: "false" } } }]) {
      assert.equal((await handler({ ...request("{}"), requestContext })).statusCode, 401);
    }
  }
});

test("GET and PATCH reject missing, blank or invalid project IDs with 400 before database access", async t => {
  t.mock.method(client, "send", async () => assert.fail("Invalid project ID must not reach DynamoDB"));
  for (const handler of [getCompanyProfile, patchCompanyProfile]) {
    for (const pathParameters of [null, { projectId: "" }, { projectId: " " }, { projectId: 123 },
      { projectId: "%20" }, { projectId: "kickstart%3G2026%3A004218" }]) {
      const result = await handler({ ...request(JSON.stringify({ blurb: "Updated" })), pathParameters });
      assert.equal(result.statusCode, 400);
      assert.equal(JSON.parse(result.body).message, "Provide a company projectId in the URL.");
    }
  }
});

test("GET and PATCH use the stored project ID when the gateway forwards an encoded path", async t => {
  const { writes } = fixture(t);
  const encoded = encodeURIComponent(projectId);
  const result = await getCompanyProfile(request(null, encoded));
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).projectId, projectId);
  assert.equal(JSON.parse(result.body).canEdit, true);

  const saved = await patchCompanyProfile(request(JSON.stringify({ blurb: "Updated" }), encoded));
  assert.equal(saved.statusCode, 204);
  assert.deepEqual(writes[0].find(write => write.Update).Update.Key, { projectId });

  assert.equal((await getCompanyProfile(request(null, encodeURIComponent(encoded)))).statusCode, 404);
});

test("PATCH rejects malformed or invalid profile input before any database access", async t => {
  t.mock.method(client, "send", async () => assert.fail("Invalid input must not reach DynamoDB"));
  for (const body of ["{", JSON.stringify({ youtubeURL: "https://example.com/video" }),
    JSON.stringify({ currentPriceCents: 1 })]) {
    const result = await patchCompanyProfile(request(body));
    assert.equal(result.statusCode, 400, body);
  }
});

test("PATCH normalizes a valid partial profile before the guarded save transaction", async t => {
  const { writes } = fixture(t);
  assert.equal((await patchCompanyProfile(request(JSON.stringify({ blurb: " Updated " })))).statusCode, 204);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filter(write => write.ConditionCheck).length, 3);
  const update = writes[0].find(write => write.Update).Update;
  assert.ok(Object.values(update.ExpressionAttributeValues).includes("Updated"));
  assert.ok(!Object.values(update.ExpressionAttributeValues).includes(" Updated "));
  assert.match(condition(update), /seedStartedAt = null/);
  assert.match(condition(update), /seedSharesAtIpo = null/);
  assert.match(condition(update), /blurb = ""/);
  const expression = update.UpdateExpression.replace(/#[\w]+/g, name => update.ExpressionAttributeNames[name]);
  assert.doesNotMatch(expression, /currentPriceCents|netShares|version|seedStartedAt|seedSharesAtIpo/);
});

test("profiles remain viewable with caller-specific permissions and require both membership records to edit", async t => {
  const f = fixture(t);
  const member = await getCompanyProfile(request(null));
  assert.equal(member.statusCode, 200);
  assert.equal(JSON.parse(member.body).canEdit, true);
  for (const membership of ["registration", "team"]) {
    f.registration.teamID = membership === "registration" ? "999999" : teamId;
    f.team.member_ids = membership === "team" ? new Set() : new Set([email]);
    const viewer = await getCompanyProfile(request(null));
    assert.equal(viewer.statusCode, 200);
    assert.equal(JSON.parse(viewer.body).canEdit, false);
    assert.equal((await patchCompanyProfile(request(JSON.stringify({ blurb: "Updated" })))).statusCode, 403);
  }
  assert.equal(f.writes.length, 0);
});

test("missing market config keeps a company profile viewable while disabling edits", async t => {
  const f = fixture(t);
  f.config = undefined;
  const result = await getCompanyProfile(request(null));
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).canEdit, false);
  assert.equal((await patchCompanyProfile(request(JSON.stringify({ blurb: "Updated" })))).statusCode, 503);
  assert.equal(f.writes.length, 0);
});

test("a conditional save conflict returns 409 without retrying the transaction", async t => {
  const f = fixture(t);
  f.failWrite = true;
  assert.equal((await patchCompanyProfile(request(JSON.stringify({ blurb: "Updated" })))).statusCode, 409);
  assert.equal(f.writes.length, 1);
});
