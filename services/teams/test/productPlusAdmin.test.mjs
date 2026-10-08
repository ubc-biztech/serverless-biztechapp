import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import YAML from "yaml";
import { scan } from "./dynamoFixture.mjs";

// PR3 contract tests; detail tests remain red until that endpoint is implemented.
// Expected handler exports: adminSubmissions (list), adminSubmission (detail).
// AWS signing is mocked at the SDK boundary so WF2's signer can be reused.
const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../handlerProductPlus.ts", import.meta.url))
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "infrastructure",
      setup(build) {
        build.onResolve({ filter: /^\.\.\/\.\.\/lib\/db.js$/ }, () => ({
          path: "db",
          namespace: "mock"
        }));
        build.onResolve(
          { filter: /^@aws-sdk\/(client-s3|s3-request-presigner)$/ },
          (args) => ({ path: args.path, namespace: "mock" })
        );
        build.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents:
            args.path === "db"
              ? "export default globalThis.db;"
              : args.path === "@aws-sdk/client-s3"
                ? `
        export class S3Client { constructor(config) { this.config = config; } }
        export class GetObjectCommand { constructor(input) { this.input = input; } }
      `
                : "export const getSignedUrl = globalThis.getSignedUrl;"
        }));
      }
    }
  ]
});

const eventKey = "productplus;2026";
const rubric = (judge_user_id, scores) => ({
  judge_user_id,
  scores,
  comments: `Feedback from ${judge_user_id}`
});
const submission = (overrides = {}) => ({
  event_key: eventKey,
  team_code: "001234",
  team_name: "Product Team",
  member_names: ["Alice", "Bob"],
  video_url: "https://youtu.be/abcdefghijk",
  prd_path: `${eventKey}/001234/upload-id.pdf`,
  submitted_at: "2026-10-01T12:00:00.000Z",
  updated_at: "2026-10-02T12:00:00.000Z",
  graded_submissions: [
    rubric("first@ubcbiztech.com", [1, 2, 3, 4, 5]),
    rubric("second@ubcbiztech.com", [2, 3, 4, 5, 5])
  ],
  upvotes: 7,
  downvotes: 2,
  voter_ids: new Set(["private@example.com"]),
  ...overrides
});
const normalize = (value) => JSON.parse(JSON.stringify(value));

function fixture({
  rows = [submission()],
  failure,
  signingFailure,
  environment = "",
  configured = true
} = {}) {
  const stored = structuredClone(rows);
  const reads = [],
    signs = [];
  const db = {
    async scan(table, params) {
      reads.push({ table, params: normalize(params) });
      assert.equal(table, "biztechPPSubmissions");
      if (failure) throw failure;
      return scan(stored, params);
    },
    async getOneCustom(params) {
      reads.push(normalize(params));
      assert.equal(params.TableName, `biztechPPSubmissions${environment}`);
      if (failure) throw failure;
      return structuredClone(
        stored.find(
          (row) =>
            row.event_key === params.Key.event_key &&
            row.team_code === params.Key.team_code
        ) || null
      );
    }
    // No write methods: these endpoints must only read and generate view URLs.
  };
  const getSignedUrl = async (client, command, options) => {
    signs.push({
      input: normalize(command.input),
      options: normalize(options)
    });
    if (signingFailure) throw signingFailure;
    return `https://private.example/prd?signature=${signs.length}`;
  };
  const context = vm.createContext({
    module: { exports: {} },
    db,
    getSignedUrl,
    process: {
      env: {
        ENVIRONMENT: environment,
        ...(configured ? { PRODUCT_PLUS_EVENT_KEY: eventKey } : {})
      }
    },
    console: { error() {} },
    Set
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const event = (email = "admin@ubcbiztech.com", team_code = "001234") => ({
    headers: {},
    pathParameters: { team_code },
    requestContext: email
      ? { authorizer: { claims: { email, email_verified: "true" } } }
      : {}
  });
  const invoke = (name, event) => {
    assert.equal(
      typeof context.module.exports[name],
      "function",
      `PR3 handler ${name} is not implemented`
    );
    return context.module.exports[name](event);
  };
  return {
    event,
    reads,
    signs,
    stored,
    list: (event) => invoke("adminSubmissions", event),
    detail: (event) => invoke("adminSubmission", event)
  };
}

test("list returns the exact RankedSubmission shape and averages rubric totals", async () => {
  const f = fixture();
  const response = await f.list(f.event());
  assert.equal(response.statusCode, 200);
  // Totals 15 and 19 yield 17, not a per-criterion average of 3.4.
  assert.deepEqual(JSON.parse(response.body), [
    {
      team_code: "001234",
      team_name: "Product Team",
      rubric_average: 17,
      rubric_count: 2,
      upvotes: 7,
      downvotes: 2,
      audience_score: 5
    }
  ]);
  assert.equal(f.signs.length, 0);
});

test("list uses null for no rubrics and retains zero vote counts", async () => {
  const f = fixture({
    rows: [submission({ graded_submissions: [], upvotes: 0, downvotes: 0 })]
  });
  const response = await f.list(f.event());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), [
    {
      team_code: "001234",
      team_name: "Product Team",
      rubric_average: null,
      rubric_count: 0,
      upvotes: 0,
      downvotes: 0,
      audience_score: 0
    }
  ]);
});

