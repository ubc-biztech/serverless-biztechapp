import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import { build } from "esbuild";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, ScanCommand, PutCommand, BatchGetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const environment = {
  ENVIRONMENT: "", NODE_ENV: "test", PRODUCTPLUS_CLEANUP_FUNCTION: "biztechApi-productplus-dev-productplusCleanup",
  AWS_REGION: "us-west-2", AWS_ACCESS_KEY_ID: "submission-test-key",
  AWS_SECRET_ACCESS_KEY: "submission-test-secret", AWS_SESSION_TOKEN: "submission-test-token",
  AWS_EC2_METADATA_DISABLED: "true", PRODUCTPLUS_EVENT_KEY: "productplus;2026",
  PRODUCTPLUS_SUBMISSIONS_TABLE: "biztechPPSubmissions", PRODUCTPLUS_UPLOADS_TABLE: "biztechPPUploads",
  PRODUCTPLUS_TEAMS_TABLE: "testTeams", PRODUCTPLUS_MEMBERSHIPS_TABLE: "testUserMemberships",
  PRODUCTPLUS_PRD_BUCKET: "biztech-pp-prd",
  PRODUCTPLUS_MAX_PRD_BYTES: "5000000"
};

export const conditionalFailure = () => Object.assign(new Error("Transaction condition failed"), {
  name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }]
});

// Small in-memory adapter interprets the emitted expressions, including atomic
// conditions, so tests verify stored state and races rather than assumed writes.
function property(token, names = {}) { return names[token] || token; }
function value(token, item, names, values) {
  return token.startsWith(":") ? values[token] : item?.[property(token, names)];
}
function condition(expression, item, names = {}, values = {}) {
  if (!expression) return true;
  return expression.split(/\s+OR\s+/i).some(part => part.split(/\s+AND\s+/i).every(atom => {
    const absent = /^attribute_not_exists\(([^)]+)\)$/.exec(atom);
    if (absent) return item?.[property(absent[1], names)] === undefined;
    const exists = /^attribute_exists\(([^)]+)\)$/.exec(atom);
    if (exists) return item?.[property(exists[1], names)] !== undefined;
    const contains = /^contains\(([^,]+), ([^)]+)\)$/.exec(atom);
    if (contains) {
      const members = item?.[property(contains[1], names)];
      return members instanceof Set ? members.has(values[contains[2]]) : !!members?.includes(values[contains[2]]);
    }
    const comparison = /^(\S+) (=|<>) (\S+)$/.exec(atom);
    assert.ok(comparison, `Unsupported condition: ${atom}`);
    const lhs = value(comparison[1], item, names, values);
    const rhs = value(comparison[3], item, names, values);
    return lhs !== undefined && (comparison[2] === "=" ? isDeepStrictEqual(lhs, rhs) : !isDeepStrictEqual(lhs, rhs));
  }));
}
function commaParts(text) {
  const parts = [];
  let depth = 0, start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "(") depth++;
    if (text[index] === ")") depth--;
    if (text[index] === "," && depth === 0) { parts.push(text.slice(start, index).trim()); start = index + 1; }
  }
  parts.push(text.slice(start).trim());
  return parts;
}
function update(input, item) {
  const names = input.ExpressionAttributeNames || {}, values = input.ExpressionAttributeValues || {};
  const result = structuredClone(item || input.Key);
  const [set, remove] = input.UpdateExpression.replace(/^SET /, "").split(" REMOVE ");
  for (const assignment of commaParts(set)) {
    const [field, expression] = assignment.split(" = ");
    const fallback = /^if_not_exists\(([^,]+), ([^)]+)\)(?: \+ (\S+))?$/.exec(expression);
    let next = fallback
      ? item?.[property(fallback[1], names)] ?? values[fallback[2]]
      : value(expression, result, names, values);
    if (fallback?.[3]) next += values[fallback[3]];
    result[property(field, names)] = structuredClone(next);
  }
  if (remove) for (const field of commaParts(remove)) delete result[property(field, names)];
  return result;
}
function validateExpressions(input) {
  const expressions = [input.ConditionExpression, input.UpdateExpression].filter(Boolean).join(" ");
  for (const key of Object.keys(input.ExpressionAttributeNames || {})) assert.ok(expressions.includes(key), `Unused alias ${key}`);
  for (const key of Object.keys(input.ExpressionAttributeValues || {})) assert.ok(expressions.includes(key), `Unused value ${key}`);
}

