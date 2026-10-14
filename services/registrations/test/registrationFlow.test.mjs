import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Bundle the real handlers with isolated infrastructure so these regressions
// run without AWS credentials, database writes, or outgoing notifications.
const mocks = {
  "../../lib/docClient": "export default {};",
  "../../lib/db": "export default globalThis.infrastructure.db;",
  "./helpers": "export default {};",
  "../../lib/snsHelper": "export const sendSNSNotification = async () => {};",
  "./EmailService/SESEmailService":
    "export default class { async sendDynamicQR(...args) { globalThis.infrastructure.emails.push(args); } }",
};
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../handler.js", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [{
    name: "isolated-infrastructure",
    setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path }) =>
        Object.hasOwn(mocks, path) ? { path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path] }));
    },
  }],
});

function fixture() {
  const reads = [];
  const writes = [];
  const emails = [];
  const db = {
    async getOne(id, table, key) {
      reads.push({ id, table, key });
      return id === "hello-hacks" ? { id, year: 2026 } : null;
    },
    createUpdateExpression(data) {
      writes.push(data);
      return { updateExpression: "set registrationStatus = :status", expressionAttributeValues: {}, expressionAttributeNames: {} };
    },
    async updateDBCustom(params) { writes.at(-1).databaseKey = params.Key; return {}; },
  };
  const context = vm.createContext({ module: { exports: {} }, process: { env: {} }, console: { log() {}, error() {} }, infrastructure: { db, emails } });
  vm.runInContext(bundle.outputFiles[0].text, context);
  return { handler: context.module.exports, reads, writes, emails };
}

for (const email of ["Applicant@Example.com", "Applicant%40Example.com", "Applicant%2Bteam%40Example.com", "Applicant+team@Example.com"]) {
  test(`cancels a registration for ${email}`, async () => {
    const { handler, reads, writes, emails } = fixture();
    const response = await handler.put({
      pathParameters: { email, fname: "Mary%20Jane" },
      body: JSON.stringify({ eventID: "hello-hacks", year: 2026, registrationStatus: "cancelled" }),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(writes[0].registrationStatus, "cancelled");
    assert.equal(writes[0].databaseKey.id, decodeURIComponent(email).toLowerCase());
    assert.equal(writes[0].databaseKey["eventID;year"], "hello-hacks;2026");
    assert.equal(emails[0][1].fname, "Mary Jane");
    assert.ok(reads.some(({ id }) => id === decodeURIComponent(email).toLowerCase()));
  });
}

for (const email of ["bad%ZZ", "not-an-email", "Applicant%2540Example.com"]) {
  test(`rejects invalid or double-encoded email ${email} without writing`, async () => {
    const { handler, writes } = fixture();
    const response = await handler.put({
      pathParameters: { email },
      body: JSON.stringify({ eventID: "hello-hacks", year: 2026, registrationStatus: "cancelled" }),
    });
    assert.equal(response.statusCode, 406);
    assert.equal(writes.length, 0);
  });
}

test("new HelloHacks registration preserves free-text dietary restrictions", async () => {
  const { handler, writes } = fixture();
  const response = await handler.post({ body: JSON.stringify({
    email: "applicant@example.com", fname: "Applicant", eventID: "hello-hacks", year: 2026,
    registrationStatus: "incomplete", applicationStatus: "incomplete",
    basicInformation: { year: "2", diet: "Nut allergy; dairy-free" },
  }) });
  assert.equal(response.statusCode, 201);
  assert.equal(writes[0].basicInformation.diet, "Nut allergy; dairy-free");
  assert.equal(writes[0].basicInformation.year, "2");
});
