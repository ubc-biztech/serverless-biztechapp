# Product Plus submissions, files, and configuration

Workflow 2 owns submission/config records, private PRD uploads, and cleanup.
Team membership follows the Workflow 1 stack ending at PR #808. Audience voting
and judge/admin submission routes are provided by Workflow 3.

## Team contract

| Record | Keys | Fields read by this service |
| --- | --- | --- |
| Registration | `id` = verified email; `eventID;year` | `teamID` = six-digit team code |
| Team | `id` = six-digit team code; `eventID;year` | `member_ids`: DynamoDB String Set (`Set<string>`) |

Workflow 1 owns team creation, joining, leaving, kicking, and leader handoff.
The existing legacy Product Plus join/leave integration uses the same stored
fields. Its retry and best-effort cleanup delivery behavior is unchanged. The caller
must have a registration pointing to an existing team whose member Set contains
their verified email. Saves recheck both records inside the transaction so a
concurrent leave or removal prevents a write.

A team's stored `id`, a registration's `teamID`, and the API's `team_code` refer
to the same six-digit string. Leading zeroes must be preserved. The different
field names identify their respective storage/API contracts.

## HTTP routes

All routes use the existing Cognito authorizer and shared verified-email auth.
Config endpoints additionally require admin access.

The `teams` service owns the shared API Gateway prefixes `/productplus` and
`/productplus/admin`. This service imports their resource IDs from the team's
CloudFormation exports instead of creating duplicate paths. The shared
`scripts/deploy.sh <dev|prod>` script deploys `teams` before `productplus` so the
exports exist before they are imported, including on a stage's first deployment.
When deploying these services individually, deploy `teams` first.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/productplus/submissions` | Current team's submission (or null), submission deadline, `can_edit`, and judge `feedback` (comments only, no scores) |
| POST | `/productplus/submissions/upload` | Signed private PDF upload URL and server-generated `prd_path` |
| PUT | `/productplus/submissions` | Save the current team's form and validated PDF |
| GET | `/productplus/admin/config` | Read deadlines |
| PUT | `/productplus/admin/config` | Save deadlines |

Upload input: `{ content_type: "application/pdf", prd_filename?: string }`.
The optional original filename is a display label; it never becomes an S3 key.
Use the returned upload method and headers, including `If-None-Match`, when
putting the PDF bytes into S3.

Save input: `{ team_name, member_names, video_url, prd_path, project_title? }`.
Text is validated and trimmed. Omitted project titles preserve an existing title;
replacing a PDF adopts the replacement upload's filename. Clients cannot choose
their ownership, counters, rubrics, or tracking state.

Submission responses contain `team_code`, `team_name`, `project_title`,
`member_names`, `video_url`, `prd_path`, `prd_filename`, `prd_view_url`,
`submitted_at`, and `updated_at`. Older records without optional title/filename
fields return null for those fields. View URLs are generated per response and
never stored. Form saves preserve existing judging and voting data.

Config input contains only `submission_deadline` and `voting_deadline`, both
UTC ISO timestamps. The voting deadline must follow the submission deadline.
Uploads and saves close at the submission deadline; reads remain available.

## Storage and shared Workflow 3 contract

| Resource | Dev/staging | Production | Key |
| --- | --- | --- | --- |
| Submissions/config | `biztechPPSubmissions` | `biztechPPSubmissionsPROD` | `event_key` + `team_code` (Strings) |
| Upload tracking | `biztechPPUploads` | `biztechPPUploadsPROD` | `prd_path` (String) |
| Private PDFs | `biztech-pp-prd` | `biztech-pp-prd-prod` | Server-generated S3 key |

The config row uses `{ event_key: "product+;2026", team_code: "config" }`.
Submission records share that event key and use their six-digit team code.
Rubrics are stored in `graded_submissions`, counters in `upvotes`/`downvotes`,
and voter emails in `voter_ids: Set<string>` (absent until the first vote).
Each rubric stores five raw scores out of 10 and five corresponding comments,
ordered Problem Definition, Problem-Solution Fit, Business Viability,
Research & Supporting Evidence, and Video Pitch & Creativity. Judging applies
weights of 25%, 25%, 25%, 15%, and 10% when reporting totals out of 100; the saved
scores remain unweighted. See [the judging contract](../teams/productplus.md)
for validation and averaging details.
Workflow 3 should reuse the types and `submissionResponse` in this service,
including the project title and filename fields for admin detail. Public audience
responses should continue to project only their permitted fields.

Upload tracking stays under the temporary `prd_path` after promotion. Its
`team_code` identifies the owner. Files are promoted from
`productplus/temp/{event_key}/{team_code}/{upload_id}/prd.pdf` to
`productplus/submitted/{event_key}/{team_code}/{upload_id}/prd.pdf` before the
submission references them. Cleanup checks references before deleting files.

The tables and buckets are externally provisioned. Verify their keys and bucket
names before deploying. A table provisioned with a `teamID` sort key needs an
explicit migration/replacement decision; changing source code does not rename a
DynamoDB primary key.

## Configuration

`PRODUCTPLUS_EVENT_KEY` selects the event. `PRODUCTPLUS_SUBMISSIONS_TABLE`,
`PRODUCTPLUS_UPLOADS_TABLE`, `PRODUCTPLUS_TEAMS_TABLE`, and
`PRODUCTPLUS_REGISTRATIONS_TABLE` are complete environment-specific table names.
Do not append `PROD` again when using them with custom SDK operations.

The shared `db.scan` wrapper appends `ENVIRONMENT` itself. Workflow 3 should pass
an unsuffixed base table constant to that wrapper, or use a full-name scan helper.
Use the same `PRODUCTPLUS_*` names across workflows.

The service manages CORS and temporary-file expiry on the existing private PRD
bucket. Permanent submitted PDFs are excluded from the temporary-file rule.

## Team deletion cleanup

The private `productplusCleanup` Lambda accepts replacement tasks:

```json
{ "internalTask": "retire_upload", "payload": { "event_key": "product+;2026", "prd_path": "productplus/temp/.../prd.pdf" } }
```

It also accepts canonical team-deletion tasks:

```json
{ "internalTask": "team_deleted", "payload": { "event_key": "product+;2026", "team_code": "012345" } }
```

The existing legacy Product Plus leave flow invokes this worker asynchronously
when its final member deletes the team. Its best-effort delivery and error
handling are unchanged in this alignment change. The worker verifies team
absence and removes the submission before retiring its PDFs. Repeated delivery
is safe.

Workflow 1's new leave endpoint still has its existing cleanup TODO. Connecting
that endpoint to a reliable cleanup mechanism remains outside this ticket.
No stream consumer, schedule, queue, or new deployment configuration is added.
