import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { runtime, conditionalFailure } from "./support/runtime.mjs";

const app = await runtime();
beforeEach(() => app.reset());
after(() => app.restore());
const save = body => app.invoke(app.putSubmission, body);
const load = () => app.invoke(app.getSubmission);
const uploadRow = path => app.get(app.table("UPLOADS"), { prd_path: path });

test("GET and PUT require verified authentication and current membership", async () => {
  for (const handler of [app.getSubmission, app.putSubmission]) {
    assert.equal((await app.invoke(handler, null, { email: undefined })).status, 401);
    assert.equal((await app.invoke(handler, null, { email_verified: "false" })).status, 401);
  }
  assert.equal(app.database.calls().length, 0);
  const upload = app.upload();
  app.team().memberIDs = [];
  assert.equal((await load()).status, 403);
  assert.equal((await save(app.form(upload.prd_path))).status, 403);
  assert.equal(app.database.commandCalls(TransactWriteCommand).length, 0);
});

test("GET returns null before a first save, and can_edit changes at the exact deadline", async () => {
  assert.deepEqual(await load(), { status: 200, body: {
    submission: null, submission_deadline: app.config().submission_deadline, can_edit: true
  } });
  app.clock.now = Date.parse(app.config().submission_deadline);
  assert.equal((await load()).body.can_edit, false);
  assert.equal(app.s3.calls().length, 0);
  for (const call of app.database.commandCalls(GetCommand)) assert.equal(call.args[0].input.ConsistentRead, true);
});

test("first save initializes shared fields, trims names and returns only the public schema", async () => {
  const upload = app.upload();
  const result = await save(app.form(upload.prd_path));
  assert.equal(result.status, 200);
  const stored = app.submission();
  assert.equal(stored.team_name, "Example Team");
  assert.deepEqual(stored.member_names, ["Member One"]);
  assert.equal(stored.team_id, app.teamId);
  assert.equal(stored.team_code, "012345");
  assert.equal(stored.event_key, "productplus;2026");
  assert.deepEqual(stored.graded_submissions, []);
  assert.equal(stored.upvotes, 0); assert.equal(stored.downvotes, 0);
  assert.equal(stored.voter_ids, undefined);
  assert.equal(stored.submitted_at, stored.updated_at);
  assert.equal(stored.prd_view_url, undefined);
  assert.deepEqual(Object.keys(result.body).sort(), ["member_names", "prd_path", "prd_view_url", "submitted_at", "team_code", "team_name", "updated_at", "video_url"]);
  assert.equal(uploadRow(upload.prd_path).status, "referenced");
  const items = app.database.commandCalls(TransactWriteCommand).at(-1).args[0].input.TransactItems;
  assert.equal(items.length, 5);
  assert.match(items[0].Update.ConditionExpression, /attribute_not_exists/);
  assert.equal(items[2].ConditionCheck.TableName, app.table("REGISTRATIONS"));
  assert.match(items[3].ConditionCheck.ConditionExpression, /contains/);
  assert.equal(items[4].ConditionCheck.ExpressionAttributeValues[":deadline"], app.config().submission_deadline);
});

test("updates preserve submitted_at, rubrics and votes even when judging writes concurrently", async () => {
  const upload = app.upload();
  assert.equal((await save(app.form(upload.prd_path))).status, 200);
  const created = app.submission().submitted_at;
  const rubrics = [{ judge_user_id: "judge@example.com", scores: [1, 2, 3, 4, 5], comments: "Saved rubric" }];
  app.submission().graded_submissions = rubrics;
  app.submission().upvotes = 9; app.submission().downvotes = 2;
  app.submission().voter_ids = new Set(["voter@example.com"]);
  app.clock.now += 1000;
  app.beforeTransaction = () => { app.submission().upvotes += 1; };
  const result = await save({ ...app.form(app.submission().prd_path), team_name: "Updated" });
  assert.equal(result.status, 200);
  assert.equal(app.submission().submitted_at, created);
  assert.equal(result.body.submitted_at, created);
  assert.notEqual(app.submission().updated_at, created);
  assert.deepEqual(app.submission().graded_submissions, rubrics);
  assert.deepEqual(app.submission().voter_ids, new Set(["voter@example.com"]));
  assert.equal(app.submission().upvotes, 10); assert.equal(app.submission().downvotes, 2);
  assert.equal(app.database.commandCalls(TransactWriteCommand).at(-1).args[0].input.TransactItems.length, 5);
});

