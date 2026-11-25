import assert from "node:assert/strict";
import { test } from "node:test";
import { claims, condition, conflict, isolateHandler } from "../../../test/helpers.mjs";

const load = await isolateHandler("services/teams/handler.ts", {
  "../../lib/docClient.js": "export default globalThis.infrastructure.client;",
  "node:crypto": "export const randomInt = (...args) => globalThis.infrastructure.randomInt(...args);",
  "@aws-sdk/client-lambda": "export class LambdaClient {} export class InvokeCommand {}",
});
const user = "alice@example.com", other = "bob@example.com", code = "004218";
const routes = { create: "createEventTeam", join: "joinEventTeam", leave: "leaveEventTeam", remove: "removeTeamMember", lookup: "getTeamFromUserID" };

function fixture(operation = "create", options = {}) {
  const eventID = options.eventID ?? "kickstart", year = options.year ?? 2026;
  const btxEnabled = Object.hasOwn(options, "btxEnabled") ? options.btxEnabled : true;
  const suffix = options.suffix ?? "", eventKey = `${eventID};${year}`;
  const rows = new Map(), writes = [];
  const address = (table, key) => JSON.stringify([table, key.projectId ?? key.id, key["eventID;year"] ?? key.year ?? key.ts]);
  const save = (table, row) => rows.set(address(table + suffix, row), row);
  const eventRecord = { id: eventID, year, ...(btxEnabled === undefined ? {} : { btxEnabled }) };
  const registration = { id: user, "eventID;year": eventKey, registrationStatus: options.status ?? "acceptedComplete" };
  const members = options.members ?? (operation === "join" ? [other] : [user, other]);
  const team = { id: code, "eventID;year": eventKey, team_name: "Northstar", leader_user_id: options.leader ?? members[0], member_ids: new Set(members) };
  const projectId = `${eventKey}:${code}`;
  const company = { projectId, eventId: eventKey, teamId: code, companyName: "Northstar", netShares: 0,
    seedStartedAt: null, seedEndsAt: null, seedSharesAtIpo: null, version: 0, initialPriceTs: 1, lastPriceTs: 1 };
  const config = { projectId: `config:${eventKey}`, phase: "PRE_IPO", ipoAt: null };
  save("biztechEvents", eventRecord);
  if (options.registered !== false) save("biztechRegistrations", registration);
  if (operation !== "create") {
    save("biztechTeams", team);
    if (members.includes(user)) registration.teamID = code;
    save("biztechRegistrations", { id: other, "eventID;year": eventKey, teamID: code });
    save("bizBtxProjects", company);
  }
  if (btxEnabled || options.marketConfigured) save("bizBtxProjects", config);
  const f = { rows, writes, registration, team, company, config, eventRecord, projectId, codeCalls: 0 };
  const handler = load({
    randomInt: (min, max) => max === 1_000_000 ? (options.codes ?? [4218])[f.codeCalls++] : min,
    client: { async send(command) {
      const input = command.input;
      if (command.constructor.name === "GetCommand") return { Item: structuredClone(rows.get(address(input.TableName, input.Key))) };
      if (command.constructor.name === "BatchGetCommand") return { Responses: Object.fromEntries(Object.entries(input.RequestItems).map(([table, request]) => [table, request.Keys.map(key => ({ ...key, fname: "Participant" }))])) };
      if (command.constructor.name === "TransactWriteCommand") {
        const items = structuredClone(input.TransactItems);
        writes.push(items);
        if (f.onWrite) return f.onWrite(items);
        return {};
      }
      throw Error(`Unexpected AWS command: ${command.constructor.name}`);
    } },
  }, { ENVIRONMENT: suffix, KICKSTART_EVENT_KEY: "kickstart;2026", PRODUCTPLUS_EVENT_KEY: "product+;2026" });
  f.run = (overrides = {}, route = routes[operation]) => handler[route]({
    requestContext: claims(),
    pathParameters: { eventID: encodeURIComponent(eventID), year: String(year), user_id: encodeURIComponent(operation === "remove" ? other : user) },
    body: JSON.stringify(operation === "join" ? { team_code: code } : { team_name: "Northstar" }),
    ...overrides,
  });
  f.action = (kind, table) => writes.at(-1).find(item => item[kind]?.TableName === table + suffix)?.[kind];
  return f;
}

