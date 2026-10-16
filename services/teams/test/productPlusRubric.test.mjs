import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

// Keep real auth, request validation, query mapping, and weighting; replace AWS only.
const mocks = {
  "../../lib/db.js": "export default globalThis.infrastructure.db;",
  "../../lib/docClient.js": "export default globalThis.infrastructure.docClient;",
  "@aws-sdk/lib-dynamodb": "export class QueryCommand { constructor(input) { this.input = input; } }",
  "@aws-sdk/client-s3": "export class S3Client {} export class GetObjectCommand {}",
  "@aws-sdk/s3-request-presigner": "export const getSignedUrl = () => {};"
};
const bundlePromise = build({
  entryPoints: [fileURLToPath(new URL("../handlerProductPlus.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [{
    name: "isolated-infrastructure",
    setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path }) =>
        Object.hasOwn(mocks, path) ? {
          path,
          namespace: "mock"
        } : undefined);
      build.onLoad({
        filter: /.*/,
        namespace: "mock"
      }, ({ path }) => ({ contents: mocks[path] }));
    }
  }]
});

const rubric = (scores, judge_user_id = "judge@ubcbiztech.com") => ({
  judge_user_id,
  scores,
  comments: ["Problem", "Fit", "Business", "Evidence", "Pitch"]
});

async function fixture(graded_submissions = []) {
  const bundle = await bundlePromise;
  const row = {
    event_key: "product+;2026",
    team_code: "012345",
    team_name: "Test team",
    graded_submissions,
    upvotes: 8,
    downvotes: 3
  };
  const writes = [];
  const context = vm.createContext({
    module: { exports: {} },
    require: createRequire(import.meta.url),
    process: {
      env: {
        PRODUCTPLUS_EVENT_KEY: "product+;2026",
        PRODUCTPLUS_SUBMISSIONS_TABLE: "test-productplus-submissions"
      }
    },
    console: {
      ...console,
      error() {}
    },
    infrastructure: {
      db: {
        async getOneCustom() { return row; },
        async updateDBCustom(input) {
          writes.push(input);
          row.graded_submissions = input.ExpressionAttributeValues[":rubrics"];
        }
      },
      docClient: { async send() { return { Items: [row] }; } }
    }
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const event = (payload = rubric([10, 8, 6, 4, 2])) => ({
    requestContext: {
      authorizer: {
        claims: {
          email: "judge@ubcbiztech.com",
          email_verified: "true"
        }
      }
    },
    pathParameters: { team_code: row.team_code },
    body: typeof payload === "string" ? payload : JSON.stringify(payload)
  });
  return {
    handler: context.module.exports,
    event,
    row,
    writes
  };
}

test("saving keeps five raw scores and matching comments, then the list weights them once", async () => {
  const { handler, event, row, writes } = await fixture();
  const response = await handler.saveRubric(event());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), rubric([10, 8, 6, 4, 2]));
  assert.equal(writes.length, 1);
  assert.deepEqual(Array.from(row.graded_submissions[0].scores), [10, 8, 6, 4, 2]);
  const listing = JSON.parse((await handler.adminSubmissions(event())).body)[0];
  assert.equal(listing.rubric_average, 68);
  assert.equal(listing.rubric_count, 1);
  assert.equal(listing.audience_score, 5);
});

test("saving accepts endpoints and fractional scores out of 10", async () => {
  const { handler, event } = await fixture();
  const scores = [0, 2.5, 5, 7.5, 10];
  const response = await handler.saveRubric(event(rubric(scores)));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).scores, scores);
  const listing = JSON.parse((await handler.adminSubmissions(event())).body)[0];
  assert.equal(listing.rubric_average, 40);
});

test("admin detail returns all five scores and comments unchanged", async () => {
  const saved = rubric([10, 8, 6, 4, 2]);
  const { handler, event, row } = await fixture([saved]);
  row.prd_path = "";
  const response = await handler.adminSubmission(event());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).graded_submissions, [saved]);
});