test("GET after closing returns a fresh five-minute inline PDF URL without internal fields", async () => {
  const upload = app.upload();
  await save(app.form(upload.prd_path));
  app.clock.now = Date.parse(app.config().submission_deadline) + 1000;
  const result = await load();
  assert.equal(result.status, 200); assert.equal(result.body.can_edit, false);
  const url = new URL(result.body.submission.prd_view_url);
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.equal(url.searchParams.get("response-content-type"), "application/pdf");
  assert.equal(url.searchParams.get("response-content-disposition"), 'inline; filename="prd.pdf"');
  assert.equal(decodeURIComponent(url.pathname), `/${app.permanent(upload)}`);
  for (const key of ["team_id", "event_key", "graded_submissions", "upvotes", "voter_ids", "version"]) {
    assert.equal(result.body.submission[key], undefined);
  }
});

test("PUT rejects malformed bodies, unknown fields and empty names before accessing storage", async () => {
  const form = app.form("some-path");
  for (const body of [null, "invalid", "[]", "null", {},
    { ...form, team_name: " " }, { ...form, team_name: 1 },
    { ...form, member_names: [] }, { ...form, member_names: [" "] },
    { ...form, member_names: [1] }, { ...form, member_names: "one" },
    { ...form, prd_path: "" }, { ...form, team_code: "123456" }]) {
    assert.equal((await save(body)).status, 400);
  }
  assert.equal(app.database.calls().length, 0);
});

test("supported HTTPS YouTube video forms save successfully", async () => {
  const upload = app.upload();
  for (const video_url of [
    "https://youtu.be/abcdefghijk?si=share", "https://youtube.com/watch?v=abcdefghijk&t=30",
    "https://www.youtube.com/watch?v=abcdefghijk", "https://m.youtube.com/watch?v=abcdefghijk",
    "https://www.youtube.com/shorts/abcdefghijk", "https://www.youtube.com/embed/abcdefghijk"
  ]) assert.equal((await save({ ...app.form(app.submission()?.prd_path || upload.prd_path), video_url })).status, 200);
});

test("YouTube validation rejects impostor hosts, unsupported paths, credentials and invalid IDs", async () => {
  const form = app.form("unused-path");
  for (const video_url of [
    "http://youtu.be/abcdefghijk", "https://youtube.com.evil.test/watch?v=abcdefghijk",
    "https://evil.test/abcdefghijk", "https://notyoutube.com/watch?v=abcdefghijk",
    "https://youtube.com/playlist?list=abcdefghijk", "https://youtube.com/watch?v=short",
    "https://youtube.com/watch?v=abcdefghijk&v=otheridabcd", "https://youtu.be/abcdefghijk/extra",
    "https://user:password@youtube.com/watch?v=abcdefghijk", "https://youtu.be:444/abcdefghijk",
    "https://youtube.com/watch?v=abcdefghi!k", "not a URL"
  ]) assert.equal((await save({ ...form, video_url })).status, 400);
  assert.equal(app.database.calls().length, 0);
});

test("PDF must have team-owned tracking and an available lifecycle status", async () => {
  const upload = app.upload();
  const original = structuredClone(uploadRow(upload.prd_path));
  for (const overrides of [{ team_id: "other" }, { team_code: "999999" }, { event_key: "another;2026" },
    { upload_id: "invalid" }, { content_type: "text/plain" }, { status: "deleting" }, { status: "deleted" }]) {
    app.put(app.table("UPLOADS"), { ...original, ...overrides });
    assert.equal((await save(app.form(upload.prd_path))).status, 400);
  }
  app.delete(app.table("UPLOADS"), { prd_path: upload.prd_path });
  assert.equal((await save(app.form(upload.prd_path))).status, 400);
  assert.equal(app.s3.calls().length, 0);
  assert.equal(app.submission(), undefined);
});

test("PDF existence, content type, size, header and object-change checks reject invalid files", async () => {
  const upload = app.upload();
  const original = { ...app.objects.get(upload.prd_path) };
  app.objects.delete(upload.prd_path);
  assert.equal((await save(app.form(upload.prd_path))).status, 400);
  for (const overrides of [{ ContentType: "text/plain" }, { ContentLength: 5000001 }, { ContentLength: 0 },
    { ContentLength: 7 }, { bytes: Buffer.from("not a PDF file") }]) {
    app.objects.set(upload.prd_path, { ...original, ...overrides });
    assert.equal((await save(app.form(upload.prd_path))).status, 400);
  }
  app.objects.set(upload.prd_path, original);
  app.beforeGetObject = () => { app.objects.get(upload.prd_path).ETag = '"changed"'; };
  assert.equal((await save(app.form(upload.prd_path))).status, 400);
  assert.equal(app.submission(), undefined);
  assert.equal(app.database.commandCalls(TransactWriteCommand).length, 0);
});

