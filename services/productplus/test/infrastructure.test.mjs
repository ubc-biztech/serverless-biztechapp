import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import YAML from "yaml";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, PutBucketCorsCommand, GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand } from "@aws-sdk/client-s3";

function parse(text) {
  const document = YAML.parseDocument(text);
  assert.equal(document.errors.length, 0);
  return document.toJSON(); // Preserve CF intrinsic mappings; !ImportValue values are opaque here.
}
const yaml = parse(await readFile(new URL("../serverless.yml", import.meta.url), "utf8"));
const resources = yaml.resources.Resources;
const s3 = mockClient(S3Client);
let responses;
const module = { exports: {} };
compileFunction(resources.ProductPlusCorsFunction.Properties.Code.ZipFile, ["require", "exports", "fetch", "console"])(
  createRequire(import.meta.url), module.exports,
  async (url, options) => { responses.push(JSON.parse(options.body)); return { ok: true }; },
  { error() {} }
);
const event = request => ({
  RequestType: request, ResourceProperties: { ...resources.ProductPlusBucketCors.Properties, BucketName: "test-private-bucket" },
  ResponseURL: "https://cloudformation.invalid/response", StackId: "stack", RequestId: "request", LogicalResourceId: "resource"
});
beforeEach(() => {
  responses = [];
  s3.reset();
  s3.onAnyCommand().rejects(new Error("Unexpected bucket operation"));
  s3.on(PutBucketCorsCommand).resolves({});
  s3.on(PutBucketLifecycleConfigurationCommand).resolves({});
});
after(() => s3.restore());

test("cleanup is private, unscheduled and has bounded retries without SQS", () => {
  const cleanup = yaml.functions.productplusCleanup;
  assert.equal(cleanup.handler, "handler.cleanup");
  assert.equal(cleanup.events, undefined);
  assert.equal(cleanup.maximumRetryAttempts, 2);
  assert.equal(cleanup.maximumEventAge, 21600);
  assert.equal(cleanup.destinations, undefined);
  assert.ok(Object.values(resources).every(resource => resource.Type !== "AWS::SQS::Queue"));
  for (const fn of Object.values(yaml.functions)) assert.ok((fn.events || []).every(event => !event.schedule && !event.sqs));
  assert.equal(yaml.provider.environment.PRODUCTPLUS_UPLOAD_GRACE_SECONDS, undefined);
});

test("five authenticated routes preserve the API contracts and expected handlers", () => {
  const routes = Object.values(yaml.functions).flatMap(fn => fn.events || []).map(event => event.http);
  assert.equal(routes.length, 5);
  assert.ok(routes.every(route => route.authorizer.type === "COGNITO_USER_POOLS"));
  assert.deepEqual(routes.map(route => `${route.method} ${route.path}`).sort(), [
    "get productplus/admin/config", "get productplus/submissions", "post productplus/submissions/upload",
    "put productplus/admin/config", "put productplus/submissions"
  ]);
});

test("bucket resources expire only temporary files and retain externally owned buckets", () => {
  assert.deepEqual(resources.ProductPlusBucketCors.Properties.LifecycleRules, [{
    ID: "productplus-temp-expiration", Status: "Enabled", Filter: { Prefix: "productplus/temp/" }, Expiration: { Days: 1 }
  }]);
  assert.ok(Object.values(resources).every(resource => resource.Type !== "AWS::S3::Bucket" && resource.Type !== "AWS::DynamoDB::Table"));
  const cors = resources.ProductPlusBucketCors.Properties.CorsRules[0];
  assert.deepEqual(cors.AllowedMethods, ["PUT", "GET", "HEAD"]);
  assert.ok(cors.AllowedHeaders.includes("If-None-Match"));
  assert.deepEqual(cors.AllowedOrigins["Fn::If"][1], ["https://app.ubcbiztech.com"]);
});

