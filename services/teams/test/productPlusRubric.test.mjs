import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import YAML from "yaml";
import { update } from "./dynamoFixture.mjs";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../handlerProductPlus.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "database", setup(build) {
    build.onResolve({ filter: /^\.\.\/\.\.\/lib\/db.js$/ }, () => ({ path: "db", namespace: "mock" }));
    build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export default globalThis.db;" }));
  } }]
});
const now = Date.parse("2026-10-06T12:00:00Z");
const existing = { judge_user_id: "other@ubcbiztech.com", scores: [2, 2, 2, 2, 2], comments: "Other" };
function fixture({ missing = false, conflict = false, failure, deleteOnWrite = false } = {}) {
  let row = missing ? null : {
    event_key: "productplus;2026", team_code: "001234", team_name: "Team",
    prd_path: "private", member_names: ["Member"], video_url: "video", submitted_at: new Date(now - 1000).toISOString(),
    upvotes: 7, downvotes: 2, voter_ids: new Set(["voter"]),
    graded_submissions: [structuredClone(existing)],
    updated_at: new Date(now).toISOString()
  };
  const writes = []; let reads = 0; let conflicts = 0;
  const db = {
    async getOneCustom(params) {

      assert.deepEqual(JSON.parse(JSON.stringify(params.Key)), { event_key: "productplus;2026", team_code: "001234" });
      reads++;
      return structuredClone(row);
    },
    async updateDBCustom(params) {
      writes.push(params);
      if (failure) throw failure;
      if (deleteOnWrite) row = null;
      if (conflict) throw { type: "ConditionalCheckFailedException" };
      try { row = update(row, params); }
      catch (error) { if (error.type === "ConditionalCheckFailedException") conflicts++; throw error; }
    }
  };
  const context = vm.createContext({ module: { exports: {} }, db, process: { env: { PRODUCT_PLUS_EVENT_KEY: "productplus;2026" } },
    console: { error() {} }, Date: class extends Date { static now() { return now; } } });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const event = (email = "judge@ubcbiztech.com", body = { scores: [1, 2, 3, 4, 5], comments: "Feedback" }) => ({
    body: JSON.stringify(body), pathParameters: { team_code: "001234" },
    requestContext: email ? { authorizer: { claims: { email, email_verified: "true" } } } : {}
  });
  return { save: context.module.exports.saveRubric, event, writes,
    get row() { return row; }, get reads() { return reads; }, get conflicts() { return conflicts; } };
}
test("admin creates and replaces only their rubric, using authenticated identity", async () => {
  const f = fixture();
  const fields = structuredClone(f.row);
  const response = await f.save(f.event("judge@ubcbiztech.com", {
    scores: [1, 2, 3, 4, 5], comments: "Feedback", judge_user_id: "spoof"
  }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { judge_user_id: "judge@ubcbiztech.com", scores: [1, 2, 3, 4, 5], comments: "Feedback" });
  assert.deepEqual(f.row.graded_submissions[0], existing);
  assert.equal((await f.save(f.event("judge@ubcbiztech.com", { scores: [5, 5, 5, 5, 5], comments: "Revised" }))).statusCode, 200);
  assert.equal(f.row.graded_submissions.length, 2);
  assert.equal(f.row.graded_submissions[1].comments, "Revised");
  for (const key of Object.keys(fields).filter(key => !["graded_submissions", "updated_at"].includes(key)))
    assert.deepEqual(f.row[key], fields[key]);
});
test("two simultaneous judges both survive the conflict and reread", async () => {
  const f = fixture();
  const responses = await Promise.all([f.save(f.event("first@ubcbiztech.com")), f.save(f.event("second@ubcbiztech.com"))]);
  assert.deepEqual(responses.map(r => r.statusCode), [200, 200]);
  assert.ok(f.conflicts > 0);

  assert.deepEqual(f.row.graded_submissions.map(r => r.judge_user_id).sort(),
    ["first@ubcbiztech.com", "other@ubcbiztech.com", "second@ubcbiztech.com"]);
});
test("auth rejects anonymous and non-admin callers before any database read", async () => {
  const f = fixture();
  assert.equal((await f.save(f.event(null))).statusCode, 401);
  assert.equal((await f.save(f.event("user@example.com"))).statusCode, 403);
  assert.equal(f.reads, 0);
});
test("admin group access uses authenticated identity without requiring a BizTech email", async () => {
  const f = fixture(); const event = f.event("group-admin@example.com");
  event.requestContext.authorizer.claims["cognito:groups"] = "admin";
  const response = await f.save(event);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).judge_user_id, "group-admin@example.com");
});
test("unverified admin email is rejected before saving", async () => {
  const f = fixture(); const event = f.event();
  event.requestContext.authorizer.claims.email_verified = "false";
  assert.equal((await f.save(event)).statusCode, 401);
  assert.equal(f.writes.length, 0);
});
// Expected invalid inputs follow the API contract, independently of the handler.
for (const [label, body] of [
  ["null body", null], ["array body", []], ["missing scores", { comments: "" }],
  ["four scores", { scores: [1, 2, 3, 4], comments: "" }],
  ["six scores", { scores: [1, 2, 3, 4, 5, 5], comments: "" }],
  ["non-array scores", { scores: { length: 5 }, comments: "" }],
  // Provisional 1–5 rubric range from the handoff, pending criteria confirmation.
  ...[0, 6, "3", null].map(score => [`invalid score ${JSON.stringify(score)}`, { scores: [1, 2, score, 4, 5], comments: "" }]),
  ...[undefined, null, false, 0, 1].map(comments => [`invalid comments ${String(comments)}`, { scores: [1, 2, 3, 4, 5], comments }])
]) {
  test(`rejects ${label} without changing a submission`, async () => {
    const f = fixture(); const before = structuredClone(f.row);
    const response = await f.save(f.event(undefined, body));
    assert.ok(response.statusCode >= 400 && response.statusCode < 500, `Expected client error, got ${response.statusCode}`);
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.row, before);
  });
}
test("malformed JSON and missing or config team codes are rejected", async () => {
  const f = fixture();
  const badJson = f.event(); badJson.body = "{";
  assert.equal((await f.save(badJson)).statusCode, 406);
  for (const team_code of [undefined, "config"]) {
    const event = f.event(); event.pathParameters = { team_code };
    assert.equal((await f.save(event)).statusCode, 406);
  }
  assert.equal(f.writes.length, 0);
});
test("empty comments are allowed", async () => {
  const f = fixture();
  assert.equal((await f.save(f.event(undefined, { scores: [1, 2, 3, 4, 5], comments: "" }))).statusCode, 200);
  assert.equal(f.row.graded_submissions[1].comments, "");
});
test("requires submission; deletion during save cannot recreate it", async () => {
  const missing = fixture({ missing: true });
  assert.equal((await missing.save(missing.event())).statusCode, 404);
  assert.equal(missing.writes.length, 0);
  const deleted = fixture({ deleteOnWrite: true });
  assert.equal((await deleted.save(deleted.event())).statusCode, 404);
  assert.equal(deleted.row, null);
});
test("retries are bounded and unrelated database errors are not retried", async () => {
  const f = fixture({ conflict: true });
  assert.equal((await f.save(f.event())).statusCode, 409);
  assert.ok(f.writes.length > 1);
  const failed = fixture({ failure: new Error("unavailable") });
  assert.equal((await failed.save(failed.event())).statusCode, 500);
  assert.equal(failed.writes.length, 1);
});
test("first rubric is saved on an existing submission with no saved rubrics", async () => {
  const f = fixture(); f.row.graded_submissions = [];
  assert.equal((await f.save(f.event())).statusCode, 200);
  assert.deepEqual(f.row.graded_submissions, [{ judge_user_id: "judge@ubcbiztech.com", scores: [1, 2, 3, 4, 5], comments: "Feedback" }]);
});
test("rubric route uses the existing Cognito authorizer", () => {
  const { functions } = YAML.parse(readFileSync(new URL("../serverless.yml", import.meta.url), "utf8"));
  const route = functions.productPlusSaveRubric.events[0].http;
  assert.equal(route.path, "productplus/admin/submissions/{team_code}/rubric");
  assert.equal(route.method, "put");
  assert.equal(route.authorizer.type, "COGNITO_USER_POOLS");
});