test("team routes require a verified signed-in caller", async () => {
  const f = fixture();
  assert.equal((await f.run({ requestContext: { authorizer: { claims: { email: user, email_verified: "false" } } } })).statusCode, 401);
  assert.equal(f.writes.length, 0);
});

for (const operation of ["create", "join"]) {
  for (const [name, options, expected] of [
    ["no registration", { registered: false }, 403],
    ["pending registration", { status: "acceptedPending" }, 403],
    ["existing membership", {}, 409],
  ]) {
    test(`${operation} rejects ${name}`, async () => {
      const f = fixture(operation, options);
      if (name === "existing membership") f.registration.teamID = "999999";
      assert.equal((await f.run()).statusCode, expected);
      assert.equal(f.writes.length, 0);
    });
  }
  for (const status of ["acceptedComplete", "checkedIn"]) {
    test(`${operation} permits ${status} and guards eligibility in its transaction`, async () => {
      const f = fixture(operation, { status });
      assert.equal((await f.run()).statusCode, operation === "create" ? 201 : 200);
      const claim = f.action("Update", "biztechRegistrations");
      assert.deepEqual(claim.Key, { id: user, "eventID;year": "kickstart;2026" });
      assert.match(condition(claim), /attribute_exists\(id\)/);
      assert.match(condition(claim), /attribute_not_exists\(teamID\)/);
      assert.match(condition(claim), /registrationStatus = "acceptedComplete" OR .*registrationStatus = "checkedIn"/);
      assert.equal(f.writes.length, 1);
    });
  }
}

test("creation atomically initializes the team, registration, company, and cents-based history", async () => {
  const f = fixture("create", { suffix: "PROD" });
  const result = await f.run({ body: JSON.stringify({ team_name: "  Northstar  ", currentPriceCents: 1, seedStartedAt: 123 }) });
  assert.equal(result.statusCode, 201);
  assert.equal(JSON.parse(result.body).projectId, "kickstart;2026:004218");
  assert.equal(f.writes.length, 1);
  const team = f.action("Put", "biztechTeams").Item;
  const company = f.action("Put", "bizBtxProjects").Item;
  const price = f.action("Put", "bizBtxPrices").Item;
  assert.equal(team.id, code);
  assert.equal(team.leader_user_id, user);
  assert.deepEqual([...team.member_ids], [user]);
  assert.equal(company.teamId, team.id);
  assert.equal(company.companyName, "Northstar");
  assert.equal(company.currentPriceCents, 10_000);
  assert.equal(company.seedStartedAt, null);
  assert.equal(company.seedEndsAt, null);
  assert.equal(company.seedSharesAtIpo, null);
  assert.equal(company.netShares, 0);
  assert.equal(company.version, 0);
  assert.equal(company.initialPriceTs, price.ts);
  assert.equal(company.lastPriceTs, price.ts);
  assert.equal(price.priceCents, company.currentPriceCents);
  assert.equal(price.source, "INITIAL");
  assert.match(condition(f.action("Put", "bizBtxProjects")), /attribute_not_exists\(projectId\)/);
  assert.ok(f.writes[0].every(item => Object.values(item)[0].TableName.endsWith("PROD")));
});

test("BTX company names accept 100 trimmed characters and reject 101", async () => {
  const valid = fixture();
  assert.equal((await valid.run({ body: JSON.stringify({ team_name: ` ${"N".repeat(100)} ` }) })).statusCode, 201);
  const invalid = fixture();
  assert.equal((await invalid.run({ body: JSON.stringify({ team_name: "N".repeat(101) }) })).statusCode, 400);
  assert.equal(invalid.writes.length, 0);
});

for (const [operation, body] of [["create", "{"], ["create", '{"team_name":" "}'], ["join", '{"team_code":"123"}']]) {
  test(`${operation} rejects invalid input ${body}`, async () => {
    const f = fixture(operation);
    assert.equal((await f.run({ body })).statusCode, 400);
    assert.equal(f.writes.length, 0);
  });
}

for (const btxEnabled of [false, undefined]) {
  test(`ordinary event behavior is retained when btxEnabled=${btxEnabled}`, async () => {
    const f = fixture("create", { eventID: "product+", btxEnabled, status: "registered" });
    const result = await f.run({ body: JSON.stringify({ team_name: "N".repeat(101) }) });
    assert.equal(result.statusCode, 201);
    assert.equal(JSON.parse(result.body).projectId, undefined);
    assert.ok(!f.writes[0].some(item => Object.values(item)[0].TableName.startsWith("bizBtx")));
  });
}

