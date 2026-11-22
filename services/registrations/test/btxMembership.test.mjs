import assert from "node:assert/strict";
import { test } from "node:test";
import { claims, condition, conflict, isolateHandler } from "../../../test/helpers.mjs";

const load = await isolateHandler("services/registrations/handler.js", {
  "../../lib/docClient.js": "export default globalThis.infrastructure.client;",
  "../../lib/snsHelper": "export const sendSNSNotification = async () => { globalThis.infrastructure.notifications++; };",
  "./helpers": "export default { getEventCounts: async () => ({ registeredCount: 0 }) };",
  "./EmailService/SESEmailService": "export default class { async sendCalendarInvite() { globalThis.infrastructure.notifications++; } async sendDynamicQR() { globalThis.infrastructure.notifications++; } }",
});
const email = "alice@example.com";

function fixture({ teamID, btxEnabled = true, registered = true } = {}) {
  const requests = [], writes = [];
  const registration = { id: email, "eventID;year": "kickstart;2026", registrationStatus: "acceptedPending", ...(teamID === undefined ? {} : { teamID }) };
  const f = { registration, requests, writes, notifications: 0 };
  f.handler = load({
    get notifications() { return f.notifications; },
    set notifications(value) { f.notifications = value; },
    client: { async send(command) {
      const input = command.input;
      requests.push(input);
      if (command.constructor.name === "GetCommand") return { Item: input.TableName === "biztechEvents"
        ? { id: "kickstart", year: 2026, btxEnabled } : registered ? registration : undefined };
      writes.push(structuredClone(input));
      if (command.constructor.name === "TransactWriteCommand" && f.onWrite) return f.onWrite(input.TransactItems);
      return {};
    } },
  });
  f.event = (body = {}, caller = email) => ({
    requestContext: claims(caller), pathParameters: { email, fname: "Alice" },
    body: JSON.stringify({ eventID: "kickstart", year: 2026, ...body }),
  });
  return f;
}

for (const route of ["post", "put"]) {
  test(`${route} cannot directly assign BTX membership or send side effects`, async () => {
    const f = fixture({ registered: route !== "post" });
    const result = await f.handler[route](f.event({ email, registrationStatus: "acceptedComplete", teamID: "123456" }));
    assert.equal(result.statusCode, 400);
    assert.equal(f.writes.length, 0);
    assert.equal(f.notifications, 0);
  });
}

test("an explicit null teamID cannot bypass membership protection", async () => {
  const f = fixture({ teamID: "123456" });
  assert.equal((await f.handler.put(f.event({ teamID: null }))).statusCode, 400);
  assert.equal(f.writes.length, 0);
});

test("ordinary registration updates do not overwrite an existing team assignment", async () => {
  const f = fixture({ teamID: "123456" });
  const result = await f.handler.updateHelper({ eventID: "kickstart", year: 2026, checkoutLink: "https://example.com/checkout" }, false, email, "Alice");
  assert.equal(result.statusCode, 200);
  const update = f.writes[0];
  assert.ok(!update.UpdateExpression.includes("teamID"));
  assert.ok(!Object.values(update.ExpressionAttributeNames).includes("teamID"));
});

test("individual deletion requires the owner or an admin", async () => {
  const f = fixture();
  assert.equal((await f.handler.del(f.event({}, "other@example.com"))).statusCode, 403);
  assert.equal(f.writes.length, 0);
});

test("unlinked deletion uses an atomic membership absence condition", async () => {
  const f = fixture();
  assert.equal((await f.handler.del(f.event())).statusCode, 200);
  assert.equal(f.writes.length, 1);
  const items = f.writes[0].TransactItems;
  assert.equal(items.length, 1);
  assert.match(condition(items[0].Delete), /attribute_not_exists\(teamID\)/);
});

test("linked membership or a join racing deletion returns a conflict", async () => {
  const f = fixture({ teamID: "123456" });
  f.onWrite = items => { throw conflict(items); };
  assert.equal((await f.handler.del(f.event())).statusCode, 409);
  assert.match(condition(f.writes[0].TransactItems[0].Delete), /attribute_not_exists\(teamID\)/);
});

test("bulk deletion requires an admin", async () => {
  const f = fixture();
  assert.equal((await f.handler.delMany(f.event({ ids: [email] }))).statusCode, 403);
  assert.equal(f.writes.length, 0);
});

test("admin bulk deletion deduplicates identities and guards every record in one transaction", async () => {
  const f = fixture();
  const result = await f.handler.delMany(f.event({ ids: [email.toUpperCase(), email, "bob@example.com"] }, "organizer@ubcbiztech.com"));
  assert.equal(result.statusCode, 200);
  assert.equal(f.writes.length, 1);
  const items = f.writes[0].TransactItems;
  assert.equal(items.length, 2);
  for (const item of items) assert.match(condition(item.Delete), /attribute_not_exists\(teamID\)/);
});

test("one linked record cancels an entire bulk deletion", async () => {
  const f = fixture();
  f.onWrite = items => { throw conflict(items, 1); };
  assert.equal((await f.handler.delMany(f.event({ ids: [email, "bob@example.com"] }, "organizer@ubcbiztech.com"))).statusCode, 409);
});

test("bulk deletion rejects more than 100 distinct registrations before writing", async () => {
  const f = fixture();
  const ids = Array.from({ length: 101 }, (_, i) => `attendee${i}@example.com`);
  assert.equal((await f.handler.delMany(f.event({ ids }, "organizer@ubcbiztech.com"))).statusCode, 400);
  assert.equal(f.writes.length, 0);
});

test("non-BTX events retain their legacy deletion path", async () => {
  const f = fixture({ btxEnabled: false, teamID: "123456" });
  assert.equal((await f.handler.del(f.event())).statusCode, 200);
  assert.equal(f.writes[0].TransactItems, undefined);
  assert.deepEqual(f.writes[0].Key, { id: email, "eventID;year": "kickstart;2026" });
});
