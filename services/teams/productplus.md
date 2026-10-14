# Product Plus judging and audience voting

Workflow 3 uses Workflow 2's submissions table and Workflow 1's six-digit public
`team_code` identifier. It does not change team membership or provision storage.

## Deployment configuration

The stage's `config.dev.json`, `config.prod.json`, or `config.staging.json` sets
`PRODUCTPLUS_EVENT_KEY` and `PRODUCTPLUS_PRD_BUCKET`. Serverless supplies
`PRODUCTPLUS_SUBMISSIONS_TABLE` with the environment suffix already applied.
These use the same `PRODUCTPLUS_*` names as Workflow 2. The event key and bucket
names are configuration, not deployment secrets.

Expected existing resources:

| Resource | Dev/staging | Production | Keys |
| --- | --- | --- | --- |
| Submissions | `biztechPPSubmissions` | `biztechPPSubmissionsPROD` | `event_key`, `team_code` (Strings) |
| Private PRDs | `biztech-pp-prd` | `biztech-pp-prd-prod` | Workflow 2's stored `prd_path` |

The config row has `team_code: "config"`, `submission_deadline`, and
`voting_deadline`. Tables and buckets remain externally provisioned; verify their
existence, key schema, and bucket settings before deployment. This branch adds
no table, bucket, stream, queue, or new storage migration.

## Contracts and concurrency

Submission/admin fields match Workflow 2, including nullable `project_title` and
`prd_filename` metadata. Admin detail returns `prd_view_url: null` when no PDF
path exists. Signing uses the configured bucket only.

`graded_submissions` remains the existing array of
`{ judge_user_id, scores, comments }` records. Saves replace only that judge's
entry and compare the previous array in the conditional write. Concurrent judges
are reread and retried as before. This preserves Workflow 2's stored shape and
does not change the submission's `updated_at`, form fields, votes, or counters.
No rubric-map migration or separate version field is introduced.

Each new rubric contains exactly four finite numeric scores and four string
comments. Score bounds are controlled by the frontend; the API has no minimum
or maximum. `comments[i]` describes `scores[i]`; the judge ID comes
from the authenticated user. Saving again replaces that judge's entire rubric,
while retaining other judges' rubrics. A team's submission re-upload preserves
the saved rubrics.

Example rubric request:

```json
{
  "scores": [4, 3, 5, 4],
  "comments": ["Clear problem", "Needs more detail", "Strong solution", "Good presentation"]
}
```

Existing stored rubrics are not migrated by this change. Workflow 2 preserves
the rubric array without interpreting its contents; its duplicate `Rubric` type
must also use `comments: string[]` when integrating the branches.

Fractional scores are accepted. No comment-length limit is imposed.

## Audience access

The audience list returns an empty submissions array until the submission
window closes. Thereafter it returns submitted entries with a nonempty video,
in randomized order; it remains readable after voting closes. Voting itself is
allowed only within the configured voting window and for submitted videos.
Voting opens at `submission_deadline` (also returned as `voting_opens_at`) and
closes at `voting_deadline`.

Admin lists, submission details, and rubric saves have no deadline restriction.
They remain available before, during, and after voting, including when the
voting deadlines are not configured. Admin authorization still applies.

Public list responses expose no rubrics, PRDs, vote counts, or voter emails.
Anonymous requests return `has_voted: null`. Authenticated clients must use
`/productplus/audience/submissions/self` so Cognito verifies their identity.
Duplicate votes remain atomic and return 409.

List reads use a paginated DynamoDB Query for the current event's partition,
including empty filtered pages. The config row is excluded after querying;
DynamoDB Query filters cannot filter on the sort key.

## Local routing and scope

These handlers remain in the Teams service. The specific local proxy mounts
`/productplus/audience` and `/productplus/admin/submissions` precede Workflow 2's
broader `/productplus` mount so requests reach the declaring service.

Inherited event-Q&A/Slack changes from dev are retained without further changes.
Branch-added unit tests are removed as requested, with no new CI test
step. Team deletion behavior and its existing cleanup follow-up are unchanged.
