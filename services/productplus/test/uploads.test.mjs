import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import { build } from "esbuild";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

// Use the actual S3 signer with test credentials, without making AWS requests.
const environment = {
  AWS_REGION: "us-west-2",
  AWS_ACCESS_KEY_ID: "upload-test-access-key",
  AWS_SECRET_ACCESS_KEY: "upload-test-secret",
  AWS_SESSION_TOKEN: "upload-test-token",
  AWS_EC2_METADATA_DISABLED: "true",
  PRODUCTPLUS_EVENT_KEY: "productplus;2026",
  PRODUCTPLUS_SUBMISSIONS_TABLE: "biztechPPSubmissions",
  PRODUCTPLUS_UPLOADS_TABLE: "biztechPPUploads",
  PRODUCTPLUS_TEAMS_TABLE: "testTeams",
  PRODUCTPLUS_MEMBERSHIPS_TABLE: "testUserMemberships",
  PRODUCTPLUS_PRD_BUCKET: "biztech-pp-prd",
  PRODUCTPLUS_CLEANUP_FUNCTION: "biztechApi-productplus-dev-productplusCleanup"
};
const originalEnvironment = Object.fromEntries(
  Object.keys(environment).map(key => [key, process.env[key]])
);
Object.assign(process.env, environment);

const start = Date.parse("2026-10-05T12:00:00.250Z");
let clock = start;
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../handler.ts", import.meta.url))],
  bundle: true, platform: "node", target: "node22", format: "cjs",
  packages: "external", write: false, logLevel: "silent"
});
const module = { exports: {} };
compileFunction(bundle.outputFiles[0].text, [
  "require", "module", "exports", "process", "Buffer", "console", "Date"
])(
  createRequire(import.meta.url), module, module.exports, process, Buffer,
  { error() {} }, TestDate
);
const { createUpload } = module.exports;
const database = mockClient(DynamoDBDocumentClient);
const email = "member@example.com";
let config, membership, team;

function event(body = { content_type: "application/pdf" }, claims = {}) {
  return {
    body: typeof body === "string" || body === null ? body : JSON.stringify(body),
    headers: {}, pathParameters: null, queryStringParameters: null,
    requestContext: { authorizer: { claims: {
      email, email_verified: "true", "cognito:groups": "attendee", ...claims
    } } }
  };
}
async function invoke(request = event()) {
  const result = await createUpload(request, {}, () => {});
  return { status: result.statusCode, body: JSON.parse(result.body) };
}
function transaction() {
  return database.commandCalls(TransactWriteCommand).at(-1).args[0].input.TransactItems;
}
function signedExpiry(url) {
  const value = new URL(url).searchParams;
  const timestamp = value.get("X-Amz-Date");
  const iso = timestamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z");
  return Date.parse(iso) + Number(value.get("X-Amz-Expires")) * 1000;
}