test("list preserves fractional averages and negative audience scores", async () => {
  const f = fixture({
    rows: [
      submission({
        graded_submissions: [
          rubric("a", [1, 1, 1, 1, 1]),
          rubric("b", [1, 1, 1, 1, 2])
        ],
        upvotes: 1,
        downvotes: 4
      })
    ]
  });
  const response = await f.list(f.event());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), [
    {
      team_code: "001234",
      team_name: "Product Team",
      rubric_average: 5.5,
      rubric_count: 2,
      upvotes: 1,
      downvotes: 4,
      audience_score: -3
    }
  ]);
});

test("list scopes to the configured event and excludes config, with independent team calculations", async () => {
  const f = fixture({
    rows: [
      {
        event_key: eventKey,
        team_code: "config",
        submission_deadline: "2026-10-01T00:00:00Z"
      },
      submission({ event_key: "productplus;2025" }),
      submission({ event_key: "other;2026" }),
      submission(),
      submission({
        team_code: "005678",
        team_name: "Second Team",
        graded_submissions: [rubric("a", [5, 5, 5, 5, 5])],
        upvotes: 3,
        downvotes: 3
      })
    ]
  });
  const response = await f.list(f.event());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    JSON.parse(response.body).sort((a, b) =>
      a.team_code.localeCompare(b.team_code)
    ),
    [
      {
        team_code: "001234",
        team_name: "Product Team",
        rubric_average: 17,
        rubric_count: 2,
        upvotes: 7,
        downvotes: 2,
        audience_score: 5
      },
      {
        team_code: "005678",
        team_name: "Second Team",
        rubric_average: 25,
        rubric_count: 1,
        upvotes: 3,
        downvotes: 3,
        audience_score: 0
      }
    ]
  );
});

test("list returns an empty array when only config and other-event rows exist", async () => {
  const f = fixture({
    rows: [
      { event_key: eventKey, team_code: "config" },
      submission({ event_key: "other;2026" })
    ]
  });
  const response = await f.list(f.event());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), []);
});

test("detail returns Submission plus rubrics and counts, signing the stored PRD without persisting its URL", async () => {
  const row = submission({ prd_view_url: "https://expired.example/old" });
  const f = fixture({ rows: [row] });
  const before = structuredClone(f.stored);
  const response = await f.detail(f.event());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    team_code: row.team_code,
    team_name: row.team_name,
    member_names: row.member_names,
    video_url: row.video_url,
    prd_path: row.prd_path,
    prd_view_url: "https://private.example/prd?signature=1",
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
    graded_submissions: row.graded_submissions,
    upvotes: row.upvotes,
    downvotes: row.downvotes
  });
  assert.deepEqual(f.reads[0].Key, {
    event_key: eventKey,
    team_code: "001234"
  });
  assert.equal(f.signs.length, 1);
  assert.equal(f.signs[0].input.Bucket, "biztech-pp-prd");
  assert.equal(f.signs[0].input.Key, row.prd_path);
  assert.ok(
    Number.isFinite(f.signs[0].options.expiresIn) &&
      f.signs[0].options.expiresIn > 0,
    "PRD view URL must have a finite positive expiration"
  );
  assert.deepEqual(f.stored, before);
});

test("detail signs a fresh viewing URL on each request", async () => {
  const f = fixture();
  const first = await f.detail(f.event());
  const second = await f.detail(f.event());
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.notEqual(
    JSON.parse(first.body).prd_view_url,
    JSON.parse(second.body).prd_view_url
  );
  assert.equal(f.signs.length, 2);
});

