import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { GetCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { runtime } from "./support/runtime.mjs";

const app = await runtime();
beforeEach(() => app.reset());
after(() => app.restore());
const row = upload => app.get(app.table("UPLOADS"), { prd_path: upload.prd_path });
const retire = upload => app.cleanup(app.task("retire_upload", { prd_path: upload.prd_path }));
const removeTeam = () => app.delete(app.table("TEAMS"), { id: app.teamCode, "eventID;year": "productplus;2026" });
const teamCleanup = () => app.cleanup(app.task("team_deleted", { team_code: app.teamCode }));
async function replaced() {
  const old = app.upload(1), next = app.upload(2);
  assert.equal((await app.invoke(app.putSubmission, app.form(old.prd_path))).status, 200);
  assert.equal((await app.invoke(app.putSubmission, app.form(next.prd_path))).status, 200);
  return { old, next };
}

test("replacement deletes the old permanent PDF directly and preserves the active PDF", async () => {
  const { old, next } = await replaced();
  const copies = app.s3.commandCalls(CopyObjectCommand).length;
  const reads = app.s3.commandCalls(HeadObjectCommand).length;
  assert.deepEqual(await retire(old), { cleaned: 1 });
  assert.equal(app.objects.has(app.permanent(old)), false);
  assert.equal(app.s3.commandCalls(CopyObjectCommand).length, copies);
  assert.equal(app.s3.commandCalls(HeadObjectCommand).length, reads);
  assert.equal(app.objects.has(old.prd_path), true);
  assert.equal(app.objects.has(app.permanent(next)), true);
  assert.equal(row(old).status, "deleted");
  assert.deepEqual(await retire(old), { cleaned: 0 });
});

test("a referenced PDF is protected even if tracking incorrectly says replaced", async () => {
  const upload = app.upload();
  await app.invoke(app.putSubmission, app.form(upload.prd_path));
  row(upload).status = "replaced";
  assert.deepEqual(await retire(upload), { cleaned: 0 });
  assert.equal(app.objects.has(app.permanent(upload)), true);
  assert.equal(app.s3.commandCalls(DeleteObjectCommand).length, 0);
});

test("cleanup transaction rejects a reference created after its tracking read", async () => {
  const { old } = await replaced();
  app.beforeTransaction = () => { app.submission().prd_path = app.permanent(old); };
  assert.deepEqual(await retire(old), { cleaned: 0 });
  assert.equal(row(old).status, "replaced");
  assert.equal(app.objects.has(app.permanent(old)), true);
});

test("delete failure retains the original, deleting status and a replayable task", async () => {
  const { old } = await replaced();
  app.beforeDelete = () => { throw new Error("Private signed URL must not be logged"); };
  await assert.rejects(retire(old), /cleanup failed/);
  assert.equal(row(old).status, "deleting");
  assert.equal(app.objects.has(app.permanent(old)), true);
  assert.equal((await app.invoke(app.putSubmission, app.form(old.prd_path))).status, 400);
  assert.doesNotMatch(JSON.stringify(app.logs), /Private signed URL/);
  const task = app.logs.find(([message]) => message === "Product Plus cleanup failed")[1].task;
  assert.deepEqual(task, app.task("retire_upload", { prd_path: old.prd_path }));
  app.beforeDelete = undefined;
  assert.equal((await app.cleanup(task)).cleaned, 1);
});

test("a manually deleted replacement is safe to clean up and retry", async () => {
  const { old } = await replaced();
  app.objects.delete(app.permanent(old));
  assert.equal((await retire(old)).cleaned, 1);
  assert.equal(row(old).status, "deleted");
  assert.equal((await retire(old)).cleaned, 0);
});

test("failed final bookkeeping retries after S3 deletion without requiring a source", async () => {
  const { old } = await replaced();
  let failed = false;
  app.database.on(UpdateCommand).callsFake(input => {
    if (!failed) { failed = true; throw new Error("Bookkeeping failed"); }
    row(old).status = "deleted";
    return {};
  });
  await assert.rejects(retire(old));
  assert.equal(app.objects.has(app.permanent(old)), false);
  assert.equal(row(old).status, "deleting");
  assert.equal((await retire(old)).cleaned, 1);
});

test("team cleanup removes its submission and files while retaining tracking and config", async () => {
  const referenced = app.upload(1), pending = app.upload(2);
  await app.invoke(app.putSubmission, app.form(referenced.prd_path));
  removeTeam();
  assert.equal((await teamCleanup()).cleaned, 2);
  assert.equal(app.submission(), undefined);
  assert.ok(app.config());
  for (const upload of [referenced, pending]) {
    assert.equal(row(upload).status, "deleted");
    assert.equal(app.objects.has(upload.prd_path), false);
    assert.equal(app.objects.has(app.permanent(upload)), false);
  }
  assert.equal((await teamCleanup()).cleaned, 0);
});

test("team cleanup includes pending uploads without a submission", async () => {
  const upload = app.upload();
  removeTeam();
  assert.equal((await teamCleanup()).cleaned, 1);
  assert.equal(app.objects.has(upload.prd_path), false);
});

test("existing or recreated teams prevent deletion", async () => {
  const upload = app.upload();
  await app.invoke(app.putSubmission, app.form(upload.prd_path));
  await assert.rejects(teamCleanup());
  removeTeam();
  app.beforeTransaction = () => app.put(app.table("TEAMS"), {
    "eventID;year": "productplus;2026", id: app.teamCode, memberIDs: [app.email],
    teamName: "Example Team"
  });
  await assert.rejects(teamCleanup());
  assert.ok(app.submission());
  assert.equal(app.objects.has(app.permanent(upload)), true);
});

test("a failed team read cannot authorize submission or file deletion", async () => {
  const upload = app.upload();
  await app.invoke(app.putSubmission, app.form(upload.prd_path));
  app.database.on(GetCommand, { TableName: app.table("TEAMS") })
    .rejects(new Error("Team lookup failed"));

  await assert.rejects(teamCleanup());
  assert.ok(app.submission());
  assert.equal(row(upload).status, "referenced");
  assert.equal(app.objects.has(app.permanent(upload)), true);
  assert.equal(app.s3.commandCalls(DeleteObjectCommand).length, 0);
});

test("the same team code in another event keeps its submission and files", async () => {
  const old = app.upload(1);
  await app.invoke(app.putSubmission, app.form(old.prd_path));
  const other = app.upload(2, { event_key: "other;2026" });
  const otherSubmission = { ...app.submission(), event_key: "other;2026", prd_path: other.prd_path };
  app.put(app.table("SUBMISSIONS"), otherSubmission);
  const otherTeam = { id: app.teamCode, "eventID;year": "other;2026", memberIDs: [app.email] };
  app.put(app.table("TEAMS"), otherTeam);
  removeTeam();
  assert.equal((await teamCleanup()).cleaned, 1);
  assert.deepEqual(app.get(app.table("SUBMISSIONS"), { event_key: "other;2026", team_code: app.teamCode }), otherSubmission);
  assert.equal(app.objects.has(other.prd_path), true);
  assert.equal(row(other).status, "pending");
  assert.deepEqual(app.get(app.table("TEAMS"), { id: app.teamCode, "eventID;year": "other;2026" }), otherTeam);
});

test("strong scan paginates through filtered empty pages and ignores other teams", async () => {
  for (let index = 1; index <= 5; index++) app.upload(index);
  const other = app.upload(6, { team_code: "999999" });
  const otherEvent = app.upload(7, { event_key: "other;2026" });
  app.pageSize = 1;
  removeTeam();
  assert.equal((await teamCleanup()).cleaned, 5);
  const scans = app.database.commandCalls(ScanCommand);
  assert.equal(scans.length, 7);
  for (const call of scans) assert.equal(call.args[0].input.ConsistentRead, true);
  assert.equal(app.objects.has(other.prd_path), true);
  assert.equal(app.objects.has(otherEvent.prd_path), true);
});

test("team cleanup continues other files after a failure and retries unfinished files", async () => {
  const first = app.upload(1), second = app.upload(2);
  removeTeam();
  let failed = false;
  app.beforeDelete = input => { if (input.Key === first.prd_path && !failed) { failed = true; throw new Error("Failed delete"); } };
  await assert.rejects(teamCleanup());
  assert.equal(row(first).status, "deleting");
  assert.equal(row(second).status, "deleted");
  assert.equal((await teamCleanup()).cleaned, 1);
});

test("invalid event, task, ownership, or generated key cannot delete objects", async () => {
  const upload = app.upload();
  row(upload).status = "replaced";
  for (const task of [null, { internalTask: "unknown", payload: { event_key: "productplus;2026" } },
    app.task("team_deleted", { team_code: "config" }),
    { internalTask: "retire_upload", payload: { event_key: "other;2026", prd_path: upload.prd_path } }]) {
    await assert.rejects(app.cleanup(task));
  }
  row(upload).permanent_path = "unrelated/private.pdf";
  await assert.rejects(retire(upload));
  assert.equal(app.s3.commandCalls(DeleteObjectCommand).length, 0);
});

test("team cleanup retains ambiguous promotions and succeeds after explicit reconciliation", async () => {
  const upload = app.upload(1, { status: "promoting", promotion_token: "token", permanent_path: "" });
  row(upload).permanent_path = app.permanent(upload);
  app.objects.set(app.permanent(upload), app.objects.get(upload.prd_path));
  removeTeam();
  await assert.rejects(teamCleanup());
  assert.equal(row(upload).status, "promoting");
  assert.equal(app.objects.has(app.permanent(upload)), true);
  // Operator confirms copying/saving has stopped and the submission is absent.
  row(upload).status = "replaced";
  assert.equal((await teamCleanup()).cleaned, 1);
});

test("PROD cleanup uses only the injected PROD tables and bucket", async () => {
  for (const kind of ["SUBMISSIONS", "UPLOADS", "TEAMS", "REGISTRATIONS"]) process.env[`PRODUCTPLUS_${kind}_TABLE`] += "PROD";
  process.env.PRODUCTPLUS_PRD_BUCKET = "biztech-pp-prd-prod";
  const upload = app.upload();
  assert.equal((await teamCleanup()).cleaned, 1);
  assert.equal(row(upload).status, "deleted");
  assert.ok(app.s3.calls().every(call => call.args[0].input.Bucket === "biztech-pp-prd-prod"));
  assert.ok(app.database.calls().every(call => !call.args[0].input.TableName || call.args[0].input.TableName.endsWith("PROD")));
});

test("team cleanup removes the submission before a file-listing failure", async () => {
  const upload = app.upload();
  await app.invoke(app.putSubmission, app.form(upload.prd_path));
  removeTeam();
  app.database.on(ScanCommand).rejects(new Error("Scan unavailable"));
  await assert.rejects(teamCleanup());
  assert.equal(app.submission(), undefined);
  assert.equal(app.objects.has(app.permanent(upload)), true);
  assert.equal(row(upload).status, "referenced");
});

test("cleanup rejects missing shared table settings before AWS access", async () => {
  delete process.env.PRODUCTPLUS_TEAMS_TABLE;
  await assert.rejects(teamCleanup(), /storage settings are required/);
  assert.equal(app.database.calls().length, 0);
  assert.equal(app.s3.calls().length, 0);
});

test("cleanup rejects numeric team codes even when their generated path matches", async () => {
  const upload = app.upload(1, { team_code: 123456, status: "replaced" });
  await assert.rejects(retire(upload), /cleanup failed/);
  assert.equal(row(upload).status, "replaced");
  assert.equal(app.objects.has(upload.prd_path), true);
  assert.equal(app.s3.commandCalls(DeleteObjectCommand).length, 0);
});
