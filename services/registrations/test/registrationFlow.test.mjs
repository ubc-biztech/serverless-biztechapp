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
  "@sendgrid/mail": "export default { setApiKey() {} };",
  "ics": "export function createEvent() {}",
  "../../lib/snsHelper": "export const sendSNSNotification = async () => {};",
  "./EmailService/SESEmailService":
    "export default class { async sendDynamicQR(...args) { globalThis.infrastructure.emails.push(args); } async sendCalendarInvite() {} }",
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

const admin = { email: "admin@example.com", email_verified: "true", "cognito:groups": "admin" };

function batchEvent(updates, claims = admin) {
  return {
    requestContext: { authorizer: { claims } },
    body: JSON.stringify({ eventID: "product+", eventYear: 2026, updates }),
  };
}

function fixture({ event = {}, registrations = [], members = [] } = {}) {
  const reads = [];
  const writes = [];
  const emails = [];
  const queries = [];
  const db = {
    async getOne(id, table, key) {
      reads.push({ id, table, key });
      if (id === "hello-hacks" || id === "product+") return { id, year: 2026, ...event };
      if (members.includes(id) && key === undefined) return { id };
      return registrations.find((registration) => registration.id === id) ?? null;
    },
    async query(table, index, key) {
      queries.push({ table, index, key });
      return registrations;
    },
    createUpdateExpression(data) {
      writes.push(data);
      return { updateExpression: "set registrationStatus = :status", expressionAttributeValues: {}, expressionAttributeNames: {} };
    },
    async updateDBCustom(params) {
      const write = writes.at(-1);
      write.databaseKey = params.Key;
      return { Attributes: { registrationStatus: write.registrationStatus, applicationStatus: write.applicationStatus } };
    },
  };
  const context = vm.createContext({ module: { exports: {} }, process: { env: {} }, console: { log() {}, error() {} }, infrastructure: { db, emails } });
  vm.runInContext(bundle.outputFiles[0].text, context);
  return { handler: context.module.exports, reads, writes, emails, queries };
}

for (const email of ["Applicant@Example.com", "Applicant%40Example.com", "Applicant%2Bteam%40Example.com", "Applicant+team@Example.com"]) {
  test(`cancels a registration for ${email}`, async () => {
    const { handler, reads, writes, emails } = fixture();
    const response = await handler.put({
      pathParameters: { email, fname: "Mary%20Jane" },
      body: JSON.stringify({ eventID: "hello-hacks", year: 2026, registrationStatus: "cancelled" }),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).registrationStatus, "cancelled");
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

test("bulk application updates report the written application status", async () => {
  const { handler, reads, writes } = fixture();
  const email = "applicant@example.com";
  const response = await handler.massUpdate(batchEvent([
    { email, fname: "Applicant", applicationStatus: "rejected" },
  ]));

  assert.equal(response.statusCode, 200);
  const { results } = JSON.parse(response.body);
  assert.equal(results.length, 1);
  assert.equal(results[0].email, email);
  assert.equal(results[0].success, true);
  assert.equal(results[0].response.statusCode, 200);
  const result = JSON.parse(results[0].response.body);
  assert.equal(result.applicationStatus, "rejected");
  assert.match(result.message, /updated application status to 'rejected'/);
  assert.equal(Object.hasOwn(result, "registrationStatus"), false);
  assert.equal(writes[0].applicationStatus, "rejected");
  assert.equal(Object.hasOwn(writes[0], "registrationStatus"), false);
  assert.equal(writes[0].databaseKey.id, email);
  assert.equal(writes[0].databaseKey["eventID;year"], "product+;2026");
  assert.ok(reads.some(({ id, key }) => id === "product+" && key.year === 2026));
});

test("bulk registration status updates require a verified admin", async () => {
  const { handler, writes } = fixture();
  const updates = [{ email: "applicant@example.com", registrationStatus: "checkedIn" }];
  const anonymous = await handler.massUpdate(batchEvent(updates, null));
  const member = await handler.massUpdate(batchEvent(updates, {
    email: "member@example.com",
    email_verified: "true",
  }));
  assert.equal(anonymous.statusCode, 401);
  assert.equal(member.statusCode, 403);
  assert.equal(writes.length, 0);
});

test("bulk registration status updates reject invalid rows and save valid rows", async () => {
  const { handler, writes } = fixture();
  const response = await handler.massUpdate(batchEvent([
    { email: "rejected@example.com", registrationStatus: "rejected" },
    { email: "ambiguous@example.com", registrationStatus: "checkedIn", applicationStatus: "accepted" },
    { email: "applicant@example.com", registrationStatus: "checkedIn" },
  ]));

  assert.equal(response.statusCode, 200);
  const { results } = JSON.parse(response.body);
  assert.deepEqual(results.map(({ success, registrationStatus }) => [success, registrationStatus]), [
    [false, undefined], [false, undefined], [true, "checkedIn"],
  ]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].databaseKey["eventID;year"], "product+;2026");
  assert.equal(writes[0].registrationStatus, "checkedIn");
  assert.equal(Object.hasOwn(writes[0], "applicationStatus"), false);
});

test("bulk acceptance uses the same member pricing transition as a single update", async () => {
  const { handler, writes } = fixture({
    event: { pricing: { members: 50, nonMembers: 0 } },
    members: ["paid@example.com"],
  });
  const response = await handler.massUpdate(batchEvent([
    { email: "free@example.com", registrationStatus: "accepted" },
    { email: "paid@example.com", registrationStatus: "accepted" },
  ]));

  assert.equal(response.statusCode, 200);
  const { results } = JSON.parse(response.body);
  assert.deepEqual(results.map(({ registrationStatus }) => registrationStatus), ["acceptedPending", "accepted"]);
  assert.equal(writes.find((write) => write.databaseKey.id === "free@example.com").registrationStatus, "acceptedPending");
  assert.equal(writes.find((write) => write.databaseKey.id === "paid@example.com").registrationStatus, "accepted");
});

test("bulk registration accounts for each write when assigning the final slot", async () => {
  const { handler, writes, queries } = fixture({
    event: { capac: 2 },
    registrations: [{ id: "existing@example.com", registrationStatus: "registered" }],
  });
  const response = await handler.massUpdate(batchEvent([
    { email: "first@example.com", registrationStatus: "registered" },
    { email: "second@example.com", registrationStatus: "registered" },
    { email: "existing@example.com", registrationStatus: "registered" },
  ]));

  assert.equal(response.statusCode, 200);
  assert.equal(queries.length, 1);
  const expected = ["registered", "waitlist", "registered"];
  const { results } = JSON.parse(response.body);
  assert.deepEqual(results.map(({ registrationStatus }) => registrationStatus), expected);
  assert.deepEqual(writes.map(({ registrationStatus }) => registrationStatus), expected);
});