test("detail supports an ungraded submission with zero votes", async () => {
  const f = fixture({
    rows: [submission({ graded_submissions: [], upvotes: 0, downvotes: 0 })]
  });
  const response = await f.detail(f.event());
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.deepEqual(body.graded_submissions, []);
  assert.equal(body.upvotes, 0);
  assert.equal(body.downvotes, 0);
});

test("detail uses the production PRD bucket and table", async () => {
  const f = fixture({ environment: "PROD" });
  assert.equal((await f.detail(f.event())).statusCode, 200);
  assert.equal(f.signs[0].input.Bucket, "biztech-pp-prd-prod");
});

for (const rows of [[], [submission({ event_key: "productplus;2025" })]]) {
  test(`detail returns 404 without signing for ${rows.length ? "a team in another event" : "a missing submission"}`, async () => {
    const f = fixture({ rows });
    assert.equal((await f.detail(f.event())).statusCode, 404);
    assert.equal(f.signs.length, 0);
  });
}

test("detail rejects config and missing team codes without signing", async () => {
  const f = fixture({ rows: [{ event_key: eventKey, team_code: "config" }] });
  for (const pathParameters of [{ team_code: "config" }, {}, undefined]) {
    const event = f.event();
    event.pathParameters = pathParameters;
    const response = await f.detail(event);
    assert.ok(response.statusCode >= 400 && response.statusCode < 500);
  }
  assert.equal(f.signs.length, 0);
});

for (const endpoint of ["list", "detail"]) {
  test(`${endpoint} rejects anonymous, non-admin, and unverified callers before accessing data`, async () => {
    const f = fixture();
    assert.equal((await f[endpoint](f.event(null))).statusCode, 401);
    const nonAdmin = f.event("user@example.com");
    nonAdmin.auth = { email: "admin@ubcbiztech.com", isAdmin: true };
    assert.equal((await f[endpoint](nonAdmin)).statusCode, 403);
    const unverified = f.event();
    unverified.requestContext.authorizer.claims.email_verified = "false";
    assert.equal((await f[endpoint](unverified)).statusCode, 401);
    assert.equal(f.reads.length, 0);
    assert.equal(f.signs.length, 0);
  });

  test(`${endpoint} accepts the existing Cognito admin group`, async () => {
    const f = fixture();
    const event = f.event("exec@example.com");
    event.requestContext.authorizer.claims["cognito:groups"] = "admin";
    assert.equal((await f[endpoint](event)).statusCode, 200);
  });

  test(`${endpoint} fails closed when the Product Plus event is not configured`, async () => {
    const f = fixture({ configured: false });
    assert.equal((await f[endpoint](f.event())).statusCode, 503);
    assert.equal(f.reads.length, 0);
    assert.equal(f.signs.length, 0);
  });

  test(`${endpoint} returns a server error for database failures`, async () => {
    const f = fixture({ failure: new Error("database unavailable") });
    assert.equal((await f[endpoint](f.event())).statusCode, 500);
    assert.equal(f.signs.length, 0);
  });
}

test("detail returns a server error when PRD signing fails", async () => {
  const f = fixture({ signingFailure: new Error("signer unavailable") });
  assert.equal((await f.detail(f.event())).statusCode, 500);
});

for (const [endpoint, path, handler] of [
  [
    "list",
    "productplus/admin/submissions",
    "handlerProductPlus.adminSubmissions"
  ],
  [
    "detail",
    "productplus/admin/submissions/{team_code}",
    "handlerProductPlus.adminSubmission"
  ]
]) {
  test(`${endpoint} GET route uses the existing Cognito authorizer and correct handler`, () => {
    const { functions } = YAML.parse(
      readFileSync(new URL("../serverless.yml", import.meta.url), "utf8")
    );
    const existingAuthorizer =
      functions.productPlusSaveRubric.events[0].http.authorizer;
    const routes = Object.values(functions)
      .flatMap((fn) =>
        (fn.events || []).map((event) => ({
          handler: fn.handler,
          http: event.http
        }))
      )
      .filter(
        (route) => route.http?.path === path && route.http.method === "get"
      );
    assert.equal(routes.length, 1, `Missing PR3 GET route: ${path}`);
    assert.equal(routes[0].handler, handler);
    assert.deepEqual(routes[0].http.authorizer, existingAuthorizer);
  });
}
