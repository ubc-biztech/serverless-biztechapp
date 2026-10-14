# Product Plus submissions

This service lets current team members upload a PDF, save one submission per team,
and view it after the submission deadline. Admins set submission and voting
deadlines. S3 Lifecycle removes temporary uploads; a private Lambda deletes
replaced PDFs and deleted teams' submissions/files.

The scope is about **150 users and 40 teams**. This service implements submissions,
uploads, deadline configuration, and cleanup. Judging, audience voting, frontend
work, and the new reusable team APIs belong to other workflows.

## Start here: the workflow in simple terms

There are two places where data lives:

- **DynamoDB stores records:** form answers, deadlines, membership references, and
  information about who owns each uploaded PDF.
- **S3 stores files:** the actual PDF bytes. A DynamoDB record points to the file
  using its `prd_path`.

Uploading and submitting are separate actions:

```text
Browser asks the API for upload permission
  → API returns a temporary S3 upload URL
  → browser sends the PDF directly to S3
  → browser sends the form and PDF key to the submission API
  → API checks the PDF, copies it to permanent storage, and saves the submission
  → API returns the saved form and a temporary viewing URL
```

For example, team `012345` uploads `first.pdf`. Until the team submits its form,
the PDF is only a temporary upload. After a successful submission, the submission
record points to a permanent copy. If the team later submits `second.pdf`, the
same submission row is updated and cleanup deletes the old permanent copy.

If the team uploads a file but never submits, S3 Lifecycle expires that temporary
file. Lifecycle does not delete the DynamoDB tracking record. A requested upload
URL with no uploaded bytes has no S3 file to delete.

### Terms used below

| Term                       | Simple meaning                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Handler                    | The function that receives an API request and returns an HTTP response                               |
| Helper                     | A function called by a handler to do validation, database work, or file work                         |
| `event` in a handler       | The incoming request, including its JSON body and authenticated caller                               |
| `event_key`                | The competition identifier, such as `productplus;2026`; separate from the request object             |
| S3 object key / `prd_path` | The file's name within the bucket, including its prefix                                              |
| Prefix                     | The beginning of an S3 key, such as `productplus/temp/`; it behaves like a folder name for filtering |
| Presigned URL              | Temporary permission to perform one operation on one S3 key                                          |
| Upload tracking            | A DynamoDB record connecting a generated file key to its owner and current status                    |
| Promotion                  | Copying a validated temporary PDF to its permanent key during submission                             |
| Transaction                | A group of database changes that all succeed or all fail together                                    |
| Conditional write          | A write allowed only if specified facts still match, such as current membership                      |
| Strongly consistent read   | A read of the latest committed item; it does not prevent later changes                               |
| Asynchronous cleanup       | The API asks a separate Lambda to clean up afterward; it does not wait for deletion                  |

The code uses conditions because another teammate can save, an admin can change a
deadline, or a member can leave while a request is running. Retries give a changed
request another attempt; the conditions themselves protect the data.

## Integration status — read this first

**Product Plus uses the existing registrations and teams tables.** It implements
`registration.teamID` and a six-digit `team.id`, with `memberIDs` stored as a
list. The team workflow still needs to implement these writes and connect its
deleted-team cleanup hook. Local tests verify this storage/task contract; they do
not prove that the unfinished team APIs or live AWS resources work together.

### Shared team schema

These are the fields Product Plus reads; the existing records may have other
fields owned by their respective services:

| Table, dev base name   | Partition key (String)    | Sort key (String) | Fields used for membership           |
| ---------------------- | ------------------------- | ----------------- | ------------------------------------ |
| `biztechRegistrations` | `id`: verified email      | `eventID;year`    | `teamID`: optional six-digit string  |
| `biztechTeams`         | `id`: six-digit team code | `eventID;year`    | `memberIDs`: list of verified emails |

The registration's `id` and values in `memberIDs` use the verified email provided
by shared authentication (`event.auth.email`). `memberIDs` is a DynamoDB List,
represented by a JavaScript `string[]`. There is no separate UserMemberships table.
This membership means belonging to an event team; it is separate from annual
BizTech membership in `MEMBERS_TABLE`.

The backend's current lookup is:

```text
verified email
  → Registrations: { id: email, "eventID;year": "productplus;2026" }
  → registration.teamID
  → Teams: { id: teamCode, "eventID;year": "productplus;2026" }
  → team.memberIDs includes email
```

The registration's `teamID` is the team code, and Teams stores it as `id`.
Product Plus uses those fields directly. An absent or empty registration code means no current
membership (403); a present but malformed code returns 409. A missing team or a
member list that excludes the caller also returns 403.

### Shared table settings

| Setting                           | dev AWS table name     | PROD AWS table name        |
| --------------------------------- | ---------------------- | -------------------------- |
| `PRODUCTPLUS_TEAMS_TABLE`         | `biztechTeams`         | `biztechTeamsPROD`         |
| `PRODUCTPLUS_REGISTRATIONS_TABLE` | `biztechRegistrations` | `biztechRegistrationsPROD` |