test("stage-selected tables and IAM use the new team schema with explicit deployment TODOs", () => {
  const listBucket = yaml.provider.iamRoleStatements.find(statement => statement.Action === "s3:ListBucket");
  assert.equal(listBucket.Resource, "arn:aws:s3:::${self:provider.environment.PRODUCTPLUS_PRD_BUCKET}");
  for (const kind of ["SUBMISSIONS", "UPLOADS", "TEAMS", "MEMBERSHIPS"]) {
    assert.match(yaml.provider.environment[`PRODUCTPLUS_${kind}_TABLE`], /\$\{self:provider.environment.ENVIRONMENT\}$/);
  }
  assert.equal(yaml.provider.environment.PRODUCTPLUS_TEAMS_TABLE,
    "TODO_NEW_TEAMS_TABLE${self:provider.environment.ENVIRONMENT}");
  assert.equal(yaml.provider.environment.PRODUCTPLUS_MEMBERSHIPS_TABLE,
    "TODO_NEW_USER_MEMBERSHIPS_TABLE${self:provider.environment.ENVIRONMENT}");
  assert.equal(yaml.provider.environment.PRODUCTPLUS_REGISTRATIONS_TABLE, undefined);
  const membership = yaml.provider.iamRoleStatements.find(statement =>
    Array.isArray(statement.Resource) && statement.Resource.some(resource => resource.includes("PRODUCTPLUS_MEMBERSHIPS_TABLE")));
  assert.deepEqual(membership.Action, ["dynamodb:GetItem", "dynamodb:ConditionCheckItem"]);
  assert.ok(membership.Resource.some(resource => resource.includes("PRODUCTPLUS_TEAMS_TABLE")));
  assert.ok(yaml.provider.iamRoleStatements.every(statement => !JSON.stringify(statement.Resource).includes("REGISTRATIONS")));
  const invocation = yaml.provider.iamRoleStatements.find(statement => statement.Action === "lambda:InvokeFunction");
  assert.equal(invocation.Resource, "arn:aws:lambda:us-west-2:432714361962:function:${self:provider.environment.PRODUCTPLUS_CLEANUP_FUNCTION}");
});

test("bucket setup merges its rule while preserving unrelated Lifecycle rules", async () => {
  const unrelated = { ID: "unrelated-prefix", Status: "Enabled", Filter: { Prefix: "other/" }, Expiration: { Days: 90 } };
  s3.on(GetBucketLifecycleConfigurationCommand).resolves({ TransitionDefaultMinimumObjectSize: "varies_by_storage_class", Rules: [unrelated, {
    ID: "productplus-temp-expiration", Status: "Enabled", Filter: { Prefix: "incorrect/" }, Expiration: { Days: 2 }
  }] });
  await module.exports.handler(event("Update"));
  const input = s3.commandCalls(PutBucketLifecycleConfigurationCommand)[0].args[0].input;
  assert.deepEqual(input.LifecycleConfiguration.Rules, [unrelated, ...event("Update").ResourceProperties.LifecycleRules]);
  assert.equal(input.TransitionDefaultMinimumObjectSize, "varies_by_storage_class");
  assert.equal(responses[0].Status, "SUCCESS");
});

test("missing Lifecycle configuration is initialized without inventing a bucket", async () => {
  s3.on(GetBucketLifecycleConfigurationCommand).rejects(Object.assign(new Error("No rules"), { name: "NoSuchLifecycleConfiguration" }));
  await module.exports.handler(event("Create"));
  assert.deepEqual(s3.commandCalls(PutBucketLifecycleConfigurationCommand)[0].args[0].input.LifecycleConfiguration.Rules,
    event("Create").ResourceProperties.LifecycleRules);
  assert.equal(responses[0].Status, "SUCCESS");
});

test("bucket setup errors report failure to CloudFormation and delete retains configuration", async () => {
  s3.on(GetBucketLifecycleConfigurationCommand).rejects(new Error("Access denied"));
  await module.exports.handler(event("Update"));
  assert.equal(responses[0].Status, "FAILED");
  assert.equal(s3.commandCalls(PutBucketLifecycleConfigurationCommand).length, 0);
  s3.reset();
  responses = [];
  await module.exports.handler(event("Delete"));
  assert.equal(s3.calls().length, 0);
  assert.equal(responses[0].Status, "SUCCESS");
});
