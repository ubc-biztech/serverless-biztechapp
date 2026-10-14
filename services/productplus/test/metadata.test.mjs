import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { runtime } from "./support/runtime.mjs";

const app = await runtime();
beforeEach(() => app.reset());
after(() => app.restore());
const save = (path, fields = {}) =>
  app.invoke(app.putSubmission, { ...app.form(path), ...fields });
const load = () => app.invoke(app.getSubmission);

test("original upload filename and project title persist through submission and reload", async () => {
  const filename = ' Product "plan" résumé.pdf ';
  const uploaded = await app.invoke(app.createUpload, {
    content_type: "application/pdf",
    prd_filename: filename
  });
  assert.equal(uploaded.status, 200);
  const path = uploaded.body.prd_path;
  assert.equal(
    app.get(app.table("UPLOADS"), { prd_path: path }).prd_filename,
    filename
  );
  assert.ok(path.endsWith("/prd.pdf"));
  // Simulate the browser's direct S3 PUT; API calls still use the real handlers.
  app.objects.set(path, {
    ContentType: "application/pdf",
    bytes: Buffer.from("%PDF-1.7\nPDF content"),
    ETag: '"pdf-etag"'
  });
  const result = await save(path, { project_title: "  Our project  " });
  assert.equal(result.status, 200);
  assert.equal(result.body.teamID, "012345");
  assert.equal(result.body.project_title, "Our project");
  assert.equal(result.body.prd_filename, filename);
  assert.equal(app.submission().project_title, "Our project");
  assert.equal(app.submission().prd_filename, filename);
  app.clock.now = Date.parse(app.config().submission_deadline);
  const reloaded = await load();
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.body.can_edit, false);
  assert.equal(reloaded.body.submission.project_title, "Our project");
  assert.equal(reloaded.body.submission.prd_filename, filename);
});

test("invalid project titles fail before storage access", async () => {
  const upload = app.upload();
  for (const project_title of [null, "", "  ", 123, [], {}]) {
    assert.equal((await save(upload.prd_path, { project_title })).status, 400);
  }
  assert.equal(app.database.calls().length, 0);
  assert.equal(app.s3.calls().length, 0);
});

test("invalid upload filenames fail before creating tracking or signing a URL", async () => {
  for (const prd_filename of [null, "", "  ", 123, [], {}]) {
    assert.equal(
      (
        await app.invoke(app.createUpload, {
          content_type: "application/pdf",
          prd_filename
        })
      ).status,
      400
    );
  }
  assert.equal(app.database.calls().length, 0);
  assert.equal(app.s3.calls().length, 0);
});

test("form-only edits preserve the filename and an omitted title, and allow a title update", async () => {
  const upload = app.upload(1, { prd_filename: "Original.pdf" });
  await save(upload.prd_path, { project_title: "Original title" });
  app.objects.delete(upload.prd_path);
  const path = app.submission().prd_path;
  const edit = await save(path, { team_name: "Updated team" });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.project_title, "Original title");
  assert.equal(edit.body.prd_filename, "Original.pdf");
  const renamed = await save(path, { project_title: "  Updated title  " });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.project_title, "Updated title");
  assert.equal(renamed.body.prd_filename, "Original.pdf");
  assert.equal(app.submission().project_title, "Updated title");
  assert.equal((await load()).body.submission.prd_filename, "Original.pdf");
  assert.equal(app.s3.commandCalls(CopyObjectCommand).length, 1);
});

test("replacement copies the new PDF's filename and preserves an omitted title", async () => {
  const old = app.upload(1, { prd_filename: "Old.pdf" });
  const next = app.upload(2, { prd_filename: "New.pdf" });
  await save(old.prd_path, { project_title: "Our project" });
  const result = await save(next.prd_path);
  assert.equal(result.status, 200);
  assert.equal(result.body.prd_path, app.permanent(next));
  assert.equal(result.body.prd_filename, "New.pdf");
  assert.equal(result.body.project_title, "Our project");
  assert.equal(app.submission().prd_filename, "New.pdf");
  assert.equal(
    app.get(app.table("UPLOADS"), { prd_path: old.prd_path }).prd_filename,
    "Old.pdf"
  );
  assert.equal((await load()).body.submission.prd_filename, "New.pdf");
});

test("an omitted title preserves a concurrent title change and returns its saved value", async () => {
  const upload = app.upload(1, { prd_filename: "Original.pdf" });
  await save(upload.prd_path);
  let changed = false;
  app.beforeTransaction = (input) => {
    if (
      !changed &&
      input.TransactItems[0].Update?.TableName === app.table("SUBMISSIONS")
    ) {
      changed = true;
      app.submission().project_title = "Teammate's title";
    }
  };
  const result = await save(app.submission().prd_path);
  assert.equal(result.status, 200);
  assert.equal(result.body.project_title, "Teammate's title");
  assert.equal(app.submission().project_title, "Teammate's title");
  assert.equal(result.body.prd_filename, "Original.pdf");
});

test("replacement without filename metadata clears the previous PDF's label", async () => {
  const old = app.upload(1, { prd_filename: "Old.pdf" });
  const next = app.upload(2);
  await save(old.prd_path);
  const result = await save(next.prd_path);
  assert.equal(result.status, 200);
  assert.equal(result.body.prd_filename, null);
  assert.equal(app.submission().prd_filename, null);
  assert.equal((await load()).body.submission.prd_filename, null);
});

test("legacy uploads and submissions without either field remain readable and editable", async () => {
  const upload = app.upload();
  const initial = await save(upload.prd_path);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.project_title, null);
  assert.equal(initial.body.prd_filename, null);
  delete app.submission().project_title;
  delete app.submission().prd_filename;
  const legacy = await load();
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.submission.project_title, null);
  assert.equal(legacy.body.submission.prd_filename, null);
  assert.equal((await save(app.submission().prd_path)).status, 200);
});

test("submission requests cannot override the tracked filename", async () => {
  const upload = app.upload(1, { prd_filename: "Actual.pdf" });
  const result = await save(upload.prd_path, { prd_filename: "Forged.pdf" });
  assert.equal(result.status, 400);
  assert.equal(app.submission(), undefined);
  assert.equal(app.database.calls().length, 0);
});
