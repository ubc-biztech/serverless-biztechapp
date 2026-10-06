import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import { build } from "esbuild";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

// Bundle the actual TypeScript handlers while retaining the SDK classes we mock.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../handler.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  packages: "external",
  write: false,
  logLevel: "silent"
});
const module = { exports: {} };
compileFunction(bundle.outputFiles[0].text, [
  "require", "module", "exports", "process", "Buffer", "console"
])(
  createRequire(import.meta.url), module, module.exports, process, Buffer,
  { error() {} }
);
const { getConfig, putConfig } = module.exports;
const database = mockClient(DynamoDBDocumentClient);
const originalEnvironment = Object.fromEntries(
  ["PRODUCTPLUS_SUBMISSIONS_TABLE", "PRODUCTPLUS_EVENT_KEY"].map(key => [key, process.env[key]])
);
const publicConfig = {
  submission_deadline: "2026-11-01T20:00:00.000Z",
  voting_deadline: "2026-11-02T20:00:00.000Z"
};

function event(body = null, claims = {}) {
  return {
    body: typeof body === "string" || body === null ? body : JSON.stringify(body),
    headers: {},
    pathParameters: null,
    queryStringParameters: null,
    requestContext: { authorizer: { claims: {
      email: "admin@example.com",
      email_verified: "true",
      "cognito:groups": "admin",
      ...claims
    } } }
  };
}

async function invoke(handler, request) {
  const result = await handler(request, {}, () => {});
  return { status: result.statusCode, body: JSON.parse(result.body) };
}

beforeEach(() => {
  database.reset();
  database.onAnyCommand().rejects(new Error("Unexpected database operation"));
  process.env.PRODUCTPLUS_SUBMISSIONS_TABLE = "biztechPPSubmissions";
  process.env.PRODUCTPLUS_EVENT_KEY = "productplus;2026";
});