beforeEach(() => {
  clock = start;
  Object.assign(process.env, environment);
  config = {
    event_key: environment.PRODUCTPLUS_EVENT_KEY, team_code: "config",
    submission_deadline: "2026-10-05T13:00:00Z",
    voting_deadline: "2026-10-06T13:00:00Z"
  };
  membership = { event_key: config.event_key, user_id: email, team_code: "012345" };
  team = { event_key: config.event_key, team_code: "012345", member_ids: new Set([email]),
    team_name: "Example Team", leader_user_id: email };
  database.reset();
  database.onAnyCommand().rejects(new Error("Unexpected database operation"));
  database.on(GetCommand).callsFake(input => {
    if (input.TableName === process.env.PRODUCTPLUS_SUBMISSIONS_TABLE) return { Item: config };
    if (input.TableName === process.env.PRODUCTPLUS_MEMBERSHIPS_TABLE) return { Item: membership };
    if (input.TableName === process.env.PRODUCTPLUS_TEAMS_TABLE) return { Item: team };
    throw new Error("Unexpected table");
  });
  database.on(TransactWriteCommand).resolves({});
});
after(() => {
  database.restore();
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("upload requires a verified caller before accessing storage", async () => {
  for (const claims of [{ email: undefined }, { email_verified: "false" }]) {
    assert.equal((await invoke(event(undefined, claims))).status, 401);
  }
  assert.equal(database.calls().length, 0);
});

test("upload accepts only the PDF content-type body and rejects caller-supplied ownership", async () => {
  for (const body of [null, "broken JSON", "null", "[]", {},
    { content_type: "image/png" }, { content_type: "application/pdf", team_code: "999999" }]) {
    assert.equal((await invoke(event(body))).status, 400);
  }
  assert.equal(database.calls().length, 0);
});

test("signed PUT uses the private bucket, unique team path and mandatory signed headers", async () => {
  const first = await invoke();
  const second = await invoke();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(Object.keys(first.body).sort(), ["prd_path", "upload_headers", "upload_method", "upload_url"]);
  assert.equal(first.body.upload_method, "PUT");
  assert.deepEqual(first.body.upload_headers, { "Content-Type": "application/pdf", "If-None-Match": "*" });
  assert.match(first.body.prd_path, /^productplus\/temp\/productplus;2026\/012345\/[\da-f-]{36}\/prd\.pdf$/);
  assert.notEqual(first.body.prd_path, second.body.prd_path);
  const url = new URL(first.body.upload_url);
  assert.equal(url.hostname, "biztech-pp-prd.s3.us-west-2.amazonaws.com");
  assert.equal(decodeURIComponent(url.pathname), `/${first.body.prd_path}`);
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  const headers = url.searchParams.get("X-Amz-SignedHeaders").split(";");
  assert.ok(headers.includes("content-type"));
  assert.ok(headers.includes("if-none-match"));
  // The actual browser PDF must not be constrained to an empty-body checksum.
  for (const key of url.searchParams.keys()) {
    assert.doesNotMatch(key.toLowerCase(), /checksum|acl/);
  }
});

test("tracking and membership/deadline conditions are written in one transaction", async () => {
  const result = await invoke(event(undefined, { email: " MEMBER@EXAMPLE.COM " }));
  assert.equal(result.status, 200);
  const [upload, membershipCheck, teamCheck, configCheck] = transaction();
  assert.equal(upload.Put.TableName, "biztechPPUploads");
  assert.equal(upload.Put.ConditionExpression, "attribute_not_exists(prd_path)");
  const item = upload.Put.Item;
  assert.equal(item.prd_path, result.body.prd_path);
  assert.equal(item.event_key, "productplus;2026");
  assert.equal(item.team_code, "012345");
  assert.equal(item.team_id, undefined);
  assert.ok(item.prd_path.includes(item.upload_id));
  assert.equal(item.content_type, "application/pdf");
  assert.equal(item.status, "pending");
  assert.equal(item.created_at, new Date(start).toISOString());
  assert.equal(item.updated_at, item.created_at);
  assert.equal(Date.parse(item.upload_expires_at), signedExpiry(result.body.upload_url));
  assert.deepEqual(membershipCheck.ConditionCheck.Key, { event_key: "productplus;2026", user_id: email });
  assert.deepEqual(membershipCheck.ConditionCheck.ExpressionAttributeValues, { ":code": team.team_code });
  assert.deepEqual(teamCheck.ConditionCheck.Key, { event_key: "productplus;2026", team_code: "012345" });
  assert.match(teamCheck.ConditionCheck.ConditionExpression, /contains\(#members, :email\)/);
  assert.deepEqual(teamCheck.ConditionCheck.ExpressionAttributeNames, { "#members": "member_ids" });
  assert.deepEqual(teamCheck.ConditionCheck.ExpressionAttributeValues, { ":email": email });
  assert.deepEqual(configCheck.ConditionCheck.Key, { event_key: "productplus;2026", team_code: "config" });
  assert.equal(configCheck.ConditionCheck.ExpressionAttributeValues[":deadline"], config.submission_deadline);
  for (const call of database.commandCalls(GetCommand)) assert.equal(call.args[0].input.ConsistentRead, true);
});

test("URL expires no later than fractional-second deadlines", async () => {
  config.submission_deadline = new Date(start + 10500).toISOString();
  const result = await invoke();
  assert.equal(result.status, 200);
  assert.equal(new URL(result.body.upload_url).searchParams.get("X-Amz-Expires"), "10");
  assert.ok(signedExpiry(result.body.upload_url) <= Date.parse(config.submission_deadline));
});

test("closed and sub-second windows reject without writing tracking", async () => {
  for (const milliseconds of [-1000, 0, 999]) {
    config.submission_deadline = new Date(start + milliseconds).toISOString();
    assert.equal((await invoke()).status, 403);
  }
  assert.equal(database.commandCalls(TransactWriteCommand).length, 0);
});

test("both event membership and the team's String Set must authorize the caller", async () => {
  membership = undefined;
  assert.equal((await invoke()).status, 403);
  membership = { event_key: "productplus;2026", user_id: email, team_code: team.team_code };
  const originalTeam = team;
  team = undefined;
  assert.equal((await invoke()).status, 403);
  team = { ...originalTeam, member_ids: new Set(["someone-else@example.com"]) };
  assert.equal((await invoke()).status, 403);
  team = { ...originalTeam, member_ids: [email] };
  assert.equal((await invoke()).status, 403);
  assert.equal(database.commandCalls(TransactWriteCommand).length, 0);
});

test("membership must provide a six-digit string, retaining leading zeros", async () => {
  for (const code of [undefined, 123456, "12345", "1234567", "abcdef"]) {
    membership.team_code = code;
    assert.equal((await invoke()).status, 409);
  }
  delete membership.team_code;
  assert.equal((await invoke()).status, 409);
  assert.equal(database.commandCalls(TransactWriteCommand).length, 0);
});

test("missing config returns 503 and invalid stored deadlines fail safely", async () => {
  config = undefined;
  assert.equal((await invoke()).status, 503);
  config = { submission_deadline: "invalid", voting_deadline: "invalid" };
  assert.equal((await invoke()).status, 500);
  assert.equal(database.commandCalls(TransactWriteCommand).length, 0);
});

test("conditional transaction failure returns conflict without releasing a URL", async () => {
  const error = Object.assign(new Error("Conditional transaction failed"), {
    name: "TransactionCanceledException",
    CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }]
  });
  database.on(TransactWriteCommand).rejects(error);
  const result = await invoke();
  assert.equal(result.status, 409);
  assert.match(result.body.message, /changed/);
  assert.equal(result.body.upload_url, undefined);
});

test("database failure returns a generic error and expiry during tracking returns no URL", async () => {
  database.on(TransactWriteCommand).rejects(new Error("Sensitive database details"));
  const failure = await invoke();
  assert.equal(failure.status, 500);
  assert.doesNotMatch(JSON.stringify(failure.body), /Sensitive/);
  config.submission_deadline = new Date(start + 10000).toISOString();
  database.on(TransactWriteCommand).callsFake(() => {
    clock = Date.parse(config.submission_deadline);
    return {};
  });
  const expired = await invoke();
  assert.equal(expired.status, 403);
  assert.equal(expired.body.upload_url, undefined);
  assert.equal(transaction()[0].Put.Item.status, "pending");
});

test("PROD table/bucket names use the injected environment", async () => {
  for (const key of ["PRODUCTPLUS_SUBMISSIONS_TABLE", "PRODUCTPLUS_UPLOADS_TABLE",
    "PRODUCTPLUS_TEAMS_TABLE", "PRODUCTPLUS_MEMBERSHIPS_TABLE"]) process.env[key] += "PROD";
  process.env.PRODUCTPLUS_PRD_BUCKET = "biztech-pp-prd-prod";
  const request = event({ content_type: "application/pdf" });
  const result = await invoke(request);
  assert.equal(result.status, 200);
  assert.equal(new URL(result.body.upload_url).hostname, "biztech-pp-prd-prod.s3.us-west-2.amazonaws.com");
  assert.deepEqual(transaction().map(item => (item.Put || item.ConditionCheck).TableName), [
    "biztechPPUploadsPROD", "testUserMembershipsPROD", "testTeamsPROD", "biztechPPSubmissionsPROD"
  ]);
});

test("missing upload environment fails before storage access", async () => {
  delete process.env.PRODUCTPLUS_PRD_BUCKET;
  assert.equal((await invoke()).status, 500);
  assert.equal(database.calls().length, 0);
});

test("unresolved team table names fail before AWS access in both environments", async () => {
  for (const suffix of ["", "PROD"]) {
    for (const [key, name] of [["PRODUCTPLUS_TEAMS_TABLE", "TODO_NEW_TEAMS_TABLE"],
      ["PRODUCTPLUS_MEMBERSHIPS_TABLE", "TODO_NEW_USER_MEMBERSHIPS_TABLE"]]) {
      Object.assign(process.env, environment);
      process.env[key] = name + suffix;
      assert.equal((await invoke()).status, 500);
    }
  }
  assert.equal(database.calls().length, 0);
});