test("the exact 5 MB limit is accepted with a ranged header read", async () => {
  const upload = app.upload();
  app.objects.get(upload.prd_path).ContentLength = 5000000;
  assert.equal((await save(app.form(upload.prd_path))).status, 200);
  assert.equal(app.s3.commandCalls(GetObjectCommand)[0].args[0].input.Range, "bytes=0-7");
  assert.equal(app.s3.commandCalls(HeadObjectCommand)[0].args[0].input.Bucket, "biztech-pp-prd");
});

test("PDF validation rejects non-ASCII bytes that resemble a PDF header", async () => {
  const upload = app.upload();
  app.objects.get(upload.prd_path).bytes = Buffer.from("%PDF-1.7\n").map(byte => byte | 0x80);
  assert.equal((await save(app.form(upload.prd_path))).status, 400);
  assert.equal(app.submission(), undefined);
  assert.equal(app.database.commandCalls(TransactWriteCommand).length, 0);
});

test("replacement changes the permanent reference atomically and queues deletion", async () => {
  const previous = app.upload(1);
  await save(app.form(previous.prd_path));
  const next = app.upload(2);
  app.clock.now += 1000;
  assert.equal((await save(app.form(next.prd_path))).status, 200);
  assert.equal(app.submission().prd_path, app.permanent(next));
  assert.equal(uploadRow(next.prd_path).status, "referenced");
  assert.equal(uploadRow(previous.prd_path).status, "replaced");
  assert.equal(app.objects.has(app.permanent(previous)), true);
  assert.equal(app.objects.has(next.prd_path), true);
  const task = JSON.parse(Buffer.from(app.lambda.calls().at(-1).args[0].input.Payload));
  assert.deepEqual(task, app.task("retire_upload", { prd_path: previous.prd_path }));
});

test("closed submissions and missing config fail without writing", async () => {
  const upload = app.upload();
  app.clock.now = Date.parse(app.config().submission_deadline);
  assert.equal((await save(app.form(upload.prd_path))).status, 403);
  app.delete(app.table("SUBMISSIONS"), { event_key: "productplus;2026", team_code: "config" });
  assert.equal((await load()).status, 503);
  assert.equal((await save(app.form(upload.prd_path))).status, 503);
  assert.equal(app.database.commandCalls(TransactWriteCommand).length, 0);
});

test("time is rechecked after S3 validation and before writing", async () => {
  const upload = app.upload();
  app.beforeGetObject = () => { app.clock.now = Date.parse(app.config().submission_deadline); };
  assert.equal((await save(app.form(upload.prd_path))).status, 403);
  assert.equal(app.database.commandCalls(TransactWriteCommand).length, 0);
});

test("removal during a save cancels the whole transaction and fresh lookup denies the retry", async () => {
  const upload = app.upload();
  app.beforeTransaction = () => { app.team().memberIDs = []; };
  assert.equal((await save(app.form(upload.prd_path))).status, 403);
  assert.equal(app.submission(), undefined);
  assert.equal(uploadRow(upload.prd_path).status, "pending");
});

test("registration removal during a save is enforced even if the team member list is stale", async () => {
  const upload = app.upload();
  app.beforeTransaction = () => {
    app.get(app.table("REGISTRATIONS"), { id: app.email, "eventID;year": "productplus;2026" }).teamID = "";
  };
  assert.equal((await save(app.form(upload.prd_path))).status, 403);
  assert.equal(app.submission(), undefined);
  assert.equal(uploadRow(upload.prd_path).status, "pending");
});

test("changed deadline is reread on retry instead of using stale configuration", async () => {
  const upload = app.upload();
  app.beforeTransaction = () => { app.config().submission_deadline = new Date(app.clock.now).toISOString(); };
  assert.equal((await save(app.form(upload.prd_path))).status, 403);
  assert.equal(app.submission(), undefined);
});

test("two simultaneous PDF replacements keep the last successful save and correct tracking", async () => {
  const original = app.upload(1), a = app.upload(2), b = app.upload(3);
  await save(app.form(original.prd_path));
  let release, reached;
  const blocked = new Promise(resolve => { reached = resolve; });
  app.beforeTransaction = input => {
    if (input.TransactItems[0].Update.TableName === app.table("SUBMISSIONS") && input.TransactItems[0].Update.ExpressionAttributeValues[":path"] === app.permanent(a) && !release) {
      return new Promise(resolve => { release = resolve; reached(); });
    }
  };
  const first = save({ ...app.form(a.prd_path), team_name: "A" });
  await blocked;
  assert.equal((await save({ ...app.form(b.prd_path), team_name: "B" })).status, 200);
  release();
  assert.equal((await first).status, 200);
  assert.equal(app.submission().team_name, "A");
  assert.equal(app.submission().prd_path, app.permanent(a));
  assert.equal(uploadRow(a.prd_path).status, "referenced");
  assert.equal(uploadRow(b.prd_path).status, "replaced");
  assert.equal(uploadRow(original.prd_path).status, "replaced");
  assert.equal(app.database.commandCalls(TransactWriteCommand).length, 7);
});

