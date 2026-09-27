import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import YAML from "yaml";

// Keep real auth and validation; replace only external infrastructure.
const mocks = {
  "../../lib/db.js": "export default globalThis.infrastructure.db;",
  "../registrations/helpers.js": "export default {};",
  "uuid": "export const v4 = () => 'feedback-test-id';",
  "@aws-sdk/client-s3": "export class S3Client {} export class PutObjectCommand {}",
  "@aws-sdk/s3-request-presigner": "export const getSignedUrl = () => {};",
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

function fixture(formType, enabled = true) {
  const writes = [];
  const db = {
    async getOne() {
      return { id: "test-event", year: 2026, [`${formType}FeedbackEnabled`]: enabled };
    },
    async put(item) { writes.push(item); },
  };
  const context = vm.createContext({
    module: { exports: {} }, process: { env: {} }, console,
    infrastructure: { db },
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const event = (payload = {}) => ({
    pathParameters: { id: "test-event", year: "2026", formType },
    body: JSON.stringify({
      respondentName: "Guest", respondentEmail: " Guest@Example.com ",
      responses: { "overall-rating": 8 }, ...payload,
    }),
  });
  return { handler: context.module.exports, event, writes };
}

for (const formType of ["attendee", "partner"]) {
  test(`${formType}: anonymous feedback saves supplied contact details`, async () => {
    const { handler, event, writes } = fixture(formType);
    assert.equal((await handler.submitFeedback(event())).statusCode, 201);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].respondentEmail, "guest@example.com");
    assert.equal(writes[0].formType, formType);
    assert.equal(writes[0].responses["overall-rating"], 8);
  });

  test(`${formType}: email remains optional`, async () => {
    const { handler, event, writes } = fixture(formType);
    assert.equal((await handler.submitFeedback(event({ respondentEmail: undefined }))).statusCode, 201);
    assert.equal(writes[0].respondentEmail, undefined);
  });

  for (const payload of [{ respondentEmail: "invalid" }, { responses: {} }]) {
    test(`${formType}: rejects invalid payload ${JSON.stringify(payload)}`, async () => {
      const { handler, event, writes } = fixture(formType);
      assert.equal((await handler.submitFeedback(event(payload))).statusCode, 406);
      assert.equal(writes.length, 0);
    });
  }

  test(`${formType}: disabled form cannot accept feedback`, async () => {
    const { handler, event, writes } = fixture(formType, false);
    assert.equal((await handler.submitFeedback(event())).statusCode, 403);
    assert.equal(writes.length, 0);
  });

  test(`${formType}: anonymous callers cannot read submissions`, async () => {
    const { handler, event } = fixture(formType);
    assert.equal((await handler.getFeedbackSubmissions(event())).statusCode, 401);
  });
}

test("gateway allows public submission but still protects response access", () => {
  const { functions } = YAML.parse(readFileSync(new URL("../serverless.yml", import.meta.url), "utf8"));
  assert.equal(functions.eventSubmitFeedback.events[0].http.authorizer, undefined);
  assert.equal(functions.eventGetFeedbackSubmissions.events[0].http.authorizer.type, "COGNITO_USER_POOLS");
});