test("an IPO reset can reopen BTX company creation only with the event flag enabled", async () => {
  for (const btxEnabled of [undefined, false, true]) {
    const f = fixture("create", { btxEnabled, marketConfigured: true });
    Object.assign(f.config, { previousIpoAt: 1000, lastReset: { ipoAt: 1000, status: "SUCCEEDED" } });
    const result = await f.run();
    if (btxEnabled === true) {
      assert.equal(result.statusCode, 201);
      assert.equal(JSON.parse(result.body).projectId, f.projectId);
      assert.equal(f.action("Put", "bizBtxProjects").Item.projectId, f.projectId);
      assert.match(condition(f.action("ConditionCheck", "bizBtxProjects")), /previousIpoAt = 1000/);
    } else {
      assert.equal(result.statusCode, 503);
      assert.match(JSON.parse(result.body).message, /BTX team formation is not enabled/);
      assert.equal(f.writes.length, 0);
    }
  }
});

test("another event/year can opt into BTX without hardcoded Kickstart identifiers", async () => {
  const f = fixture("create", { eventID: "future-event", year: 2030 });
  assert.equal((await f.run()).statusCode, 201);
  assert.equal(f.action("Put", "bizBtxProjects").Item.projectId, "future-event;2030:004218");
});

test("a confirmed random-code collision retries without exposing the collision", async () => {
  const f = fixture("create", { codes: [4218, 123456] });
  f.onWrite = items => { if (f.writes.length === 1) throw conflict(items); return {}; };
  const result = await f.run();
  assert.equal(result.statusCode, 201);
  assert.equal(JSON.parse(result.body).team_code, "123456");
  assert.equal(f.writes.length, 2);
  assert.equal(f.action("Put", "bizBtxProjects").Item.teamId, "123456");
});

test("collision retries are bounded and other failures are not retried", async () => {
  const collisions = fixture("create", { codes: [4218, 123456, 654321] });
  collisions.onWrite = items => { throw conflict(items); };
  assert.equal((await collisions.run()).statusCode, 409);
  assert.equal(collisions.writes.length, 3);
  const failure = fixture();
  failure.onWrite = () => { throw Error("private infrastructure detail"); };
  const result = await failure.run();
  assert.equal(result.statusCode, 500);
  assert.ok(!result.body.includes("private infrastructure detail"));
  assert.equal(failure.writes.length, 1);
});

test("joining updates membership without overwriting the company's profile or market data", async () => {
  const f = fixture("join");
  assert.equal((await f.run()).statusCode, 200);
  assert.match(condition(f.action("Update", "biztechTeams")), /attribute_exists\(id\)/);
  assert.ok(f.writes[0].every(item => !item.Put && !item.Delete));
  assert.deepEqual(f.writes[0].filter(item => item.Update).map(item => item.Update.TableName).sort(), ["biztechRegistrations", "biztechTeams"]);
  const companyCheck = f.writes[0].find(item => item.ConditionCheck?.Key.projectId === f.projectId).ConditionCheck;
  assert.match(condition(companyCheck), /seedStartedAt = null/);
});

for (const operation of ["create", "join", "leave", "remove"]) {
  test(`${operation} is blocked at IPO`, async () => {
    const f = fixture(operation);
    f.config.phase = "LIVE";
    f.config.ipoAt = Date.now();
    assert.equal((await f.run()).statusCode, 409);
    assert.equal(f.writes.length, 0);
  });
}
for (const operation of ["join", "leave", "remove"]) {
  test(`${operation} remains locked after the company's seed window ends`, async () => {
    const f = fixture(operation);
    f.company.seedStartedAt = 1;
    f.company.seedEndsAt = 1_800_001;
    assert.equal((await f.run()).statusCode, 409);
    assert.equal(f.writes.length, 0);
  });
}

test("formation fails closed for missing config and closes during IPO preparation", async () => {
  const missing = fixture();
  missing.rows.delete(JSON.stringify(["bizBtxProjects", missing.config.projectId, null]));
  assert.equal((await missing.run()).statusCode, 503);
  const preparing = fixture();
  preparing.config.phase = "IPO_PREPARING";
  assert.equal((await preparing.run()).statusCode, 409);
});

