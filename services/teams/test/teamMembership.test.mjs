import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import YAML from "yaml";

// Keep real auth and validation; replace only external infrastructure.
// `node:crypto` is stubbed so team codes and leader handoffs are deterministic.
const mocks = {
  "../../lib/db.js": "export default globalThis.infrastructure.db;",
  "node:crypto": "export const randomInt = (...a) => globalThis.infrastructure.randomInt(...a);",
  "uuid": "export const v4 = () => 'team-test-id';",
};
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../handler.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{
    name: "isolated-infrastructure",
    setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path }) =>
        Object.hasOwn(mocks, path) ? { path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path] }));
    },
  }],
});

const USER = "tim@example.com";
const OTHER = "isaac@example.com";
const THIRD = "shun@example.com";
const EVENT_KEY = "productplus;2026";

const teamOf = (overrides = {}) => ({
  id: "123456",
  "eventID;year": EVENT_KEY,
  team_name: "Team Rocket",
  leader_user_id: USER,
  member_ids: new Set([USER]),
  ...overrides,
});

function fixture({
  eventExists = true,
  registration = { id: USER, "eventID;year": EVENT_KEY },
  // An array lets successive reads see a team that changed underneath us.
  team = null,
  randomInts = [],
  atomicConflicts = 0,
} = {}) {
  const writes = [];
  const intQueue = [...randomInts];
  const teamReads = Array.isArray(team) ? [...team] : [team];
  let conflictsLeft = atomicConflicts;

  const db = {
    async getOne(id, table, extraKeys) {
      if (table === "biztechEvents") return eventExists ? { id, year: extraKeys.year } : null;
      if (table === "biztechRegistrations") return registration;
      if (table === "biztechTeams") {
        const next = teamReads.length > 1 ? teamReads.shift() : teamReads[0];
        return next && next.id === id ? next : null;
      }
      return null;
    },
    async batchGet(batch, tableName) {
      return {
        Responses: {
          [tableName]: batch.map(({ id }) => ({ id, fname: id.split("@")[0], lname: "Tester" })),
        },
      };
    },
    async atomic(ops) {
      if (conflictsLeft-- > 0) throw { type: "AtomicConflict" };
      writes.push(ops);
    },
    isConflict: (err) => err?.type === "AtomicConflict",
  };

  const context = vm.createContext({
    module: { exports: {} }, process: { env: {} }, console,
    infrastructure: {
      db,
      randomInt: (min, max) => (intQueue.length ? intQueue.shift() : min ?? 0) % (max ?? Infinity),
    },
  });
  vm.runInContext(bundle.outputFiles[0].text, context);

  const event = (body, user = USER) => ({
    pathParameters: { eventID: "productplus", year: "2026" },
    requestContext: { authorizer: { claims: { email: user, email_verified: "true" } } },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  return { handler: context.module.exports, event, writes };
}

// ─── create ──────────────────────────────────────────────────────────────────

test("create: writes the team and the membership in one transaction", async () => {
  const { handler, event, writes } = fixture({ randomInts: [123456] });
  const res = await handler.createEventTeam(event({ team_name: "  Team Rocket  " }));

  assert.equal(res.statusCode, 201);
  assert.equal(writes.length, 1);

  const [teamWrite, membershipWrite] = writes[0];
  assert.equal(teamWrite.item.id, "123456");
  assert.equal(teamWrite.item.team_name, "Team Rocket", "team name is trimmed");
  assert.equal(teamWrite.item.leader_user_id, USER);
  // Sets come from the vm realm, so compare contents rather than identity.
  assert.deepEqual([...teamWrite.item.member_ids], [USER]);
  assert.equal(teamWrite.condition, "attribute_not_exists(id)");

  assert.match(membershipWrite.condition, /attribute_exists\(id\)/);
  assert.match(membershipWrite.condition, /attribute_not_exists\(teamID\)/);
  assert.equal(membershipWrite.values[":teamCode"], "123456");

  assert.equal(JSON.parse(res.body).team_code, "123456");
});

test("create: team codes keep leading zeros", async () => {
  const { handler, event, writes } = fixture({ randomInts: [42] });
  assert.equal((await handler.createEventTeam(event({ team_name: "Zeroes" }))).statusCode, 201);
  assert.equal(writes[0][0].item.id, "000042");
});

test("create: a code collision retries with a fresh code", async () => {
  const { handler, event, writes } = fixture({ randomInts: [111111, 222222], atomicConflicts: 1 });
  assert.equal((await handler.createEventTeam(event({ team_name: "Retry" }))).statusCode, 201);
  assert.equal(writes.length, 1, "only the successful attempt is written");
  assert.equal(writes[0][0].item.id, "222222");
});

test("create: unregistered users are turned away", async () => {
  const { handler, event, writes } = fixture({ registration: null });
  assert.equal((await handler.createEventTeam(event({ team_name: "Nope" }))).statusCode, 403);
  assert.equal(writes.length, 0);
});

test("create: a user already on a team cannot create another", async () => {
  const { handler, event, writes } = fixture({
    registration: { id: USER, "eventID;year": EVENT_KEY, teamID: "999999" },
  });
  assert.equal((await handler.createEventTeam(event({ team_name: "Second" }))).statusCode, 409);
  assert.equal(writes.length, 0);
});

for (const body of [{}, { team_name: "   " }, { team_name: 7 }]) {
  test(`create: rejects invalid body ${JSON.stringify(body)}`, async () => {
    const { handler, event, writes } = fixture();
    assert.equal((await handler.createEventTeam(event(body))).statusCode, 406);
    assert.equal(writes.length, 0);
  });
}

test("create: a missing event is a 404", async () => {
  const { handler, event } = fixture({ eventExists: false });
  assert.equal((await handler.createEventTeam(event({ team_name: "Ghost" }))).statusCode, 404);
});

// ─── join ────────────────────────────────────────────────────────────────────

test("join: adds the caller to member_ids and claims their membership", async () => {
  const { handler, event, writes } = fixture({ team: teamOf() });
  const res = await handler.joinEventTeam(event({ team_code: "123456" }, OTHER), OTHER);

  assert.equal(res.statusCode, 200);
  const [membershipWrite, teamWrite] = writes[0];
  assert.equal(membershipWrite.values[":teamCode"], "123456");
  assert.equal(teamWrite.update, "ADD member_ids :joined");
  assert.deepEqual([...teamWrite.values[":joined"]], [OTHER]);
});

for (const code of ["12345", "abcdef", "1234567", ""]) {
  test(`join: rejects malformed code ${JSON.stringify(code)}`, async () => {
    const { handler, event, writes } = fixture({ team: teamOf() });
    assert.equal((await handler.joinEventTeam(event({ team_code: code }))).statusCode, 406);
    assert.equal(writes.length, 0);
  });
}

test("join: an unknown code is a 404", async () => {
  const { handler, event, writes } = fixture({ team: null });
  assert.equal((await handler.joinEventTeam(event({ team_code: "999999" }))).statusCode, 404);
  assert.equal(writes.length, 0);
});

test("join: a user already on a team cannot join another", async () => {
  const { handler, event, writes } = fixture({
    team: teamOf(),
    registration: { id: USER, "eventID;year": EVENT_KEY, teamID: "999999" },
  });
  assert.equal((await handler.joinEventTeam(event({ team_code: "123456" }))).statusCode, 409);
  assert.equal(writes.length, 0);
});

test("join: unregistered users are turned away", async () => {
  const { handler, event, writes } = fixture({ team: teamOf(), registration: null });
  assert.equal((await handler.joinEventTeam(event({ team_code: "123456" }))).statusCode, 403);
  assert.equal(writes.length, 0);
});

// ─── leave ───────────────────────────────────────────────────────────────────

test("leave: the last member takes the team row with them", async () => {
  const { handler, event, writes } = fixture({
    team: teamOf(),
    registration: { id: USER, "eventID;year": EVENT_KEY, teamID: "123456" },
  });
  assert.equal((await handler.leaveEventTeam(event())).statusCode, 204);

  const [membershipWrite, teamWrite] = writes[0];
  assert.equal(membershipWrite.update, "REMOVE teamID");
  assert.equal(teamWrite.delete, true, "the row is deleted, never emptied");
  assert.match(teamWrite.condition, /size\(member_ids\) = :one/);
});

test("leave: a departing leader hands off to a remaining member", async () => {
  const { handler, event, writes } = fixture({
    team: teamOf({ member_ids: new Set([USER, OTHER, THIRD]) }),
    registration: { id: USER, "eventID;year": EVENT_KEY, teamID: "123456" },
    randomInts: [1],
  });
  assert.equal((await handler.leaveEventTeam(event())).statusCode, 204);

  const teamWrite = writes[0][1];
  assert.match(teamWrite.update, /SET leader_user_id = :newLeader/);
  assert.match(teamWrite.update, /DELETE member_ids :leaving/);
  assert.equal(teamWrite.values[":newLeader"], THIRD);
  assert.notEqual(teamWrite.values[":newLeader"], USER, "the leaver never inherits");
  assert.match(teamWrite.condition, /contains\(member_ids, :newLeader\)/);
});

test("leave: a regular member only shrinks member_ids", async () => {
  const { handler, event, writes } = fixture({
    team: teamOf({ leader_user_id: OTHER, member_ids: new Set([USER, OTHER]) }),
    registration: { id: USER, "eventID;year": EVENT_KEY, teamID: "123456" },
  });
  assert.equal((await handler.leaveEventTeam(event())).statusCode, 204);

  const teamWrite = writes[0][1];
  assert.equal(teamWrite.update, "DELETE member_ids :leaving");
  assert.equal(teamWrite.values[":leaderID"], OTHER);
  assert.match(teamWrite.condition, /leader_user_id <> :userID/);
});

test("leave: a concurrent join reroutes away from deleting the team", async () => {
  // First read sees a solo team, the write conflicts, the retry sees the new member.
  const { handler, event, writes } = fixture({
    team: [teamOf(), teamOf({ member_ids: new Set([USER, OTHER]) })],
    registration: { id: USER, "eventID;year": EVENT_KEY, teamID: "123456" },
    randomInts: [0],
    atomicConflicts: 1,
  });
  assert.equal((await handler.leaveEventTeam(event())).statusCode, 204);

  assert.equal(writes.length, 1);
  const teamWrite = writes[0][1];
  assert.notEqual(teamWrite.delete, true, "the team survives because someone joined");
  assert.equal(teamWrite.values[":newLeader"], OTHER);
});

test("leave: a user with no team gets a 404", async () => {
  const { handler, event, writes } = fixture({ team: null });
  assert.equal((await handler.leaveEventTeam(event())).statusCode, 404);
  assert.equal(writes.length, 0);
});

// ─── auth ────────────────────────────────────────────────────────────────────

for (const name of ["createEventTeam", "joinEventTeam", "leaveEventTeam"]) {
  test(`${name}: unauthenticated callers are rejected`, async () => {
    const { handler, writes } = fixture();
    const res = await handler[name]({
      pathParameters: { eventID: "productplus", year: "2026" },
      body: JSON.stringify({ team_name: "X", team_code: "123456" }),
    });
    assert.equal(res.statusCode, 401);
    assert.equal(writes.length, 0);
  });
}

test("gateway protects every membership route and leaves the legacy ones alone", () => {
  const { functions } = YAML.parse(readFileSync(new URL("../serverless.yml", import.meta.url), "utf8"));

  for (const name of ["createEventTeam", "joinEventTeam", "leaveEventTeam"]) {
    const { http } = functions[name].events[0];
    assert.equal(http.method, "post");
    assert.equal(http.authorizer.type, "COGNITO_USER_POOLS", `${name} needs the authorizer`);
    assert.deepEqual(http.request.parameters.paths, { eventID: true, year: true });
  }

  assert.equal(functions.createEventTeam.events[0].http.path, "team/{eventID}/{year}");
  assert.equal(functions.joinEventTeam.events[0].http.path, "team/{eventID}/{year}/join");
  assert.equal(functions.leaveEventTeam.events[0].http.path, "team/{eventID}/{year}/leave");

  // The legacy scavenger-hunt endpoints must keep working untouched.
  assert.equal(functions.makeTeam.events[0].http.path, "team/make");
  assert.equal(functions.joinTeam.events[0].http.path, "team/join");
  assert.equal(functions.leaveTeam.events[0].http.path, "team/leave");
});