export async function runtime({ includeTeams = false } = {}) {
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const clock = { now: Date.parse("2026-10-05T12:00:00.250Z") };
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const bundle = await build({
    stdin: { contents: `export * from ${JSON.stringify(fileURLToPath(new URL("../../handler.ts", import.meta.url)))};
      ${includeTeams ? `export { leaveTeam, joinTeam } from ${JSON.stringify(fileURLToPath(new URL("../../../teams/handler.ts", import.meta.url)))};` : ""}`,
      loader: "ts", resolveDir: fileURLToPath(new URL("../../", import.meta.url)) },
    bundle: true, platform: "node", target: "node22", format: "cjs", packages: "external", write: false, logLevel: "silent"
  });
  const module = { exports: {} }, logs = [];
  compileFunction(bundle.outputFiles[0].text, ["require", "module", "exports", "process", "Buffer", "console", "Date"])(
    createRequire(import.meta.url), module, module.exports, process, Buffer,
    { error(...args) { logs.push(args); }, log(...args) { logs.push(args); } }, TestDate
  );
  const database = mockClient(DynamoDBDocumentClient), s3 = mockClient(S3Client), lambda = mockClient(LambdaClient);
  const rows = new Map(), objects = new Map();
  const state = {
    ...module.exports, database, s3, lambda, rows, objects, clock, logs, pageSize: Infinity,
    email: "member@example.com", teamCode: "012345",
    beforeTransaction: undefined, afterTransaction: undefined, beforeGetObject: undefined, beforeDelete: undefined, beforeCopy: undefined,
    table(kind) { return process.env[`PRODUCTPLUS_${kind}_TABLE`]; },
    key(table, key) { return `${table}:${JSON.stringify(Object.entries(key).sort())}`; },
    get(table, key) { return rows.get(this.key(table, key)); },
    itemKey(table, item) {
      if (table === this.table("UPLOADS")) return { prd_path: item.prd_path };
      if (table === this.table("MEMBERSHIPS")) return { event_key: item.event_key, user_id: item.user_id };
      if ([this.table("SUBMISSIONS"), this.table("TEAMS")].includes(table)) return { event_key: item.event_key, team_code: item.team_code };
      // The unrelated old-team regression seeds its own legacy records.
      return { id: item.id, "eventID;year": item["eventID;year"] };
    },
    put(table, item) {
      rows.set(this.key(table, this.itemKey(table, item)), structuredClone(item));
    },
    delete(table, key) { rows.delete(this.key(table, key)); },
    submission() { return this.get(this.table("SUBMISSIONS"), { event_key: environment.PRODUCTPLUS_EVENT_KEY, team_code: this.teamCode }); },
    config() { return this.get(this.table("SUBMISSIONS"), { event_key: environment.PRODUCTPLUS_EVENT_KEY, team_code: "config" }); },
    team() { return this.get(this.table("TEAMS"), { event_key: environment.PRODUCTPLUS_EVENT_KEY, team_code: this.teamCode }); },
    membership() { return this.get(this.table("MEMBERSHIPS"), { event_key: environment.PRODUCTPLUS_EVENT_KEY, user_id: this.email }); },
    upload(number = 1, overrides = {}) {
      const id = `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
      const upload = {
        event_key: environment.PRODUCTPLUS_EVENT_KEY, team_code: this.teamCode,
        upload_id: id, content_type: "application/pdf", status: "pending",
        created_at: new Date(clock.now).toISOString(), updated_at: new Date(clock.now).toISOString(),
        upload_expires_at: new Date(clock.now + 300000).toISOString(),
        ...overrides
      };
      upload.prd_path = overrides.prd_path ?? `productplus/temp/${upload.event_key}/${upload.team_code}/${upload.upload_id}/prd.pdf`;
      this.put(this.table("UPLOADS"), upload);
      objects.set(upload.prd_path, { ContentType: "application/pdf", bytes: Buffer.from("%PDF-1.7\nPDF content"), ETag: '"pdf-etag"' });
      return upload;
    },
    permanent(upload) { return `productplus/submitted/${upload.event_key}/${upload.team_code}/${upload.upload_id}/prd.pdf`; },
    task(kind, payload) { return { internalTask: kind, payload: { event_key: environment.PRODUCTPLUS_EVENT_KEY, ...payload } }; },
    form(path) { return { team_name: " Example Team ", member_names: [" Member One "], video_url: "https://youtu.be/abcdefghijk", prd_path: path }; },
    event(body, claims = {}) {
      return {
        body: body === null || typeof body === "string" ? body : JSON.stringify(body), headers: {},
        requestContext: { authorizer: { claims: { email: this.email, email_verified: "true", ...claims } } }
      };
    },
    async invoke(handler, body = null, claims = {}) {
      const response = await handler(this.event(body, claims), {}, () => {});
      return { status: response.statusCode, body: JSON.parse(response.body) };
    },
    reset() {
      Object.assign(process.env, environment);
      this.teamCode = "012345"; this.email = "member@example.com";
      clock.now = Date.parse("2026-10-05T12:00:00.250Z");
      rows.clear(); objects.clear(); logs.length = 0; database.reset(); s3.reset(); lambda.reset();
      this.beforeTransaction = this.afterTransaction = this.beforeGetObject = this.beforeDelete = this.beforeCopy = undefined;
      this.pageSize = Infinity;
      this.put(this.table("MEMBERSHIPS"), { event_key: environment.PRODUCTPLUS_EVENT_KEY, user_id: this.email, team_code: this.teamCode });
      this.put(this.table("TEAMS"), { event_key: environment.PRODUCTPLUS_EVENT_KEY, team_code: this.teamCode,
        member_ids: new Set([this.email]), team_name: "Example Team", leader_user_id: this.email });
      this.put(this.table("SUBMISSIONS"), { event_key: environment.PRODUCTPLUS_EVENT_KEY, team_code: "config",
        submission_deadline: "2026-10-05T13:00:00Z", voting_deadline: "2026-10-06T13:00:00Z" });
      database.onAnyCommand().rejects(new Error("Unexpected database call"));
      database.on(GetCommand).callsFake(input => ({ Item: structuredClone(this.get(input.TableName, input.Key)) }));
      database.on(ScanCommand).callsFake(input => {
        const all = [...rows].filter(([key]) => key.startsWith(`${input.TableName}:`)).map(([, row]) => structuredClone(row));
        const offset = input.ExclusiveStartKey?.testOffset || 0;
        const scanned = all.slice(offset, offset + this.pageSize);
        const page = scanned.filter(row => row.event_key === input.ExpressionAttributeValues[":event"] &&
          row.team_code === input.ExpressionAttributeValues[":code"]);
        return { Items: page, ...(offset + scanned.length < all.length ? { LastEvaluatedKey: { testOffset: offset + scanned.length } } : {}) };
      });
      database.on(BatchGetCommand).callsFake(input => ({ Responses: Object.fromEntries(
        Object.entries(input.RequestItems).map(([table, request]) => [table, request.Keys.map(key => structuredClone(this.get(table, key))).filter(Boolean)])
      ) }));
      database.on(TransactWriteCommand).callsFake(async input => {
        await this.beforeTransaction?.(input);
        const keys = new Set();
        for (const entry of input.TransactItems) {
          const operation = entry.Update || entry.Delete || entry.ConditionCheck || entry.Put;
          const key = this.key(operation.TableName, operation.Key || this.itemKey(operation.TableName, operation.Item));
          assert.ok(!keys.has(key), "A transaction cannot act on the same item twice"); keys.add(key);
          validateExpressions(operation);
          if (!condition(operation.ConditionExpression, rows.get(key), operation.ExpressionAttributeNames, operation.ExpressionAttributeValues)) throw conditionalFailure();
        }
        for (const entry of input.TransactItems) {
          if (entry.Update) this.put(entry.Update.TableName, update(entry.Update, this.get(entry.Update.TableName, entry.Update.Key)));
          if (entry.Delete) this.delete(entry.Delete.TableName, entry.Delete.Key);
          if (entry.Put) this.put(entry.Put.TableName, entry.Put.Item);
        }
        await this.afterTransaction?.(input);
        return {};
      });
      database.on(PutCommand).callsFake(input => {
        const key = this.itemKey(input.TableName, input.Item);
        if (!condition(input.ConditionExpression, this.get(input.TableName, key))) throw conditionalFailure();
        this.put(input.TableName, input.Item);
        return {};
      });
      database.on(UpdateCommand).callsFake(input => {
        validateExpressions(input);
        const old = this.get(input.TableName, input.Key);
        if (!condition(input.ConditionExpression, old, input.ExpressionAttributeNames, input.ExpressionAttributeValues)) throw Object.assign(new Error("Conditional update failed"), { name: "ConditionalCheckFailedException" });
        this.put(input.TableName, update(input, old));
        return {};
      });
      s3.onAnyCommand().rejects(new Error("Unexpected S3 call"));
      s3.on(HeadObjectCommand).callsFake(input => {
        const object = objects.get(input.Key);
        if (!object) throw Object.assign(new Error("Missing file"), { name: "NotFound" });
        return { ContentType: object.ContentType, ContentLength: object.ContentLength ?? object.bytes.length, ETag: object.ETag };
      });
      s3.on(GetObjectCommand).callsFake(async input => {
        await this.beforeGetObject?.(input);
        const object = objects.get(input.Key);
        if (!object) throw Object.assign(new Error("Missing file"), { name: "NoSuchKey" });
        assert.equal(input.Range, "bytes=0-7");
        if (input.IfMatch !== object.ETag) throw Object.assign(new Error("Changed file"), { name: "PreconditionFailed" });
        return { Body: { transformToByteArray: async () => object.bytes.subarray(0, 8) } };
      });
      s3.on(CopyObjectCommand).callsFake(async input => {
        await this.beforeCopy?.(input);
        const key = decodeURIComponent(input.CopySource.slice(input.CopySource.indexOf("/") + 1));
        const object = objects.get(key);
        if (!object) throw Object.assign(new Error("Missing source"), { name: "NoSuchKey" });
        if (input.CopySourceIfMatch && input.CopySourceIfMatch !== object.ETag) throw Object.assign(new Error("Changed source"), { name: "PreconditionFailed" });
        objects.set(input.Key, { ...object, bytes: Buffer.from(object.bytes) });
        return { CopyObjectResult: { ETag: object.ETag } };
      });
      lambda.on(InvokeCommand).resolves({ StatusCode: 202 });
      s3.on(DeleteObjectCommand).callsFake(async input => {
        await this.beforeDelete?.(input); objects.delete(input.Key); return {};
      });
    },
    restore() {
      database.restore(); s3.restore(); lambda.restore();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  };
  state.reset();
  return state;
}