`provider.environment` in [serverless.yml](serverless.yml) uses the existing
base-name-plus-`ENVIRONMENT` convention (`""` for dev, `"PROD"` for prod). IAM
references the same settings. `storageSettings` requires the table names, event,
and bucket; the shared table names are configured rather than placeholders.
Admin config endpoints remain independent of team storage.

Membership lookup keys, save-time transaction checks, IAM references, and cleanup
use the schema above. Teams/registrations call the event key `eventID;year`;
Product Plus submissions and upload tracking call the same value `event_key`.
Their field names differ, but both identify the configured `productplus;2026`
event. Product Plus does not change submission/upload keys or S3 paths.

The agreed team identity for Product Plus ownership is **`(event_key, teamID)`**.
Codes must remain unique within the event even after a team is deleted and must
retain leading zeros. The team workflow must enforce that guarantee. No internal
`team_id` is stored. Without non-reuse, an old cleanup task could target a later
team using the same code after that later team is deleted.

The team workflow must atomically maintain `registration.teamID` and
`team.memberIDs`. Leaving clears the registration's code while preserving the
registration itself. Final-member departure deletes the team before invoking
cleanup. Product Plus reads both records and checks them inside upload, promotion,
and save transactions so a removed member cannot save through a stale session.
No annual BizTech membership or check-in-status requirement is added here.

## API contracts

All five HTTP routes use the existing Cognito authorizer and shared
[`protect`](../../lib/auth.ts). User routes require a verified account and current
team membership. Admin routes use the shared admin rules. The backend selects
`productplus;2026`; callers cannot supply an event key or team code in these bodies.
Request bodies use plain JSON (`Content-Type: application/json`), matching the
other services. PDF bytes are uploaded directly to S3.

`protect()` checks the login and adds `event.auth`. The handler passes the verified
email and JSON body to a helper. The helper returns data or throws an error; the
handler turns that into a success or error response. The shared admin check accepts
the Cognito `admin` group or a verified `@ubcbiztech.com` email.

### Shared submission response

```ts
type Submission = {
  teamID: string;
  team_name: string;
  project_title: string | null;
  member_names: string[];
  video_url: string;
  prd_path: string;
  prd_filename: string | null;
  prd_view_url: string;
  submitted_at: string;
  updated_at: string;
};
```

`prd_path` is an S3 object key, not a public link. Saved submissions use the
`productplus/submitted/` prefix. `prd_view_url` is a separate, five-minute signed
GET URL for inline PDF viewing; it is generated for the response and never stored.
Responses omit ownership metadata, upload status, rubrics, and voting fields.
The returned viewing URL expires; the saved PDF remains. Call GET again for a new
viewing URL. Upload and viewing URLs authorize different operations.

### `GET /productplus/submissions`

No body or query parameters. Returns `200`:

```ts
{
  submission: Submission | null;
  submission_deadline: string;
  can_edit: boolean;
}
```

Before the first save, `submission` is `null`. `can_edit` means server time is
strictly before the submission deadline. Current members can still view an
existing submission after the deadline. GET reads current storage and creates a
fresh viewing URL.

### `POST /productplus/submissions/upload`

Body:

```json
{ "content_type": "application/pdf", "prd_filename": "Product plan.pdf" }
```

The frontend sends the selected file's `file.name` as `prd_filename`. The name
is optional for older clients; when supplied, it must be a nonempty string. The
backend preserves it exactly, including Unicode and spaces, in upload tracking.
It is display information and never controls the object key or proves file type.

Returns `200`:

```ts
{
  upload_url: string;
  upload_method: "PUT";
  upload_headers: {
    "Content-Type": "application/pdf";
    "If-None-Match": "*";
  };
  prd_path: string; // Temporary object key.
}
```

The frontend sends the PDF bytes directly to `upload_url` with exactly the returned
method and required headers. Do not send the API's bearer token to S3. Every
request creates a unique upload ID and pending tracking record. The URL lasts up
to five minutes, capped at the submission deadline; a window shorter than one
second is rejected. The signed `If-None-Match` header prevents overwriting the key.
It means "upload only if this key has no file yet." After a successful PUT, a
second PUT to that same key is rejected; request a new URL for a replacement file.

