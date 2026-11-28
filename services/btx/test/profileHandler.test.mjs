import assert from "node:assert/strict";
import { test } from "node:test";
import { HeadObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { loadBtx } from "./load-btx.mjs";
import { claims, condition, conflict } from "../../../test/helpers.mjs";

const { client, tables, getCompanyProfile, patchCompanyProfile, postCompanyThumbnailUploadUrl } = await loadBtx(`
  export { default as client } from "../../lib/docClient.js";
  export * as tables from "./repos/tables";
  export { getCompanyProfile, patchCompanyProfile, postCompanyThumbnailUploadUrl } from "./profileHandler";
`);
const eventId = "kickstart;2026", teamId = "004218", projectId = eventId + ":" + teamId;
const email = "alice@example.com";
const request = (body, pathProjectId = projectId) => ({
  pathParameters: { projectId: pathProjectId }, requestContext: claims(email), body,
});

function fixture(t) {
  t.mock.method(Date, "now", () => 1000);
  const previous = { event: process.env.KICKSTART_EVENT_KEY, end: process.env.KICKSTART_EVENT_ENDS_AT };
  process.env.KICKSTART_EVENT_KEY = eventId;
  process.env.KICKSTART_EVENT_ENDS_AT = new Date(2000).toISOString();
  t.after(() => {
    for (const [key, value] of [["KICKSTART_EVENT_KEY", previous.event], ["KICKSTART_EVENT_ENDS_AT", previous.end]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const f = {
    company: { projectId, eventId, teamId, companyName: "Northstar", blurb: "", youtubeURL: "",
      seedStartedAt: null, seedSharesAtIpo: null },
    registration: { teamID: teamId }, team: { member_ids: new Set([email]) }, writes: [], failWrite: false,
    config: { projectId: "config:" + eventId, phase: "PRE_IPO", ipoAt: null },
  };
  t.mock.method(client, "send", async command => {
    const { Key, TableName } = command.input;
    if (command.constructor.name === "GetCommand") {
      assert.equal(command.input.ConsistentRead, true);
      if (TableName === tables.PROJECTS_TABLE) {
        if (Key.projectId === "config:" + eventId) return { Item: f.config };
        return { Item: Key.projectId === projectId ? f.company : undefined };
      }
      if (TableName === tables.REGISTRATIONS_TABLE) return { Item: f.registration };
      if (TableName === tables.TEAMS_TABLE) return { Item: f.team };
    }
    assert.equal(command.constructor.name, "TransactWriteCommand");
    f.writes.push(command.input.TransactItems);
    if (f.failWrite) throw conflict(command.input.TransactItems, 3);
    return {};
  });
  return f;
}

test("profile endpoints require a verified signed-in caller before database access", async t => {
  t.mock.method(client, "send", async () => assert.fail("Unverified caller must not reach DynamoDB"));
  for (const handler of [getCompanyProfile, patchCompanyProfile, postCompanyThumbnailUploadUrl]) {
    for (const requestContext of [{}, { authorizer: { claims: { email, email_verified: "false" } } }]) {
      assert.equal((await handler({ ...request("{}"), requestContext })).statusCode, 401);
    }
  }
});

test("GET and PATCH reject missing, blank or invalid project IDs with 400 before database access", async t => {
  t.mock.method(client, "send", async () => assert.fail("Invalid project ID must not reach DynamoDB"));
  for (const handler of [getCompanyProfile, patchCompanyProfile]) {
    for (const pathParameters of [null, { projectId: "" }, { projectId: " " }, { projectId: 123 },
      { projectId: "%20" }, { projectId: "kickstart%3G2026%3A004218" }]) {
      const result = await handler({ ...request(JSON.stringify({ blurb: "Updated" })), pathParameters });
      assert.equal(result.statusCode, 400);
      assert.equal(JSON.parse(result.body).message, "Provide a company projectId in the URL.");
    }
  }
});

test("GET and PATCH use the stored project ID when the gateway forwards an encoded path", async t => {
  const { writes } = fixture(t);
  const encoded = encodeURIComponent(projectId);
  const result = await getCompanyProfile(request(null, encoded));
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).projectId, projectId);
  assert.equal(JSON.parse(result.body).canEdit, true);

  const saved = await patchCompanyProfile(request(JSON.stringify({ blurb: "Updated" }), encoded));
  assert.equal(saved.statusCode, 204);
  assert.deepEqual(writes[0].find(write => write.Update).Update.Key, { projectId });

  assert.equal((await getCompanyProfile(request(null, encodeURIComponent(encoded)))).statusCode, 404);
});

test("PATCH rejects malformed or invalid profile input before any database access", async t => {
  t.mock.method(client, "send", async () => assert.fail("Invalid input must not reach DynamoDB"));
  for (const body of ["{", JSON.stringify({ youtubeURL: "https://example.com/video" }),
    JSON.stringify({ currentPriceCents: 1 })]) {
    const result = await patchCompanyProfile(request(body));
    assert.equal(result.statusCode, 400, body);
  }
});

test("PATCH normalizes a valid partial profile before the guarded save transaction", async t => {
  const { writes } = fixture(t);
  assert.equal((await patchCompanyProfile(request(JSON.stringify({ blurb: " Updated " })))).statusCode, 204);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filter(write => write.ConditionCheck).length, 3);
  const update = writes[0].find(write => write.Update).Update;
  assert.ok(Object.values(update.ExpressionAttributeValues).includes("Updated"));
  assert.ok(!Object.values(update.ExpressionAttributeValues).includes(" Updated "));
  assert.match(condition(update), /seedStartedAt = null/);
  assert.match(condition(update), /seedSharesAtIpo = null/);
  assert.match(condition(update), /blurb = ""/);
  const expression = update.UpdateExpression.replace(/#[\w]+/g, name => update.ExpressionAttributeNames[name]);
  assert.doesNotMatch(expression, /currentPriceCents|netShares|version|seedStartedAt|seedSharesAtIpo/);
});

test("profiles remain viewable with caller-specific permissions and require both membership records to edit", async t => {
  const f = fixture(t);
  const member = await getCompanyProfile(request(null));
  assert.equal(member.statusCode, 200);
  assert.equal(JSON.parse(member.body).canEdit, true);
  for (const membership of ["registration", "team"]) {
    f.registration.teamID = membership === "registration" ? "999999" : teamId;
    f.team.member_ids = membership === "team" ? new Set() : new Set([email]);
    const viewer = await getCompanyProfile(request(null));
    assert.equal(viewer.statusCode, 200);
    assert.equal(JSON.parse(viewer.body).canEdit, false);
    assert.equal((await patchCompanyProfile(request(JSON.stringify({ blurb: "Updated" })))).statusCode, 403);
  }
  assert.equal(f.writes.length, 0);
});

test("missing market config keeps a company profile viewable while disabling edits", async t => {
  const f = fixture(t);
  f.config = undefined;
  const result = await getCompanyProfile(request(null));
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).canEdit, false);
  assert.equal((await patchCompanyProfile(request(JSON.stringify({ blurb: "Updated" })))).statusCode, 503);
  assert.equal(f.writes.length, 0);
});

test("a conditional save conflict returns 409 without retrying the transaction", async t => {
  const f = fixture(t);
  f.failWrite = true;
  assert.equal((await patchCompanyProfile(request(JSON.stringify({ blurb: "Updated" })))).statusCode, 409);
  assert.equal(f.writes.length, 1);
});

const uploadBody = JSON.stringify({ contentType: "image/png", size: 2 * 1024 * 1024 });
const bucket = "biztech-event-images";
const keyPrefix = `event-thumbnails/btx/dev/${eventId}/${teamId}/`;
const publicPrefix = `https://${bucket}.s3.us-west-2.amazonaws.com/${keyPrefix.replace(";", "%3B")}`;

function configureThumbnailStorage(t) {
  const values = {
    BTX_THUMBNAIL_BUCKET: bucket,
    BTX_THUMBNAIL_STAGE: "dev",
    AWS_ACCESS_KEY_ID: "test-access-key",
    AWS_SECRET_ACCESS_KEY: "test-secret-key",
    AWS_SESSION_TOKEN: "test-session-token",
  };
  const previous = Object.keys(values).map(key => [key, process.env[key]]);
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("thumbnail upload signs only a bounded raster file for a current team member before cutoff", async t => {
  const f = fixture(t);
  configureThumbnailStorage(t);
  for (const body of ["{", JSON.stringify({ contentType: "image/svg+xml", size: 100 }),
    JSON.stringify({ contentType: "image/png", size: 2 * 1024 * 1024 + 1 }),
    JSON.stringify({ contentType: "image/png", size: 0 })]) {
    assert.equal((await postCompanyThumbnailUploadUrl(request(body))).statusCode, 400);
  }
  f.registration.teamID = "999999";
  assert.equal((await postCompanyThumbnailUploadUrl(request(uploadBody))).statusCode, 403);
  f.registration.teamID = teamId;
  const result = await postCompanyThumbnailUploadUrl(request(uploadBody));
  assert.equal(result.statusCode, 200);
  const { uploadUrl, publicUrl, headers } = JSON.parse(result.body);
  const url = new URL(uploadUrl);
  assert.ok(publicUrl.startsWith(publicPrefix));
  assert.match(publicUrl, /\.png$/);
  assert.equal(decodeURIComponent(new URL(publicUrl).pathname), decodeURIComponent(url.pathname));
  assert.equal(url.searchParams.get("X-Amz-Expires"), "1");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-length;content-type;host;if-none-match");
  assert.equal(url.searchParams.has("x-amz-checksum-crc32"), false);
  assert.deepEqual(headers, { "Content-Type": "image/png", "If-None-Match": "*" });
  process.env.KICKSTART_EVENT_ENDS_AT = new Date(1000).toISOString();
  assert.equal((await postCompanyThumbnailUploadUrl(request(uploadBody))).statusCode, 409);
  assert.equal(f.writes.length, 0);
});

test("only an uploaded thumbnail for this company can be attached, and optional fields can be cleared", async t => {
  const f = fixture(t);
  configureThumbnailStorage(t);
  const filename = "d89ee7bf-3cbf-49ab-9068-c6fca0102c26.png";
  const logo = publicPrefix + filename;
  const demoURL = "https://demo.example.com/project";
  let object;
  const readObject = t.mock.method(S3Client.prototype, "send", async command => {
    assert.ok(command instanceof HeadObjectCommand);
    assert.deepEqual(command.input, { Bucket: bucket, Key: keyPrefix + filename });
    if (object) return object;
    throw new S3ServiceException({ name: "NotFound", $fault: "client", $metadata: { httpStatusCode: 404 } });
  });

  const before = JSON.parse((await getCompanyProfile(request(null))).body);
  assert.equal(before.logo, "");
  assert.equal(before.demoURL, "");
  for (const invalid of [logo.replace(teamId, "999999"), "https://example.com/" + filename]) {
    assert.equal((await patchCompanyProfile(request(JSON.stringify({ logo: invalid })))).statusCode, 400);
  }
  assert.equal(readObject.mock.callCount(), 0);
  assert.equal((await patchCompanyProfile(request(JSON.stringify({ logo })))).statusCode, 400);
  object = { ContentType: "image/jpeg", ContentLength: 10_000 };
  assert.equal((await patchCompanyProfile(request(JSON.stringify({ logo })))).statusCode, 400);
  object = { ContentType: "image/png", ContentLength: 2 * 1024 * 1024 + 1 };
  assert.equal((await patchCompanyProfile(request(JSON.stringify({ logo })))).statusCode, 400);
  assert.equal(f.writes.length, 0);

  object = { ContentType: "image/png", ContentLength: 10_000 };
  assert.equal((await patchCompanyProfile(request(JSON.stringify({ logo, demoURL })))).statusCode, 204);
  const update = f.writes[0].find(write => write.Update).Update;
  assert.ok(Object.values(update.ExpressionAttributeValues).includes(logo));
  assert.ok(Object.values(update.ExpressionAttributeValues).includes(demoURL));
  assert.match(condition(update), /attribute_not_exists\(logo\)/);
  assert.match(condition(update), /attribute_not_exists\(demoURL\)/);

  Object.assign(f.company, { logo, demoURL });
  const saved = JSON.parse((await getCompanyProfile(request(null))).body);
  assert.equal(saved.logo, logo);
  assert.equal(saved.demoURL, demoURL);
  assert.equal((await patchCompanyProfile(request(JSON.stringify({ logo: "", demoURL: "" })))).statusCode, 204);
  assert.equal(readObject.mock.callCount(), 4);
});
