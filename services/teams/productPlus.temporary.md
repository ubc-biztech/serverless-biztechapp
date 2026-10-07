Temporary PR1 and PR2 dependencies (replace with WF2/shared equivalents when merged):

- `typesProductPlus.temporary.ts`: final shared contract types, pending Elijah's shared module. Audience reads use a `Pick<Submission, "team_code" | "team_name" | "video_url">` plus the stored optional `voter_ids` String Set; rubric reads use `updated_at` plus stored `graded_submissions`. These stored fields are not added to the shared API types.
- `helpersProductPlus.temporary.ts`: table/event settings and config reads.

Set `PRODUCT_PLUS_EVENT_KEY` to the configured `eventid;year` and optionally
`PRODUCT_PLUS_SUBMISSIONS_TABLE` (base name defaults to `biztechPPSubmissions`, with
the existing `ENVIRONMENT` suffix). Dev uses `biztechPPSubmissions`; production
uses `biztechPPSubmissionsPROD`. Overrides must use the base name without `PROD`.
No table is provisioned by this PR; WF2 owns it.
Audience GET uses the existing `protect(Access.PUBLIC)` with two routes:

- Logged out: `GET /productplus/audience/submissions` (no authorizer), returning `has_voted: null`.
- Logged in: `GET /productplus/audience/submissions/self` (existing Cognito authorizer), returning `has_voted: true` or `false` by checking the verified email against `voter_ids`.

The frontend must select `/self` when logged in and send its normal login token.
Sending a token to the public route does not personalize the response. No new
auth helper, verifier dependency, or Cognito environment settings are needed.
POST still uses the existing
Cognito authorizer and `protect(Access.USER)` with normalized verified email as
user ID. Voting requires login but does not require BizTech membership.

Table keys: string `event_key` (PK), string `team_code` (SK).
Seed the configured event's `team_code: "config"` row with UTC ISO strings
`submission_deadline` and `voting_deadline` (final WF2 contract, superseding
the rough draft's `voting_enabled`). Seed submission rows according to the full
documented database schema, including `team_name`, `member_names`, `video_url`,
`prd_path`, `submitted_at`, `updated_at`, an empty `graded_submissions` list,
and counters `upvotes`/`downvotes` initialized to zero. Team codes are six-digit
strings; leave `voter_ids` absent until the first vote (DynamoDB String Set).

The unit tests use `test/dynamoFixture.mjs`, an in-memory interpreter for a subset
of DynamoDB expressions. They do not connect to AWS or seed a local table.
DynamoDB Local seeding and integration verification remain outstanding.

Run PR1 tests: `node --test services/teams/test/productPlusAudience.test.mjs`.

PR2 rubric save uses the existing Cognito authorizer and `protect(Access.ADMIN)`.
The provisional score range is 1–5 in `PRODUCT_PLUS_RUBRIC_SCORE_RANGE` in
`constants.ts`, pending confirmation of the five criteria. Scores must be five
finite numbers; comments must be a string (empty comments are allowed).
Saves update only `graded_submissions` and `updated_at`, comparing the previous
timestamp and rereading/retrying up to five times on conditional conflicts.
WF2 writes must also advance `updated_at` to participate in this version check.
Run PR2 tests: `node --test services/teams/test/productPlusRubric.test.mjs`.

Run both from the backend root:
`node --test services/teams/test/productPlusAudience.test.mjs services/teams/test/productPlusRubric.test.mjs`.

PR3 admin list is implemented as `adminSubmissions`, using the configured event
and the existing Cognito authorizer plus `protect(Access.ADMIN)`. It returns only
`RankedSubmission` fields. The detail endpoint is implemented as `adminSubmission`
with the same admin protection, reading by `(event_key, team_code)` and returning
only the documented submission, rubric, and vote fields.

WF2's PRD signer is not available in this checkout. The temporary `getPrdViewUrl`
helper generates a fresh S3 GET URL with a 15-minute expiry, using `biztech-pp-prd`
in dev and `biztech-pp-prd-prod` when `ENVIRONMENT` is `PROD`. It signs the stored
`prd_path` and never stores the resulting URL. Replace it with WF2's signer when
that workflow merges. The team service role has GetObject permission for the
corresponding private bucket; this does not change the bucket's public access.

PR3 contract tests are in `test/productPlusAdmin.test.mjs`. Run from the backend
root: `node --test services/teams/test/productPlusAdmin.test.mjs`.
Tests cover both endpoints and do not skip missing handlers.
They expect `adminSubmissions` (list) and `adminSubmission` (detail)
exports from `handlerProductPlus.ts` and the corresponding Cognito-protected GET
routes. Rename the test bindings if different handler names are chosen.

Run just the implemented list tests:
`node --test --test-name-pattern="^list" services/teams/test/productPlusAdmin.test.mjs`.

The suite covers rubric-total averages (including fractional and null averages),
rubric counts, audience scores, current-event filtering, config exclusion, exact
response shapes, missing submissions, admin authorization, and PRD signing.
It mocks DynamoDB and the AWS S3 client/presigner; no AWS credentials or network
calls are needed. Reuse WF2's signer when available, adapting the mock boundary if
its signing interface differs. URL expiry is checked for a finite positive TTL;
no specific TTL is prescribed by the contract. Dev/prod bucket names follow WF2.
Deployment and frontend handoff remain separate from these unit tests.
