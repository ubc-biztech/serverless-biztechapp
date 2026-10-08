import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import YAML from "yaml";
import { scan, update } from "./dynamoFixture.mjs";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../handlerProductPlus.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "infrastructure", setup(build) {
    build.onResolve({ filter: /^\.\.\/\.\.\/lib\/db.js$/ }, () => ({ path: "db", namespace: "mock" }));
    build.onResolve({ filter: /^@aws-sdk\/(client-s3|s3-request-presigner)$/ }, args => ({ path: args.path, namespace: "mock" }));
    build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents:
      path === "db" ? "export default globalThis.db;" :
      path === "@aws-sdk/client-s3" ? "export class S3Client {} export class GetObjectCommand {}" :
      "export const getSignedUrl = () => {};"
    }));
  } }]
});
const now = Date.parse("2026-10-05T12:00:00Z");
function fixture({ time = now, missing = false, rows, config, random = () => 0 } = {}) {
  let stored = missing ? null : { event_key: "productplus;2026", team_code: "001234",
    team_name: "Team", video_url: "video", upvotes: 0, downvotes: 0 };
  const votes = new Set();
  const updates = [];
  const db = {
    async getOneCustom(params) {
      assert.equal(params.Key.team_code, "config");
      assert.equal(params.Key.event_key, "productplus;2026");
      return config === undefined ? { submission_deadline: new Date(now).toISOString(),
        voting_deadline: new Date(now + 1000).toISOString() } : config;
    },
    async scan(table, params) {
      const data = rows || [{ event_key: "productplus;2026", team_code: "001234", team_name: "Team", video_url: "video",
        voter_ids: votes, upvotes: 999, downvotes: 999, prd_path: "secret", graded_submissions: [] }];
      return scan(data, params);
    },
    async updateDBCustom(params) {
      updates.push(params);
      assert.equal(params.Key.event_key, "productplus;2026");
      assert.equal(params.Key.team_code, "001234");
      stored = update(stored, params);
    }
  };
  const context = vm.createContext({ module: { exports: {} },
    process: { env: { PRODUCT_PLUS_EVENT_KEY: "productplus;2026" } },
    console: { error() {} }, Set, db,
    Date: class extends Date { static now() { return time; } },
    Math: Object.assign(Object.create(Math), { random })
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const event = (body = { team_code: "001234", choice: "accept" }, loggedIn = true) => ({
    body: JSON.stringify(body), headers: {}, requestContext: loggedIn ? {
      authorizer: { claims: { email: "User@Example.com", email_verified: "true" } }
    } : {}
  });
  return { ...context.module.exports, event, updates, votes,
    get counters() { return stored || { upvotes: 0, downvotes: 0 }; },
    get stored() { return stored; } };
}
test("anonymous GET returns only public fields and null voting status", async () => {
  const f = fixture();
  const response = await f.audienceSubmissions(f.event({}, false));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { voting_opens_at: new Date(now).toISOString(),
    voting_deadline: new Date(now + 1000).toISOString(), voting_open: true,
    submissions: [{ team_code: "001234", team_name: "Team", video_url: "video", has_voted: null }] });
});
test("authenticated GET checks voter membership without leaking private fields", async () => {
  const f = fixture();
  f.votes.add("user@example.com");
  const response = await f.audienceSubmissions(f.event());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).submissions[0], {
    team_code: "001234", team_name: "Team", video_url: "video", has_voted: true
  });
  f.votes.clear();
  assert.equal(JSON.parse((await f.audienceSubmissions(f.event())).body).submissions[0].has_voted, false);
});
test("authenticated GET returns false when voter_ids is absent", async () => {
  const f = fixture({ rows: [{ event_key: "productplus;2026", team_code: "001234", team_name: "Team", video_url: "video" }] });
  assert.equal(JSON.parse((await f.audienceSubmissions(f.event())).body).submissions[0].has_voted, false);
});
test("lists only current-event submissions and excludes the config row", async () => {
  const f = fixture({ rows: [
    { event_key: "productplus;2026", team_code: "config", submission_deadline: "private" },
    { event_key: "other;2026", team_code: "001234", team_name: "Other", video_url: "other" },
    { event_key: "productplus;2026", team_code: "001234", team_name: "Current", video_url: "current" }
  ] });
  assert.deepEqual(JSON.parse((await f.audienceSubmissions(f.event({}, false))).body).submissions,
    [{ team_code: "001234", team_name: "Current", video_url: "current", has_voted: null }]);
});
test("an event with no submissions returns an empty list and voting metadata", async () => {
  const f = fixture({ rows: [] });
  const response = JSON.parse((await f.audienceSubmissions(f.event({}, false))).body);
  assert.deepEqual(response.submissions, []);
  assert.equal(response.voting_opens_at, new Date(now).toISOString());
  assert.equal(response.voting_deadline, new Date(now + 1000).toISOString());
  assert.equal(response.voting_open, true);
});
test("public GET does not infer identity from an Authorization header", async () => {
  const f = fixture(); const event = f.event({}, false);
  event.headers.Authorization = "Bearer token-not-verified-by-gateway";
  assert.equal(JSON.parse((await f.audienceSubmissions(event)).body).submissions[0].has_voted, null);
});
test("GET treats unverified email claims as anonymous", async () => {
  const f = fixture(); const event = f.event();
  event.requestContext.authorizer.claims.email_verified = "false";
  assert.equal(JSON.parse((await f.audienceSubmissions(event)).body).submissions[0].has_voted, null);
});
test("each request shuffles without dropping, duplicating, or modifying submissions", async () => {
  const rows = ["000001", "000002", "000003"].map(team_code => ({ event_key: "productplus;2026", team_code, team_name: team_code, video_url: team_code }));
  let random = 0;
  const f = fixture({ rows, random: () => random });
  const first = JSON.parse((await f.audienceSubmissions(f.event({}, false))).body).submissions;
  random = 0.99;
  const second = JSON.parse((await f.audienceSubmissions(f.event({}, false))).body).submissions;
  const byCode = list => [...list].sort((a, b) => a.team_code.localeCompare(b.team_code));
  assert.deepEqual(byCode(first), rows.map(({ event_key, ...row }) => ({ ...row, has_voted: null })));
  assert.deepEqual(byCode(first), byCode(second));
  assert.notDeepEqual(first, second);
});
test("simultaneous clicks count once, reject repeats, and ignore supplied identity", async () => {
  const f = fixture();
  const results = await Promise.all([1, 2].map(() => f.audienceVote(f.event({ team_code: "001234", choice: "accept", user_id: "spoof" }))));
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(f.counters.upvotes, 1); assert.equal(f.counters.downvotes, 0);
  assert.deepEqual([...f.stored.voter_ids], ["user@example.com"]);
  assert.equal(f.updates.length, 2);
  assert.deepEqual(JSON.parse(results.find(r => r.statusCode === 200).body), { has_voted: true });
});
test("reject increments downvotes; missing submission never creates a vote", async () => {
  const f = fixture();
  assert.equal((await f.audienceVote(f.event({ team_code: "001234", choice: "reject" }))).statusCode, 200);
  assert.equal(f.counters.downvotes, 1);
  const missing = fixture({ missing: true });
  assert.equal((await missing.audienceVote(missing.event())).statusCode, 409);
  assert.equal(missing.stored, null);
});
test("first vote creates voter_ids and performs both changes in one write", async () => {
  const f = fixture();
  assert.equal(f.stored.voter_ids, undefined);
  const response = await f.audienceVote(f.event());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { has_voted: true });
  assert.deepEqual([...f.stored.voter_ids], ["user@example.com"]);
  assert.equal(f.stored.upvotes, 1);
  assert.equal(f.stored.downvotes, 0);
  assert.equal(f.updates.length, 1);
});
test("different users can vote and an existing voter cannot change their choice", async () => {
  const f = fixture();
  const initial = structuredClone(f.stored);
  assert.equal((await f.audienceVote(f.event())).statusCode, 200);
  const second = f.event({ team_code: "001234", choice: "reject" });
  second.requestContext.authorizer.claims.email = "second@example.com";
  assert.equal((await f.audienceVote(second)).statusCode, 200);
  const beforeRepeat = structuredClone(f.stored);
  assert.equal((await f.audienceVote(f.event({ team_code: "001234", choice: "reject" }))).statusCode, 409);
  assert.deepEqual(f.stored, beforeRepeat);
  assert.equal(f.stored.upvotes, 1);
  assert.equal(f.stored.downvotes, 1);
  assert.deepEqual([...f.stored.voter_ids].sort(), ["second@example.com", "user@example.com"]);
  for (const field of ["event_key", "team_code", "team_name", "video_url"])
    assert.deepEqual(f.stored[field], initial[field]);
});
test("vote is permitted one millisecond before the closing deadline", async () => {
  const f = fixture({ time: now + 999 });
  assert.equal((await f.audienceVote(f.event())).statusCode, 200);
});
for (const time of [now - 1, now + 1000]) test(`voting closed at ${time}`, async () => {
  const f = fixture({ time });
  assert.equal((await f.audienceVote(f.event())).statusCode, 403);
  assert.equal(f.updates.length, 0);
  assert.equal(JSON.parse((await f.audienceSubmissions(f.event({}, false))).body).voting_open, false);
});
test("auth and invalid bodies are rejected without writes", async () => {
  const f = fixture();
  assert.equal((await f.audienceVote(f.event({}, false))).statusCode, 401);
  for (const body of [{}, [], null, { team_code: "config", choice: "accept" }, { team_code: "001234", choice: "bad" }])
    assert.equal((await f.audienceVote(f.event(body))).statusCode, 406);
  const event = f.event(); event.body = "{";
  assert.equal((await f.audienceVote(event)).statusCode, 406);
  assert.equal(f.updates.length, 0);
});
test("missing deadlines fail closed", async () => {
  const f = fixture({ config: null });
  assert.equal((await f.audienceVote(f.event())).statusCode, 503);
  assert.equal(f.updates.length, 0);
});
test("gateway keeps GET public and POST Cognito protected", () => {
  const { functions } = YAML.parse(readFileSync(new URL("../serverless.yml", import.meta.url), "utf8"));
  assert.equal(functions.productPlusAudienceSubmissions.events[0].http.authorizer, undefined);
  const [publicRoute, selfRoute] = functions.productPlusAudienceSubmissions.events.map(event => event.http);
  assert.equal(publicRoute.path, "productplus/audience/submissions");
  assert.equal(selfRoute.path, "productplus/audience/submissions/self");
  assert.equal(selfRoute.method, "get");
  assert.equal(selfRoute.authorizer.type, "COGNITO_USER_POOLS");
  assert.equal(selfRoute.authorizer.authorizerId, functions.productPlusAudienceVote.events[0].http.authorizer.authorizerId);
  assert.equal(functions.productPlusAudienceVote.events[0].http.authorizer.type, "COGNITO_USER_POOLS");
});