after(() => {
  database.restore();
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("both endpoints reject anonymous, unverified, and non-admin callers before database access", async () => {
  for (const handler of [getConfig, putConfig]) {
    for (const [claims, status] of [
      [{ email: undefined }, 401],
      [{ email_verified: "false" }, 401],
      [{ "cognito:groups": "attendee" }, 403]
    ]) {
      assert.equal((await invoke(handler, event(publicConfig, claims))).status, status);
    }
  }
  assert.equal(database.calls().length, 0);
});

test("GET returns 404 when the configured event has no config", async () => {
  database.on(GetCommand).resolves({});
  const result = await invoke(getConfig, event());
  assert.equal(result.status, 404);
  assert.match(result.body.message, /not been set/);
  const input = database.commandCalls(GetCommand)[0].args[0].input;
  assert.equal(input.TableName, "biztechPPSubmissions");
  assert.deepEqual(input.Key, { event_key: "productplus;2026", team_code: "config" });
  assert.equal(input.ConsistentRead, true);
});

test("GET returns only public fields and recognizes the existing admin email rule", async () => {
  database.on(GetCommand).resolves({ Item: {
    ...publicConfig,
    event_key: "productplus;2026",
    team_code: "config",
    version: 7,
    updated_at: "2026-10-05T10:00:00.000Z",
    unrelated_attribute: "keep internal"
  } });
  const result = await invoke(getConfig, event(null, {
    email: "exec@ubcbiztech.com", "cognito:groups": ""
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, publicConfig);
});

test("PUT rejects invalid bodies, impossible UTC dates, and invalid deadline ordering without writes", async () => {
  const invalidBodies = [
    null, "{", "null", "[]", "true", "{}",
    { ...publicConfig, submission_deadline: undefined },
    { ...publicConfig, voting_deadline: undefined },
    { ...publicConfig, submission_deadline: "2026-02-30T12:00:00Z" },
    { ...publicConfig, submission_deadline: "2026-02-29T12:00:00Z" },
    { ...publicConfig, submission_deadline: "2026-11-01T24:00:00Z" },
    { ...publicConfig, submission_deadline: "2026-11-01T12:00:00-08:00" },
    { ...publicConfig, submission_deadline: "2026-11-01T12:00:00" },
    { ...publicConfig, submission_deadline: "2026-11-01" },
    { ...publicConfig, submission_deadline: 1234 },
    { ...publicConfig, voting_deadline: publicConfig.submission_deadline },
    { ...publicConfig, voting_deadline: "2026-10-01T20:00:00Z" },
    { ...publicConfig, event_key: "other-event;2026" },
    { ...publicConfig, version: 100 }
  ];
  for (const body of invalidBodies) {
    assert.equal((await invoke(putConfig, event(body))).status, 400, JSON.stringify(body));
  }
  assert.equal(database.calls().length, 0);
});

test("PUT preserves supplied UTC timestamps and atomically creates/updates only config attributes", async () => {
  const supplied = {
    submission_deadline: "2026-11-01T20:00:00+00:00",
    voting_deadline: "2026-11-02T20:00:00Z"
  };
  database.on(UpdateCommand).resolves({ Attributes: {
    ...supplied,
    version: 1,
    event_key: "productplus;2026",
    team_code: "config"
  } });
  const result = await invoke(putConfig, event(supplied));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, supplied);
  const input = database.commandCalls(UpdateCommand)[0].args[0].input;
  assert.equal(input.TableName, "biztechPPSubmissions");
  assert.deepEqual(input.Key, { event_key: "productplus;2026", team_code: "config" });
  assert.equal(input.ReturnValues, "ALL_NEW");
  assert.equal(input.ExpressionAttributeValues[":submission"], supplied.submission_deadline);
  assert.equal(input.ExpressionAttributeValues[":voting"], supplied.voting_deadline);
  assert.match(input.ExpressionAttributeValues[":updated"], /^\d{4}-\d{2}-\d{2}T.+Z$/);
  assert.deepEqual(Object.values(input.ExpressionAttributeNames).sort(), [
    "submission_deadline", "updated_at", "voting_deadline"
  ]);
  assert.doesNotMatch(input.UpdateExpression, /version/);
  assert.equal(database.commandCalls(GetCommand).length, 0);
});

test("PUT supports valid leap days and fractional seconds", async () => {
  const supplied = {
    submission_deadline: "2028-02-29T10:00:00.1Z",
    voting_deadline: "2028-02-29T10:00:00.12Z"
  };
  database.on(UpdateCommand).resolves({ Attributes: supplied });
  const request = event(supplied);
  const result = await invoke(putConfig, request);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, supplied);
  const input = database.commandCalls(UpdateCommand)[0].args[0].input;
  assert.equal(input.ExpressionAttributeValues[":submission"], supplied.submission_deadline);
  assert.equal(input.ExpressionAttributeValues[":voting"], supplied.voting_deadline);
});

test("GET and PUT use the configured PROD table without appending another suffix", async () => {
  process.env.PRODUCTPLUS_SUBMISSIONS_TABLE = "biztechPPSubmissionsPROD";
  database.on(GetCommand).resolves({ Item: publicConfig });
  database.on(UpdateCommand).resolves({ Attributes: publicConfig });
  assert.equal((await invoke(getConfig, event())).status, 200);
  assert.equal((await invoke(putConfig, event(publicConfig))).status, 200);
  assert(database.calls().every(call => call.args[0].input.TableName === "biztechPPSubmissionsPROD"));
});

test("server failures return generic 500 responses without leaking database errors", async () => {
  database.on(GetCommand).rejects(new Error("private database failure"));
  database.on(UpdateCommand).rejects(new Error("private database failure"));
  for (const [handler, request] of [[getConfig, event()], [putConfig, event(publicConfig)]]) {
    const result = await invoke(handler, request);
    assert.equal(result.status, 500);
    assert(!JSON.stringify(result.body).includes("private database failure"));
  }
});

test("GET rejects malformed stored config rather than returning an incomplete contract", async () => {
  database.on(GetCommand).resolves({ Item: {
    ...publicConfig, voting_deadline: undefined
  } });
  assert.equal((await invoke(getConfig, event())).status, 500);
});

test("missing deployment settings fail before accessing DynamoDB", async () => {
  for (const key of ["PRODUCTPLUS_SUBMISSIONS_TABLE", "PRODUCTPLUS_EVENT_KEY"]) {
    const original = process.env[key];
    delete process.env[key];
    assert.equal((await invoke(getConfig, event())).status, 500);
    assert.equal((await invoke(putConfig, event(publicConfig))).status, 500);
    process.env[key] = original;
  }
  assert.equal(database.calls().length, 0);
});
