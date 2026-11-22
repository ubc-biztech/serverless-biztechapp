import assert from "node:assert/strict";
import { test } from "node:test";
import { claims, isolateHandler } from "../../../test/helpers.mjs";

const load = await isolateHandler("services/events/handler.ts", {
  "../../lib/db.js": "export default globalThis.infrastructure.db;",
  "../registrations/helpers.js": "export default {};",
  "uuid": "export const v4 = () => 'test-id';",
  "@aws-sdk/client-s3": "export class S3Client {} export class PutObjectCommand {}",
  "@aws-sdk/s3-request-presigner": "export const getSignedUrl = () => {};",
});

function fixture(method, btxEnabled) {
  const writes = [];
  const handler = load({ db: {
    async getOne() { return method === "create" ? null : { id: "kickstart", year: 2026, capac: 10 }; },
    async create(item) { writes.push(item); return {}; },
    createUpdateExpression(data) {
      writes.push(data);
      return { updateExpression: "SET btxEnabled = :flag", expressionAttributeValues: { ":flag": data.btxEnabled }, expressionAttributeNames: {} };
    },
    async updateDBCustom() { return {}; },
  } });
  return { writes, run: () => handler[method]({
    requestContext: claims("organizer@ubcbiztech.com"),
    pathParameters: { id: "kickstart", year: "2026" },
    body: JSON.stringify({ id: "kickstart", year: 2026, capac: 10, ...(btxEnabled === undefined ? {} : { btxEnabled }) }),
  }) };
}

for (const method of ["create", "update"]) {
  test(`${method} persists either boolean value for btxEnabled`, async () => {
    for (const enabled of [true, false]) {
      const f = fixture(method, enabled);
      assert.equal((await f.run()).statusCode, method === "create" ? 201 : 200);
      assert.equal(f.writes[0].btxEnabled, enabled);
    }
  });
  test(`${method} rejects a string instead of a boolean without writing`, async () => {
    const f = fixture(method, "true");
    assert.equal((await f.run()).statusCode, 400);
    assert.equal(f.writes.length, 0);
  });
}

test("existing event creation can omit btxEnabled", async () => {
  const f = fixture("create");
  assert.equal((await f.run()).statusCode, 201);
  assert.equal(f.writes[0].btxEnabled, undefined);
});