test("resaving replaces the judge's five entries and preserves other judges", async () => {
  const otherJudge = rubric([1, 2, 3, 4, 5], "second@ubcbiztech.com");
  const { handler, event, row, writes } = await fixture([
    rubric([10, 8, 6, 4, 2]),
    otherJudge
  ]);
  const replacement = {
    ...rubric([2, 4, 6, 8, 10]),
    comments: ["New problem", "New fit", "New business", "New evidence", "New pitch"]
  };
  const response = await handler.saveRubric(event(replacement));
  assert.equal(response.statusCode, 200);
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(row.graded_submissions)), [replacement, otherJudge]);
});

const invalidPayloads = [
  {
    ...rubric([1, 2, 3, 4]),
    comments: ["", "", "", ""]
  },
  rubric([1, 2, 3, 4, 5, 6]),
  {
    ...rubric([1, 2, 3, 4, 5]),
    comments: ["", "", "", ""]
  },
  {
    ...rubric([1, 2, 3, 4, 5]),
    comments: ["", "", "", "", "", ""]
  },
  {
    ...rubric([1, 2, 3, 4, 5]),
    comments: ["", "", 0, "", ""]
  },
  rubric([-0.01, 2, 3, 4, 5]),
  rubric([10.01, 2, 3, 4, 5]),
  rubric(["10", 2, 3, 4, 5]),
  rubric([null, 2, 3, 4, 5]),
  "{\"scores\":[1e309,2,3,4,5],\"comments\":[\"\",\"\",\"\",\"\",\"\"]}"
];

invalidPayloads.forEach((payload, index) => {
  test(`invalid rubric ${index + 1} is rejected before writing`, async () => {
    const { handler, event, writes } = await fixture();
    assert.equal((await handler.saveRubric(event(payload))).statusCode, 406);
    assert.equal(writes.length, 0);
  });
});

for (const [scores, expected] of [
  [[10, 0, 0, 0, 0], 25],
  [[0, 10, 0, 0, 0], 25],
  [[0, 0, 10, 0, 0], 25],
  [[0, 0, 0, 10, 0], 15],
  [[0, 0, 0, 0, 10], 10],
  [[10, 10, 10, 10, 10], 100],
  [[0, 0, 0, 0, 0], 0],
  [[5.5, 5.5, 5.5, 5.5, 5.5], 55]
]) {
  test(`scores ${scores} yield ${expected}/100`, async () => {
    const { handler, event } = await fixture([rubric(scores)]);
    const response = await handler.adminSubmissions(event());
    assert.equal(response.statusCode, 200);
    assert.ok(Math.abs(JSON.parse(response.body)[0].rubric_average - expected) < 1e-10);
  });
}

test("the team average is the mean of judges' weighted totals", async () => {
  const { handler, event } = await fixture([
    rubric([10, 8, 6, 4, 2]),
    rubric([10, 10, 10, 10, 10], "second@ubcbiztech.com")
  ]);
  const listing = JSON.parse((await handler.adminSubmissions(event())).body)[0];
  assert.equal(listing.rubric_average, 84);
  assert.equal(listing.rubric_count, 2);
});

test("ungraded teams retain a null average and zero rubric count", async () => {
  const { handler, event } = await fixture();
  const listing = JSON.parse((await handler.adminSubmissions(event())).body)[0];
  assert.equal(listing.rubric_average, null);
  assert.equal(listing.rubric_count, 0);
});

test("rubric saves and ranking lists still require admin access", async () => {
  const { handler, event, writes } = await fixture();
  const anonymous = {
    ...event(),
    requestContext: {}
  };
  assert.equal((await handler.saveRubric(anonymous)).statusCode, 401);
  assert.equal((await handler.adminSubmissions(anonymous)).statusCode, 401);
  const regularUser = event();
  regularUser.requestContext.authorizer.claims.email = "user@example.com";
  assert.equal((await handler.saveRubric(regularUser)).statusCode, 403);
  assert.equal((await handler.adminSubmissions(regularUser)).statusCode, 403);
  assert.equal(writes.length, 0);
});