test("replacement between submission and previous-upload reads retries from the current path", async () => {
  const original = app.upload(1), a = app.upload(2), b = app.upload(3);
  await save(app.form(original.prd_path));
  let changed = false;
  app.database.on(GetCommand).callsFake(async input => {
    if (input.TableName === app.table("UPLOADS") && input.Key.prd_path === original.prd_path && !changed) {
      changed = true;
      assert.equal((await save(app.form(b.prd_path))).status, 200);
    }
    return { Item: structuredClone(app.get(input.TableName, input.Key)) };
  });
  assert.equal((await save(app.form(a.prd_path))).status, 200);
  assert.equal(app.submission().prd_path, app.permanent(a));
  assert.equal(uploadRow(a.prd_path).status, "referenced");
  assert.equal(uploadRow(b.prd_path).status, "replaced");
  assert.equal(uploadRow(original.prd_path).status, "replaced");
});

test("cleanup claiming a PDF during validation causes a retry that rejects the file", async () => {
  const upload = app.upload();
  app.beforeTransaction = () => { uploadRow(upload.prd_path).status = "deleting"; };
  assert.equal((await save(app.form(upload.prd_path))).status, 400);
  assert.equal(app.submission(), undefined);
});

test("persistent conflicts stop after three attempts with 409", async () => {
  const upload = app.upload();
  app.beforeTransaction = () => { throw conditionalFailure(); };
  assert.equal((await save(app.form(upload.prd_path))).status, 409);
  assert.equal(app.database.commandCalls(TransactWriteCommand).length, 3);
});

test("PROD selection preserves the response contract", async () => {
  for (const kind of ["SUBMISSIONS", "UPLOADS", "TEAMS", "REGISTRATIONS"]) process.env[`PRODUCTPLUS_${kind}_TABLE`] += "PROD";
  process.env.PRODUCTPLUS_PRD_BUCKET = "biztech-pp-prd-prod";
  app.put(app.table("TEAMS"), { id: app.teamId, "eventID;year": "productplus;2026", team_code: app.teamCode, memberIDs: [app.email] });
  app.put(app.table("REGISTRATIONS"), { id: app.email, "eventID;year": "productplus;2026", teamID: app.teamId });
  app.put(app.table("SUBMISSIONS"), { event_key: "productplus;2026", team_code: "config", submission_deadline: "2026-10-05T13:00:00Z", voting_deadline: "2026-10-06T13:00:00Z" });
  const upload = app.upload();
  const event = app.event(app.form(upload.prd_path));
  const result = await app.putSubmission(event, {}, () => {});
  assert.equal(result.statusCode, 200);
  assert.equal(new URL(JSON.parse(result.body).prd_view_url).hostname, "biztech-pp-prd-prod.s3.us-west-2.amazonaws.com");
  for (const entry of app.database.commandCalls(TransactWriteCommand).at(-1).args[0].input.TransactItems) {
    assert.match((entry.Update || entry.ConditionCheck).TableName, /PROD$/);
  }
});

test("another team's submission at a reused code is protected", async () => {
  const upload = app.upload();
  await save(app.form(upload.prd_path));
  app.submission().team_id = "another-team";
  assert.equal((await load()).status, 409);
  assert.equal((await save(app.form(upload.prd_path))).status, 409);
});

test("SDK failures return generic errors without exposing database details", async () => {
  for (const operation of ["read", "write"]) {
    app.reset();
    const upload = app.upload();
    if (operation === "read") {
      app.database.on(GetCommand).rejects(new Error("Sensitive details"));
      const result = await load();
      assert.equal(result.status, 500);
      assert.doesNotMatch(JSON.stringify(result.body), /Sensitive/);
    } else {
      app.beforeTransaction = () => { throw new Error("Sensitive details"); };
    }
    const result = await save(app.form(upload.prd_path));
    assert.equal(result.status, 500);
    assert.doesNotMatch(JSON.stringify(result.body), /Sensitive/);
    assert.equal(app.submission(), undefined);
  }
});