The URL authorizes a PUT, not reading. There is no object until bytes are uploaded.
Expiry stops new authorized requests; it does not delete an existing file, and a
request started before expiry can finish afterward.
[AWS presigned URL behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

### `PUT /productplus/submissions`

Accepts only these fields:

```json
{
  "team_name": "Example team",
  "project_title": "Our product idea",
  "member_names": ["Member One", "Member Two"],
  "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "prd_path": "productplus/temp/productplus;2026/012345/UPLOAD_UUID/prd.pdf"
}
```

Returns `200 Submission` for creation and updates. The same team gets one row;
resubmission updates that row. For a new PDF, provide its pending temporary key.
For a form-only edit, provide the current submission's permanent key.
`project_title` is optional for compatibility: a supplied title must be a nonempty
string and is trimmed; omitting it preserves the current title. An older
submission without a title returns `project_title: null`.

Do not send `prd_filename` in this PUT body. The backend copies it from the chosen
upload record into the submission, and both PUT and GET return it. A form-only
edit preserves the current filename. Replacing a PDF updates its filename; a
replacement uploaded without filename metadata returns `prd_filename: null`
rather than retaining the previous file's label. The frontend can use `"PRD"`
when it receives null. Original filenames cannot be recovered from older keys.
**Retain the permanent `prd_path` returned after saving.** Reusing the old temporary
key after a successful save is rejected.

Validation:

- Names are trimmed and must be nonempty; `member_names` must be a nonempty array
  of nonempty strings. These are form fields, not the source of authorization.
- HTTPS YouTube links must use `youtube.com`, `www.youtube.com`, or `m.youtube.com`
  with `/watch?v=…`, `/shorts/…`, or `/embed/…`; `youtu.be/…` is also accepted.
  Video IDs must have eleven URL-safe characters. Other hosts, user credentials,
  nonstandard ports, duplicate `v` parameters, and non-video paths are rejected.
  Visibility and video duration are not checked.
- The tracked upload must belong to the current event/team and match its generated
  key. Already retired, claimed, deleted, or reserved uploads cannot be attached.
- S3 metadata must identify `application/pdf`, a size of **8–5,000,000 bytes**, and
  an initial `%PDF-n.n` header. The API reads just the first eight bytes. It uses
  S3's ETag value to check that the file being copied is the one it validated.
  These are basic PDF checks, not full PDF parsing or malware scanning.

The frontend should also check the five-MB limit before transfer. The backend
checks it when saving; the signed PUT itself does not enforce the size limit.

### Admin configuration

`GET /productplus/admin/config` takes no body and returns `200 Config`, or `404`
if initial configuration has not been saved.

`PUT /productplus/admin/config` creates or updates the same configuration row and
returns `200 Config`:

```json
{
  "submission_deadline": "2026-11-01T23:00:00Z",
  "voting_deadline": "2026-11-02T01:00:00Z"
}
```

Both fields are required. Timestamps must be valid UTC ISO strings ending in `Z`
or `+00:00`, with optional 1–3 fractional digits. Calendar dates and ordering are
validated; `voting_deadline` must be later. Valid input strings are stored without
normalizing them. There is no voting-enabled toggle. Voting itself is outside this
service's current endpoints.

For participants, config answers "is submitting still open?" Membership checks
answer "does this person belong to this team?" These are separate checks. Viewing
remains available after the submission deadline. The voting workflow will use
`submission_deadline` as voting's start time and `voting_deadline` as its end time.
UTC gives all users the same deadline instant; the frontend can display that
instant in each user's local time zone.

### Errors

| Status | Meaning                                                                              |
| ------ | ------------------------------------------------------------------------------------ |
| `400`  | Invalid JSON, unsupported fields, form/config validation, or invalid/unavailable PDF |
| `401`  | Shared authentication rejected a missing or unverified identity                      |
| `403`  | Missing current membership, closed submissions, or missing admin access              |
| `404`  | Admin GET before initial configuration                                               |
| `409`  | Concurrent changes, an upload already being submitted, or malformed team code        |
| `503`  | Participant request before deadline configuration exists                             |
| `500`  | Unexpected storage/runtime failure; the response does not expose SDK details         |

A save returning `500` may have committed before its network response was lost.
Refresh GET before deciding whether to retry. If the new PDF is not referenced and
its upload remains `promoting`, request a fresh upload; an operator can leave or
remove the unused copy later.

## Storage and save flow

| Environment | Submissions                | Upload tracking        | Private bucket        |
| ----------- | -------------------------- | ---------------------- | --------------------- |
| dev         | `biztechPPSubmissions`     | `biztechPPUploads`     | `biztech-pp-prd`      |
| prod        | `biztechPPSubmissionsPROD` | `biztechPPUploadsPROD` | `biztech-pp-prd-prod` |

The stage JSON files supply `ENVIRONMENT` (`""` or `"PROD"`) and the bucket name.
YAML supplies complete table names. Helpers do not append the suffix again.
The existing registrations and teams names use the same suffix convention.

| Table           | Partition key, String | Sort key, String |
| --------------- | --------------------- | ---------------- |
| Submissions     | `event_key`           | `teamID`         |
| Upload tracking | `prd_path`            | None             |

Tables and buckets remain manually owned. Product Plus needs no additional table
or index. The team workflow updates the existing shared tables described above.
Existing upload indexes may remain unused. Keep TTL disabled on upload tracking
so unfinished operations retain their ownership information. On-demand capacity
is suitable for this event's small volume.
TTL is DynamoDB's automatic row-deletion feature; keeping it off preserves these
records for troubleshooting. The uploads table records each upload attempt, while
the submissions table stores only the team's current saved form.

Configuration shares the submissions table under:

```json
{ "event_key": "productplus;2026", "teamID": "config" }
```

Submission records contain the form fields, `project_title`, `prd_filename`, timestamps,
`graded_submissions`, `upvotes`, `downvotes`, and optional `voter_ids`. The config
row is not a submission. Judging/audience queries must exclude it.

Upload tracking stores the original temporary key, generated upload ID,
`event_key`/`teamID` ownership, content type, optional `prd_filename`, timestamps,
URL expiry, and status. `project_title` belongs to the submission only.
Promotion adds `permanent_path` and a temporary `promotion_token`. The token prevents a
second request from using a copy that another request is still saving.
The token is an internal request identifier. It is removed after a successful
save and is never part of the frontend response.

```text
productplus/temp/{event_key}/{teamID}/{upload_id}/prd.pdf
productplus/submitted/{event_key}/{teamID}/{upload_id}/prd.pdf
```

S3 stores the file under `prd.pdf` regardless of its original browser filename.
The original `prd_filename` is stored in DynamoDB and returned for the frontend
label. It does not change the signed upload headers or the viewer's fixed
`Content-Disposition` filename. No DynamoDB columns need to be created manually;
the backend writes the new attributes on each applicable record.
"Permanent" means this prefix has no expiration rule owned by Product Plus. The
file can still be deleted when it is replaced or its team is deleted.

A new PDF follows this sequence:

1. Issue a signed PUT and atomically record the pending upload while checking
   membership and the unchanged submission deadline.
2. The browser uploads the PDF to its temporary key.
3. On submission, validate the form, ownership, and PDF, then conditionally reserve
   the upload as `promoting` with a token.
4. Copy the validated source to its permanent key using the source ETag.
5. Reread membership, configuration, and the current submission after copying.
6. In one transaction, save form fields, reference the new upload, and mark the
   previous upload `replaced`. Recheck membership, team code, deadline value, and
   the prior submission path. Check server time immediately before the write.
7. If a PDF was replaced, request asynchronous cleanup and await the invocation attempt.
   Return the permanent path and viewing URL without waiting for file deletion.

Known conditional conflicts allow **three total save attempts: the first attempt
plus up to two retries**, each with fresh reads. If another teammate saved first,
the next attempt uses their newly saved submission when deciding which PDF to
replace. Conditions also prevent a removed member from saving. Form-only updates
validate and retain the current permanent PDF without another S3 copy.

Updates preserve `submitted_at`, rubrics, vote counters, and voter IDs. Creation
initializes an empty rubric list and zero counters. No empty DynamoDB String Set
is written; the voting workflow can add the first `voter_ids` set atomically.
DynamoDB transactions cover database changes, not S3 copies.
[AWS transaction semantics](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)

| Upload status | Meaning                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `pending`     | URL issued; the file may or may not have been uploaded                                                          |
| `promoting`   | A request reserved the upload; copying/saving is in progress or was interrupted                                 |
| `referenced`  | A successful submission references the permanent file                                                           |
| `replaced`    | A newer submission replaced this PDF; eligible for cleanup                                                      |
| `deleting`    | Cleanup claimed the unreferenced file; saves must reject it                                                     |
| `deleted`     | Cleanup finished; tracking remains, and a replacement's original temp copy may still await Lifecycle expiration |

A definitively rejected copy source releases its reservation. An uncertain copy
or database failure leaves files/tracking intact for manual inspection. For
example, a timeout does not prove that a database save failed. Deleting the copied
PDF immediately could remove the file from a submission that actually saved.

## Expiration and cleanup

S3 Lifecycle expires only **`productplus/temp/`** after one day. UTC rounding and
asynchronous expiration mean this is not a guarantee of deletion within exactly
24 hours. Permanent submitted PDFs have no expiration rule. Original temporary
uploads remain after promotion and expire through Lifecycle.
[AWS Lifecycle timing](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)

Replacement cleanup directly deletes the old permanent PDF after the new save
commits. There is no extra copy to a retired folder. Before deletion, a transaction
claims the tracking record and verifies that no submission references its path.
Submission saves reject claimed uploads. Duplicate tasks and already-missing S3
objects are safe to retry; failed deletion retains retryable tracking.

The private `handler.cleanup` Lambda accepts two task shapes:

A task is a small JSON message telling the worker what to clean up. This worker
has no public URL. The backend calls it using AWS permissions. Replacement cleanup
is requested by `saveSubmission`; deleted-team cleanup requires a call from the
team workflow after it deletes the team.

```json
{
  "internalTask": "retire_upload",
  "payload": {
    "event_key": "productplus;2026",
    "prd_path": "ORIGINAL_TEMPORARY_UPLOAD_KEY"
  }
}
```

```json
{
  "internalTask": "team_deleted",
  "payload": {
    "event_key": "productplus;2026",
    "teamID": "012345"
  }
}
```

The task's upload key locates a tracking record. That record supplies the actual
file paths and ownership checks. A task cannot simply name an arbitrary file and
delete it.

For `team_deleted`, the worker first checks that the team really is gone. It
removes the matching submission **before listing/deleting files**, so the team
stops appearing in judging/voting even if file cleanup later fails. It then reads
that team's tracked uploads and deletes their permanent and temporary objects.
Large scans return pages; the loop keeps reading until no pages remain. Lifecycle
covers a temporary upload that finishes after cleanup.

The scan runs only on team deletion. Strong reads avoid an eventually consistent
index here; a scan is not a database-wide snapshot. Membership write conditions
prevent new upload records after team deletion. This base-table scan is acceptable
for the expected event volume.
[AWS Scan consistency and pagination](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html)

The worker leaves `promoting` files alone until an operator establishes that an
interrupted copy/save has finished. It continues other files and reports failure
for retry. Retaining an unused file is preferable to deleting an active copy.

Cleanup runs when a task arrives. It has **no HTTP route, schedule, SQS queue, or
failure destination**. Product Plus logs task identifiers and error names without
signed URLs. A failed cleanup request does not undo a successful submission.
The worker handles duplicate tasks safely because AWS can deliver an accepted
event more than once.
[AWS asynchronous delivery](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)

Leftover permanent files are acceptable for v1 and can be removed manually.
A stale submission from a deleted team still needs database cleanup so it does not
appear in judging/voting. Replay the team task if its database deletion failed.

### What gets retried

| Operation         | What happens after a failure                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Submission save   | Known write conflicts restart with fresh membership/config/submission reads, up to three total attempts; then return 409 |
| Cleanup delivery  | The Lambda SDK client allows two total attempts to send the task for retryable AWS errors; delivery failure is logged    |
| Cleanup execution | For function errors, AWS may run the accepted task twice more; completed files are skipped on later runs                 |

Invalid forms, invalid PDFs, missing membership, and closed submissions do not
start another save attempt. Unexpected save errors return a generic 500. A
successfully copied PDF is kept across save attempts rather than copied again.
GET, config updates, and upload URL creation have no custom retry loop. An upload
request whose transaction conditions changed returns 409.

AWS SDK clients can also retry some temporary service/network errors internally.
Those retries repeat an AWS request; our save loop rereads state and rebuilds the
save. Cleanup has a six-hour maximum event age, meaning AWS can discard a task
that becomes too old; it is not a six-hour polling job.
[AWS SDK retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html),
[AWS asynchronous retry behavior](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)

## Code guide and shared-library reuse

[handler.ts](handler.ts) follows [events](../events/handler.ts) and
[teams](../teams/handler.ts): authentication and HTTP responses stay in handlers;
plain helper functions contain business logic and AWS operations. There are no
service classes or extra middleware. Async invocation follows
[bots' `enqueueSlackTask`](../bots/handlerSlack.js).

### Suggested reading order

1. **Data shapes:** start with `Submission`, `Config`, `SubmissionRecord`, and
   `UploadRecord` in [types.ts](types.ts). Then read `TeamRecord` and
   `RegistrationRecord` for the shared storage contract. Notice which fields
   are public.
2. **Handler structure:** read `getSubmission` and the shared `protect()` wrapper.
   Follow authentication → helper call → HTTP response/error.
3. **Configuration:** follow `putConfig` → `parseConfigBody` → `configResponse` →
   `saveConfig`, then `getConfig` → `getConfigRecord` → `configLocation`.
4. **Membership:** read `storageSettings` and `currentTeam`. Follow the email,
   registration lookup, six-digit `teamID`, and Teams `memberIDs` list.
5. **Viewing:** follow `getSubmission` → `loadSubmission` → `submissionContext`,
   then inspect `readSubmission` and `submissionResponse`.
6. **Upload permission:** follow `createUpload` → `createPrdUpload`, reading
   `validateUploadBody`, `membershipChecks`, and `deadlineCheck` along the way.
7. **Validation and file keys:** read `parseSubmissionBody`, `supportedVideo`,
   `validatePdf`, `ownedUpload`, and the three path helpers below.
8. **PDF copying:** read `promoteUpload`, `uploadCondition`, and `noReference`.
   Follow how one request reserves its upload and copies it safely.
9. **Saving:** follow `putSubmission` → `saveSubmission`, then `submissionWrite`
   and `transactionConflict`. These combine the earlier pieces.
10. **Cleanup:** read `CleanupTask`, `enqueueCleanup`, `cleanupProductPlus`, and
    `cleanUpload`; then `absentTeam` and `teamUploads` for deleted teams.

Inside a transaction, `ConditionCheck` means "verify this fact before saving."
`UpdateExpression` describes the fields being changed. Names beginning with `#`
are field aliases, and names beginning with `:` are values supplied separately.
For example, `#deadline = :deadline` checks that the stored deadline still equals
the deadline this request read.

| Handler export  | Purpose                                                            |
| --------------- | ------------------------------------------------------------------ |
| `getSubmission` | Authenticate a member and return the current submission/deadline   |
| `createUpload`  | Authenticate a member and issue signed upload details              |
| `putSubmission` | Authenticate a member, validate/save the form, return `Submission` |
| `getConfig`     | Authenticate an admin and return configuration or 404              |
| `putConfig`     | Authenticate an admin, validate and save deadlines                 |
| `cleanup`       | Private IAM-authorized entrypoint for cleanup tasks                |

[helpers.ts](helpers.ts) functions are grouped below by responsibility. The checks
around writes and deletion are intentional even at small scale: two teammates can
save simultaneously, or a member can leave during an upload.

| Helpers                                           | Purpose                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `configResponse`, `parseConfigBody`               | Read the config body, check both timestamps/order, and return only the two deadline fields                     |
| `configLocation`, `getConfigRecord`, `saveConfig` | Find the config row, read its latest values, and save deadlines                                                |
| `storageSettings`                                 | Read required event, table, and bucket environment settings                                                    |
| `currentTeam`                                     | Read the event registration for the verified email, obtain `teamID`, and verify the Teams `memberIDs` list     |
| `membershipChecks`, `deadlineCheck`               | Require that membership and the deadline still match when a transaction writes                                 |
| `readSubmission`, `readUpload`                    | Load the latest saved submission or upload record using `getOneCustom`                                         |
| `permanentPath`, `storedPath`, `submissionUpload` | Build the permanent key, choose the existing file key, and find tracking from a saved PDF path                 |
| `ownedUpload`                                     | Check that the upload and its generated key belong to the current event/team                                   |
| `transactionConflict`, `uploadCondition`          | Decide which conflicts can be retried and prevent changes based on an outdated upload record                   |
| `validateUploadBody`, `createPrdUpload`           | Accept PDF content type and optional original filename, sign a unique PUT, and write pending tracking          |
| `submissionContext`, `loadSubmission`             | Gather the caller's team, config, and submission; build the member GET response                                |
| `submissionResponse`                              | Return public fields, title/filename (null when absent), and a temporary PDF viewing URL; judging can reuse it |
| `supportedVideo`, `parseSubmissionBody`           | Validate supported YouTube URLs, the form fields, and optional project title                                   |
| `validatePdf`                                     | Check S3 existence, content type, byte count, ETag, and exact PDF header bytes                                 |
| `requireOpen`, `submissionWrite`                  | Check server time and build the submission update while keeping existing judging/voting fields                 |
| `promoteUpload`, `saveSubmission`                 | Reserve/copy a new PDF, recheck access/deadlines, and save the form and tracking together                      |
| `enqueueCleanup`                                  | Send a cleanup task; log delivery failure while keeping the successful save                                    |
| `noReference`, `absentTeam`                       | Build conditions protecting referenced files and teams that still exist                                        |
| `missingObject`, `errorName`                      | Recognize missing S3 objects and extract safe error names for logs                                             |
| `cleanUpload`                                     | Claim, delete, and mark one tracked file; handle duplicate/retried tasks                                       |
| `teamUploads`, `cleanupProductPlus`               | Read all pages of a team's uploads and handle replacement/deleted-team tasks                                   |
| `ConfigValidationError`, `ProductPlusError`       | Distinguish expected client errors from generic server failures                                                |

[types.ts](types.ts) separates public API contracts from internal database records,
upload statuses, and the two private cleanup tasks. `Rubric` matches the shared
judging schema; judging must validate the five score ranges. Internal fields are
not automatically serialized into public responses.

Reuse decisions after reviewing `lib/` and `constants/`:

- Reuse [`lib/auth.ts`](../../lib/auth.ts),
  [`lib/responseHelpers.ts`](../../lib/responseHelpers.ts), and
  [`lib/docClient.js`](../../lib/docClient.js). Shared auth exposes verified email
  and admin status, not Cognito `sub`. Unexpected failures use generic responses
  rather than `response.error`, which includes the raw error in its payload.
- Use [`lib/db.js`](../../lib/db.js)'s `getOneCustom` for individual reads. It
  accepts our actual key names, complete table names, and `ConsistentRead: true`,
  and returns the item or `null`. Internal submission/upload helpers continue to
  return `undefined` for missing records. Read failures still reach the handlers'
  generic error responses; the shared wrapper logs the original database error.
  Team/registration reads also use `getOneCustom` with the keys above.
  Although `getOne` now matches their `id` keys, it does not expose
  `ConsistentRead: true` and appends an environment suffix itself.
  `getOneCustom` preserves strong reads and avoids appending the suffix twice.
  Writes and scans use SDK commands through the shared document client. Other
  wrappers append the environment suffix, and `writeMultiple` rewrites SDK errors,
  losing the transaction reasons needed by our retries. The query helper does not
  paginate. Keeping these operations direct preserves their existing behavior.
- [`checkPayloadProps`](../../lib/handlerHelpers.ts) checks broad JavaScript types
  and reports 406. It does not replace trimmed-name, unknown-field, PDF, URL, or UTC
  validation required here. [`lib/utils.js`](../../lib/utils.js) has no matching
  validator for these contracts.
- [`constants/tables.js`](../../constants/tables.js) agrees with the submissions
  and uploads base names, as well as `TEAMS_TABLE` (`biztechTeams`) and
  `USER_REGISTRATIONS_TABLE` (`biztechRegistrations`). YAML follows the repository's
  name-plus-`ENVIRONMENT` convention. `MEMBERS_TABLE` is the annual membership
  table and is not needed here. Existing batch/OpenSearch constants do not apply.
- Reuse a compatible shared team membership helper after its workflow merges.
  The `resolveTeamMembership` found on
  `origin/product-plus/workflow-1-endpoints` currently resolves
  `registration.teamID`, matching the current field name. Its reads use
  `getOne` without strong consistency, so it cannot directly replace our strong
  reads. `currentTeam` implements this contract locally; reuse the shared helper when compatible and available. The submission
  write still needs transaction conditions checking current membership.

### `serverless.yml` headings

| Heading/resource                                                            | Responsibility                                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `service`, `org`, `app`, `frameworkVersion`                                 | Serverless identity and framework version                                        |
| `build`, `plugins`, `custom`                                                | Existing bundling, local development, and custom-domain conventions              |
| `provider`                                                                  | Runtime, region/stage, environment variables, shared API Gateway, and scoped IAM |
| `functions`                                                                 | Five authenticated HTTP handlers and the private event-driven cleanup Lambda     |
| `resources.Conditions`                                                      | Choose production or development S3 CORS origins                                 |
| `ProductPlusCorsLogGroup`, `ProductPlusCorsRole`, `ProductPlusCorsFunction` | Deployment-only helper and permissions for configuring the manually owned bucket |
| `ProductPlusBucketCors`                                                     | Custom resource declaring CORS and the temporary-file Lifecycle rule             |

The bucket helper is needed because CloudFormation does not own the bucket.
It applies configuration during deployment, not every minute. It replaces the
bucket's CORS rules and merges the owned Lifecycle rule by ID, preserving unrelated
Lifecycle rules. Inspect any existing CORS requirements before deploying.
Lifecycle configuration updates replace the full rule set, which is why the helper
reads and merges it first.
[AWS Lifecycle configuration API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutBucketLifecycleConfiguration.html)

CORS allows `https://app.ubcbiztech.com` in prod and
`https://dev.app.ubcbiztech.com` plus `http://localhost:3000` in dev. Confirm the
frontend's local port. CORS does not make the bucket public. Stack deletion retains
the external bucket, its files, and its CORS/Lifecycle configuration. The helper
does not alter bucket public-access or versioning settings.

CORS tells a browser which website origins can call S3. IAM is AWS's permission
system and controls which tables/files/Lambdas this backend may access. Allowing
an origin through CORS does not give it permission to read private files; it still
needs the appropriate signed URL.

The bucket helper's S3 client allows two total SDK attempts. It also tries up to
three times to send its result back to CloudFormation, AWS's stack deployment
service. These happen during deployment, not during attendee submissions.

Application object permissions are scoped to `productplus/*` in the selected
bucket. `s3:ListBucket` also permits missing-object HEAD requests to return 404
instead of 403, so missing PDFs can be reported correctly.
[AWS HEAD permissions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)

## Remaining integration checklist

Complete these with the other workflow owners before calling the feature fully
integrated:

- [x] Configure dev/PROD registrations and teams table names, composite keys,
      `memberIDs` lists, save-time transaction checks, ownership, cleanup, and IAM.
      Submission/upload records retain their existing schema without `team_id`.
- [ ] Implement the team workflow's atomic writes: set/clear
      `registration.teamID` and update the team's `memberIDs` list together.
      Use the six-digit code as `team.id`; final-member departure deletes that team.
      Product Plus uses `registration.teamID`; no additional membership table is needed.
- [ ] Reuse a compatible shared membership helper after it merges. This is a
      follow-up refactor, not a requirement to run the existing implementation.
      Keep membership conditions inside upload/promotion/save transactions.
- [ ] Have team provisioning enforce a six-digit string that is immutable and
      never reused within its event, including after deletion. Checking only existing
      team rows does not enforce non-reuse after deletion.
- [ ] Wire final-member deletion in the **new** team workflow to Product Plus
      cleanup using the implemented payload `{ event_key, teamID }`. Invoke only
      after the team deletion commits, and only for Product Plus. Give that workflow
      IAM permission to invoke this environment's cleanup function.
      Other events must not require Product Plus tables/files. The old teams-service
      hook currently present in the repository is not this integration and should be
      retired/coordinated by that workflow's owner.
- [ ] Judging and voting must use this event's submissions/config row, exclude
      `teamID: "config"`, and preserve form fields in their atomic writes. Judge
      detail can use `submissionResponse(record)` and explicitly add rubrics/counters.
      Audience responses must select their own allowed fields and never include PRDs,
      rubrics, voter IDs, or counts. Voting opens at `submission_deadline` and closes
      at `voting_deadline`; there is no toggle. Those endpoints are not implemented here.
- [ ] Connect the frontend upload → direct S3 PUT → submission PUT sequence.
      Send `file.name` as `prd_filename` when requesting upload permission and enable
      `project_title` in the submission form. Use the returned filename for the PDF
      label (fall back to `"PRD"` when null). Retain permanent paths, refresh viewing
      URLs with GET, and use GET to
      reconcile an uncertain save. Team/member names may be prefilled from the team
      response, but remain submitted form fields. Server deadlines are authoritative.
- [ ] Confirm browser requests use bearer authorization without cross-origin
      cookies. The shared response helper uses wildcard CORS; cookie credentials would
      need a coordinated shared change outside this service.
- [ ] Add integration coverage against the finished team workflow, then run dev
      smoke tests for upload/save/view/replace, member removal, last-member deletion,
      and judging/voting visibility. Current tests mock AWS and exercise the new
      schema. The teams contract tests seed completed team-workflow writes before
      calling the real Product Plus handlers; they do not exercise unfinished team
      APIs or prove that the future deletion hook is connected.

At implementation time, no real submissions or PDFs existed, as confirmed by the
workflow owner. The code therefore has no legacy-path migration or one-time
cleanup task. The latest storage state must be checked separately before deployment.

## Deployment prerequisites and manual recovery

Before a separate deployment:

1. Verify the existing registrations/teams schema, complete atomic team-code
   writes, and connect deleted-team cleanup in the team workflow. Shared-helper
   reuse can follow separately once a compatible helper is available.
2. Verify the table keys, correct environment names, and no upload-tracking TTL.
3. Verify both private buckets in `us-west-2`, Block Public Access enabled, and
   **versioning disabled**. Ensure no other Lifecycle rule expires submitted PDFs.
   This implementation assumes ordinary S3 encryption; a customer-managed KMS key
   would need corresponding permissions.
4. Use `NODE_ENV=production` for deployed AWS Lambdas, including the dev stage.
   The shared document client points to local DynamoDB when it is `development`.
   `ENVIRONMENT` separately selects the dev/PROD resources.
5. Deploy Product Plus before activating the new team workflow's cleanup hook.
   Save initial deadlines through the admin endpoint. Verify actual IAM,
   CORS/Lifecycle, authorizer behavior, and browser calls in dev before prod.

For a failed cleanup invocation, copy the logged `task` to
`/tmp/productplus-cleanup-task.json`, or reconstruct it from retained tracking.
The following is an **operator command**, not part of local verification:

```sh
aws lambda invoke --region us-west-2 \
  --function-name biztechApi-productplus-dev-productplusCleanup \
  --invocation-type Event --cli-binary-format raw-in-base64-out \
  --payload fileb:///tmp/productplus-cleanup-task.json \
  /tmp/productplus-cleanup-acceptance.json
```

Use the prod function for production. A 202 acknowledges delivery acceptance,
not successful deletion. Check CloudWatch completion/failure logs and tracking.
There is no failure queue. A crash before delivery or exhausted retries can leave
files for manual cleanup; replay is optional for unused files, but required if a
deleted team's submission remains visible.

For an interrupted `promoting` record:

1. Inspect its token, logs, temporary/permanent paths, and a strongly read current
   submission. Wait until the originating copy/save has finished before acting.
2. If the submission references the permanent file, preserve it. If the outcome
   remains uncertain, leave both the record and file alone.
3. For a confirmed finished, unreferenced operation, an operator may leave the file
   in place. To use the cleanup worker, conditionally change the same `promoting`
   record/token to `replaced` only after verifying no current reference, then
   invoke `retire_upload` (or retry `team_deleted` for an absent team). The worker
   checks the reference again before deletion. Do not reset it to `pending` or
   discard ownership tracking.

## Verification and reviewer handoff

The title/filename and `teamID` update on **2026-10-13** ran the updated suites: **109 tests
passed: 103 Product Plus and 6 teams contract/regression tests**, zero failures or
cancellations.
The Product Plus suite includes YAML and executable bucket-helper checks. Commands
for TypeScript, bundling, and whitespace checks are below.
Targeted TypeScript checks, both in-memory service bundles, YAML/documentation
validation, and whitespace checks passed. Documentation validation checked 17
local links and six JSON examples. No live AWS resources were accessed.
The teams tests verify the registrations/teams storage/task contract and preserve one
unrelated old-event regression. They do not exercise the future reusable team APIs.

From the repository root:

```sh
npm test --workspace=biztechapi-productplus --workspace=biztechapi-teams

./node_modules/.bin/tsc --noEmit --allowJs --checkJs false --strict \
  --target ES2020 --module CommonJS --esModuleInterop --resolveJsonModule \
  --skipLibCheck services/productplus/handler.ts services/teams/handler.ts

git diff --check
```

Bundle without writing artifacts or resolving live AWS configuration:

```sh
node --input-type=module <<'JS'
import { build } from 'esbuild';
for (const service of ['productplus', 'teams']) {
  const result = await build({
    entryPoints: [`services/${service}/handler.ts`], bundle: true,
    platform: 'node', target: 'node22', format: 'cjs', write: false,
    logLevel: 'silent'
  });
  console.log(`${service}: bundled ${result.outputFiles[0].contents.length} bytes`);
}
JS
```

Tests follow the real-handler/esbuild pattern in
[events' feedback tests](../events/test/publicFeedback.test.mjs). AWS boundaries
are mocked; the actual URL signer uses test credentials. The fixture checks
transaction conditions and applies mocked writes atomically. Coverage includes:

- Authentication, event-scoped verified-email membership, membership removal or
  team changes, `memberIDs` lists, configuration and deadline changes, strict
  request validation, YouTube URLs, and PDF ownership/type/size/header checks.
- Project-title validation and updates, original filename persistence through
  upload/save/reload, replacement labels, legacy records, and omitted-title races.
- Promotion, form-only edits after temporary expiration, simultaneous saves,
  preserved rubrics/votes/timestamps, uncertain writes, and safe leftover files.
- Active-file protection, cleanup/save races, missing objects, deletion failures,
  duplicate tasks, deleted teams, pagination, and dev/PROD isolation.
- YAML parsing, private unscheduled cleanup, absence of SQS, scoped Lifecycle,
  existing stage-selected tables and IAM, executable bucket-helper merging/failure
  handling, the team-workflow storage/task contract, and other-event behavior.

These checks do not deploy services or verify live AWS IAM, actual Lifecycle
execution, or the future teams/judging/voting implementations. Production changes
are scoped to Product Plus. The only outside change is the authorized replacement
of obsolete integration tests in `services/teams/test/productplus.test.mjs`.
