import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { runtime, conditionalFailure } from "./support/runtime.mjs";

const app = await runtime();
beforeEach(() => app.reset());
after(() => app.restore());
const save = path => app.invoke(app.putSubmission, app.form(path));
const row = upload => app.get(app.table("UPLOADS"), { prd_path: upload.prd_path });
const isSave = input => input.TransactItems[0].Update?.TableName === app.table("SUBMISSIONS");

test("promotion copies the validated immutable PDF and leaves the temporary original", async () => {
  const upload = app.upload();
  const result = await save(upload.prd_path);
  assert.equal(result.status, 200);
  assert.equal(result.body.prd_path, app.permanent(upload));
  const copy = app.s3.commandCalls(CopyObjectCommand)[0].args[0].input;
  assert.equal(copy.CopySourceIfMatch, '"pdf-etag"');
  assert.equal(decodeURIComponent(copy.CopySource), `biztech-pp-prd/${upload.prd_path}`);
  assert.equal(row(upload).promotion_token, undefined);
  assert.ok(app.objects.has(upload.prd_path));
  assert.ok(app.objects.has(result.body.prd_path));
});

test("form-only edits work after temporary expiration and do not copy again", async () => {
  const upload = app.upload();
  await save(upload.prd_path);
  app.objects.delete(upload.prd_path);
  assert.equal((await save(app.submission().prd_path)).status, 200);
  assert.equal(app.s3.commandCalls(CopyObjectCommand).length, 1);
  assert.equal((await save(upload.prd_path)).status, 400);
});

test("permanent paths from other or previous submissions cannot be attached", async () => {
  const first = app.upload(1), next = app.upload(2);
  assert.equal((await save(app.permanent(first))).status, 400);
  await save(first.prd_path);
  await save(next.prd_path);
  assert.equal((await save(app.permanent(first))).status, 400);
  assert.equal(app.submission().prd_path, app.permanent(next));
});