test("joining cannot treat a missing company as an unstarted seed window", async () => {
  const f = fixture("join");
  f.rows.delete(JSON.stringify(["bizBtxProjects", f.projectId, null]));
  assert.equal((await f.run()).statusCode, 503);
  assert.equal(f.writes.length, 0);
});

test("atomic guards reject an IPO or membership change during a join", async () => {
  const f = fixture("join");
  f.onWrite = items => { throw conflict(items); };
  assert.equal((await f.run()).statusCode, 409);
  const configCheck = f.writes[0].find(item => item.ConditionCheck?.Key.projectId === f.config.projectId).ConditionCheck;
  assert.match(condition(configCheck), /phase = "PRE_IPO"/);
  assert.match(condition(configCheck), /ipoAt = null/);
});

test("a departing leader hands leadership to a remaining member", async () => {
  const f = fixture("leave");
  assert.equal((await f.run()).statusCode, 204);
  const update = f.action("Update", "biztechTeams");
  assert.ok(Object.values(update.ExpressionAttributeValues).includes(other));
  assert.match(condition(update), /leader_user_id = "alice@example.com"/);
  assert.match(condition(f.action("Update", "biztechRegistrations")), /teamID = "004218"/);
});

test("a member can leave while preserving the existing leader", async () => {
  const f = fixture("leave", { leader: other });
  assert.equal((await f.run()).statusCode, 204);
  assert.ok(!f.action("Update", "biztechTeams").UpdateExpression.includes("SET"));
});

test("only the current leader can remove another member", async () => {
  const denied = fixture("remove", { leader: other });
  assert.equal((await denied.run()).statusCode, 403);
  assert.equal(denied.writes.length, 0);
  const allowed = fixture("remove");
  assert.equal((await allowed.run()).statusCode, 204);
  assert.equal(allowed.action("Update", "biztechRegistrations").Key.id, other);
  assert.match(condition(allowed.action("Update", "biztechTeams")), /leader_user_id = "alice@example.com"/);
});

test("last-member cleanup atomically deletes only an unused company and its exact initial history", async () => {
  const f = fixture("leave", { members: [user] });
  assert.equal((await f.run()).statusCode, 204);
  assert.equal(f.writes.length, 1);
  const company = f.action("Delete", "bizBtxProjects");
  assert.match(condition(company), /version = 0/);
  assert.deepEqual(f.action("Delete", "bizBtxPrices").Key, { projectId: f.projectId, ts: 1 });
  assert.match(condition(f.action("Delete", "biztechTeams")), /size\(member_ids\) = 1/);
  assert.ok(f.writes[0].every(item => !Object.values(item)[0].TableName.includes("Holdings")));
});

test("cleanup returns a conflict if company activity or membership changes before commit", async () => {
  const f = fixture("leave", { members: [user] });
  f.onWrite = items => { throw conflict(items, items.findIndex(item => item.Delete?.TableName === "bizBtxProjects")); };
  assert.equal((await f.run()).statusCode, 409);
});

test("team lookup returns its linked company after IPO and rejects another user's lookup", async () => {
  const f = fixture("lookup");
  f.config.phase = "LIVE";
  f.config.ipoAt = Date.now();
  assert.equal(JSON.parse((await f.run()).body).projectId, f.projectId);
  assert.equal((await f.run({ pathParameters: { eventID: "kickstart", year: "2026", user_id: other } })).statusCode, 403);
  assert.equal(f.writes.length, 0);
});

test("team lookup returns null when the caller has no membership", async () => {
  const f = fixture("lookup");
  delete f.registration.teamID;
  assert.equal(JSON.parse((await f.run()).body), null);
  assert.equal(f.writes.length, 0);
});

for (const route of ["makeTeam", "leaveTeam"]) {
  test(`legacy ${route} cannot bypass BTX membership rules`, async () => {
    for (const btxEnabled of [true, undefined]) {
      const f = fixture("create", { btxEnabled });
      assert.equal((await f.run({ body: JSON.stringify({ eventID: "kickstart", year: 2026, memberID: user, memberIDs: [user], team_name: "Northstar" }) }, route)).statusCode, 400);
      assert.equal(f.writes.length, 0);
    }
  });
}