test("same-upload concurrent submits are excluded by the promotion reservation", async () => {
  const upload = app.upload();
  let release, reached;
  const blocked = new Promise(resolve => { reached = resolve; });
  app.beforeCopy = () => new Promise(resolve => { release = resolve; reached(); });
  const first = save(upload.prd_path);
  await blocked;
  assert.equal((await save(upload.prd_path)).status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal(app.s3.commandCalls(CopyObjectCommand).length, 1);
});

test("deadline and membership are checked again after copying", async () => {
  for (const change of [() => { app.clock.now = Date.parse(app.config().submission_deadline); }, () => { app.team().memberIDs = []; }]) {
    app.reset();
    const upload = app.upload();
    app.beforeCopy = change;
    assert.equal((await save(upload.prd_path)).status, 403);
    assert.equal(app.submission(), undefined);
    assert.equal(row(upload).status, "promoting");
    assert.equal(app.lambda.calls().length, 0);
    assert.equal(app.objects.has(app.permanent(upload)), true);
    assert.match(JSON.stringify(app.logs), /needs recovery/);
  }
});

test("copy exceptions preserve the previous submitted PDF and retain ambiguous tracking", async () => {
  const old = app.upload(1), next = app.upload(2);
  await save(old.prd_path);
  app.s3.on(CopyObjectCommand).rejects(new Error("Copy timed out"));
  assert.equal((await save(next.prd_path)).status, 500);
  assert.equal(app.submission().prd_path, app.permanent(old));
  assert.equal(row(next).status, "promoting");
  assert.equal(app.lambda.calls().length, 0);
  assert.ok(app.objects.has(app.permanent(old)));
  assert.match(JSON.stringify(app.logs), /needs recovery/);
});

test("exhausted save conflicts leave an unreferenced copy for manual cleanup", async () => {
  const upload = app.upload();
  app.beforeTransaction = input => { if (isSave(input)) throw conditionalFailure(); };
  assert.equal((await save(upload.prd_path)).status, 409);
  assert.equal(app.lambda.calls().length, 0);
  assert.equal(row(upload).status, "promoting");
  assert.equal(app.objects.has(app.permanent(upload)), true);
  assert.match(JSON.stringify(app.logs), /needs recovery/);
});

test("a timed-out committed submission is preserved and can be recovered through GET", async () => {
  const upload = app.upload();
  app.afterTransaction = input => { if (isSave(input)) throw new Error("Response timed out after commit"); };
  assert.equal((await save(upload.prd_path)).status, 500);
  assert.equal(row(upload).status, "referenced");
  assert.equal(app.lambda.calls().length, 0);
  assert.equal((await app.invoke(app.getSubmission)).body.submission.prd_path, app.permanent(upload));
});

test("an unresolved write outcome retains the copied PDF and tracking for manual recovery", async () => {
  const upload = app.upload();
  app.beforeTransaction = input => { if (isSave(input)) throw new Error("Transaction timeout"); };
  assert.equal((await save(upload.prd_path)).status, 500);
  assert.equal(row(upload).status, "promoting");
  assert.ok(app.objects.has(app.permanent(upload)));
  assert.equal(app.lambda.calls().length, 0);
});

test("cleanup delivery failure preserves successful saves and a replayable task", async () => {
  const first = app.upload(1), next = app.upload(2);
  await save(first.prd_path);
  app.lambda.on(InvokeCommand).rejects(new Error("Do not leak signed URLs"));
  assert.equal((await save(next.prd_path)).status, 200);
  assert.equal(row(first).status, "replaced");
  assert.equal(app.submission().prd_path, app.permanent(next));
  assert.match(JSON.stringify(app.logs), /retire_upload/);
  assert.doesNotMatch(JSON.stringify(app.logs), /Do not leak/);
});

test("source changes during copying produce a file error and release the reservation", async () => {
  const upload = app.upload();
  app.beforeCopy = () => { app.objects.get(upload.prd_path).ETag = '"changed"'; };
  assert.equal((await save(upload.prd_path)).status, 400);
  assert.equal(row(upload).status, "pending");
  assert.equal(row(upload).promotion_token, undefined);
  assert.equal(app.objects.has(app.permanent(upload)), false);
});

test("reservation cannot overwrite an active permanent PDF even with inconsistent pending tracking", async () => {
  const upload = app.upload();
  await save(upload.prd_path);
  const copies = app.s3.commandCalls(CopyObjectCommand).length;
  row(upload).status = "pending";
  assert.equal((await save(upload.prd_path)).status, 409);
  assert.equal(app.s3.commandCalls(CopyObjectCommand).length, copies);
  assert.equal(app.submission().prd_path, app.permanent(upload));
});

test("membership removal at the final transaction is enforced after a completed promotion", async () => {
  const upload = app.upload();
  app.beforeTransaction = input => { if (isSave(input)) app.team().memberIDs = []; };
  assert.equal((await save(upload.prd_path)).status, 403);
  assert.equal(app.submission(), undefined);
  assert.equal(app.lambda.calls().length, 0);
  assert.equal(row(upload).status, "promoting");
  assert.equal(app.objects.has(app.permanent(upload)), true);
});

test("generic S3 HEAD 404 errors are reported as invalid files", async () => {
  const upload = app.upload();
  app.s3.on(HeadObjectCommand).rejects(Object.assign(new Error("Generic HEAD response"), { $metadata: { httpStatusCode: 404 } }));
  assert.equal((await save(upload.prd_path)).status, 400);
  assert.equal(row(upload).status, "pending");
});

test("DynamoDB failures preserve copied files for manual cleanup", async () => {
  const upload = app.upload();
  app.beforeTransaction = input => {
    if (isSave(input)) throw Object.assign(new Error("Write rejected"), { name: "ValidationException" });
  };
  assert.equal((await save(upload.prd_path)).status, 500);
  assert.equal(app.lambda.calls().length, 0);
  assert.equal(row(upload).status, "promoting");
  assert.equal(app.objects.has(app.permanent(upload)), true);
  assert.match(JSON.stringify(app.logs), /needs recovery/);
});
