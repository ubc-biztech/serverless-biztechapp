# Product Plus storage

This service owns submissions, PRD upload tracking, and event configuration.
Team and membership tables are owned by the shared team workflow. The admin
config endpoints are implemented; submission and upload handlers remain scaffolded.

## Table names

Create and manage the two DynamoDB tables in the AWS console. `serverless.yml`
only supplies their names to Lambda; it does not create tables or indexes.

| Environment variable | Physical table name |
| --- | --- |
| `PRODUCTPLUS_SUBMISSIONS_TABLE` | `biztechPPSubmissions${ENVIRONMENT}` |
| `PRODUCTPLUS_UPLOADS_TABLE` | `biztechPPUploads${ENVIRONMENT}` |
| `PRODUCTPLUS_TEAMS_TABLE` | `biztechTeams${ENVIRONMENT}` (shared) |
| `PRODUCTPLUS_REGISTRATIONS_TABLE` | `biztechRegistrations${ENVIRONMENT}` (shared) |

Table names follow the repo's `ENVIRONMENT` suffix convention: dev uses an empty
suffix, and production uses `PROD`. The current staging config also has an empty
suffix, so staging shares the regular tables.

Use the full names injected into the Lambda environment. Do not append
`ENVIRONMENT` again to those resolved names. The generic `db.getOne` / `db.put` /
`db.writeMultiple` helpers append the suffix themselves and assume legacy keys.
Use the shared document client directly, or custom helpers that accept complete
table names and arbitrary keys.

| Environment | Submissions table | Uploads table |
| --- | --- | --- |
| Regular (dev) | `biztechPPSubmissions` | `biztechPPUploads` |
| PROD | `biztechPPSubmissionsPROD` | `biztechPPUploadsPROD` |

Other workflows should use these same physical names or their own table-name
environment variables. There are no CloudFormation table exports.

## Create the development tables in the AWS console

Sign into the project's AWS account and open the
[DynamoDB console](https://console.aws.amazon.com/dynamodb/). In the top-right
region selector, choose **US West (Oregon)** (`us-west-2`).

### Submissions and config table

1. In the left navigation, click **Tables**.
2. Click **Create table**.
3. Enter **Table name**: `biztechPPSubmissions`.
4. Enter **Partition key**: `event_key`; select **String**.
5. Enter **Sort key**: `team_code`; select **String**.
6. Under **Table settings**, select **Customize settings**.
7. Under **Table class**, select **DynamoDB Standard**.
8. Under **Read/write capacity settings**, select **On-demand** for capacity mode.
9. Leave the other settings at their defaults and click **Create table**.
10. Wait until the table's status is **Active**.

This table needs no secondary indexes. Configuration will be an item with
`team_code` set to `"config"`, not a separate table. The admin config PUT endpoint
creates this row on its first successful save.

### PRD upload tracking table

1. Click **Tables**, then **Create table**.
2. Enter **Table name**: `biztechPPUploads`.
3. Enter **Partition key**: `prd_path`; select **String**.
4. Leave **Sort key** empty.
5. Select **Customize settings**.
6. Select **DynamoDB Standard** and **On-demand** capacity mode.
7. Leave the other settings at their defaults and click **Create table**.
8. Wait until the table's status is **Active**.
9. Click the table name and open the **Indexes** tab.
10. Under **Global secondary indexes**, click **Create index**.
11. Enter **Partition key**: `event_key`; select **String**.
12. Enter **Sort key**: `team_code`; select **String**.
13. Set **Index name** to `team-uploads-query`.
14. Under **Attribute projections**, select **All**.
15. Keep the inherited on-demand capacity settings and click **Create index**.
16. Wait until this index is **Active** before creating the next one.
17. In the **Indexes** tab, click **Create index** again.
18. Enter **Partition key**: `status`; select **String**.
19. Enter **Sort key**: `cleanup_after`; select **String**.
20. Set **Index name** to `upload-cleanup-query`.
21. Under **Attribute projections**, select **All**.
22. Keep the inherited on-demand capacity settings and click **Create index**.
23. Wait until both indexes are **Active**.

Leave TTL disabled on both tables. Other attributes, such as deadlines, member
names, upload status, and timestamps, are added when items are written; they do
not need to be declared when creating a DynamoDB table. Leave the tables empty
for now. Lambda IAM permissions are a separate implementation step.

For production, repeat with `biztechPPSubmissionsPROD` and
`biztechPPUploadsPROD`. Keep index names unchanged. These names match
the `ENVIRONMENT`-based configuration in `serverless.yml`.

References: [AWS table creation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/getting-started-step-1.html),
[custom table settings](https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/access-query-and-join-amazon-dynamodb-tables-using-athena.html),
[console index creation](https://docs.aws.amazon.com/lambda/latest/dg/scheduled-task-app.html).

## Submissions and config

The submissions table has partition key `event_key` and sort key `team_code`.
`event_key` is `eventid;year`. Team codes are six-digit strings, preserving
leading zeros. Each team has at most one submission per event.

`SubmissionRecord` in `types.ts` contains the form fields and timestamps, plus
the shared `graded_submissions`, `upvotes`, `downvotes`, and optional `voter_ids`
attributes. Initialize the rubric list to `[]` and vote counters to zero on
creation. Omit `voter_ids` before the first vote: DynamoDB disallows empty sets.
Submission saves must preserve judging and voting attributes and `submitted_at`.
The internal `version` counter supports conditional concurrent writes without
retaining form history. `prd_view_url` is never stored.

The config row uses the same event key and the reserved sort key `"config"`.
Exclude that row when listing submissions. `ConfigRecord` stores both deadlines,
an internal `version`, and `updated_at`. The public `Config` type contains only
the two deadlines. The voting window is `submission_deadline <= now < voting_deadline`.

## Admin config endpoints

Both endpoints use the existing `protect(Access.ADMIN, ...)` authentication.
They resolve the full submissions table name and event key from the Lambda
environment, with no request-supplied event or team identifiers.

- `GET /productplus/admin/config`: reads the config row consistently and returns
  `200 Config`, or `404` if no config has been saved.
- `PUT /productplus/admin/config`: creates or updates the config row and returns
  `200 Config`. Both deadline fields are required; unknown fields are rejected.

Example PUT body:

```json
{
  "submission_deadline": "2026-11-01T20:00:00Z",
  "voting_deadline": "2026-11-02T20:00:00Z"
}
```

These example dates are illustrative, not preconfigured event deadlines. UTC
timestamps require a full date and time through seconds, ending in `Z` or
`+00:00`; one to three fractional-second digits are optional. Impossible calendar
dates, non-UTC offsets, and voting deadlines at or before the
submission deadline return `400`. Deadline strings are saved and returned exactly
as supplied, without timestamp normalization. Compare deadlines using
`Date.parse(...)` rather than string ordering.

PUT performs one atomic `UpdateItem`, updates `updated_at`, and increments the
internal `version`, starting at 1. It preserves unrelated stored attributes and
returns only the two public deadline fields. Config is not cached. Authentication
failures return `401`, authenticated non-admin callers receive `403`, and storage
or deployment-configuration failures return a generic `500`.

Run the endpoint tests from the repo root:

```sh
npm test --workspace biztechapi-productplus
```

The tests exercise the real bundled handlers with a mocked DynamoDB client;
they do not access live AWS resources.

## Upload tracking

The upload table has partition key `prd_path`, the exact S3 object key:

```text
productplus/{event_key}/{team_code}/{upload_id}/prd.pdf
```

Each `UploadRecord` includes ownership, a unique upload ID, content type,
timestamps, URL expiry, and cleanup status. All dates use canonical UTC ISO
8601 strings with consistent precision, such as `2026-10-04T12:00:00.000Z`.

| Status | Meaning |
| --- | --- |
| `pending` | Upload URL issued; no submission references this file yet. |
| `referenced` | The current submission references this file. |
| `replaced` | A successful save replaced this file with another upload. |
| `deleting` | Cleanup has claimed the file; saves must reject this upload. |
| `deleted` | S3 deletion completed; retain the tracking record for reconciliation. |

The `team-uploads-query` index uses `event_key` and `team_code` to find all files
owned by a team, including abandoned uploads. The `upload-cleanup-query` index
uses `status` and `cleanup_after` to find due pending/replaced uploads and retry
deleting uploads. Referenced and deleted records omit `cleanup_after` and do not
appear in that index.

Keep automatic TTL deletion disabled. Cleanup must keep tracking records
until S3 deletion is confirmed. Index results identify candidates only: future
cleanup must check current references and conditionally claim each upload before
deleting it, because secondary index results can be stale.

Submission updates and upload reference changes must be one transaction. When
the path stays the same, keep its upload referenced. When it changes, mark the
previous upload replaced and give it a cleanup time after its upload URL expires.
For pending uploads, cleanup must also respect the abandoned-upload grace period.

## Confirmed Product Plus settings

`PRODUCTPLUS_EVENT_KEY` is `productplus;2026`. The PDF size limit is 5 MB
(5,000,000 bytes), configured with `PRODUCTPLUS_MAX_PRD_BYTES`. The future
frontend must check the selected file size, and the save handler must check the
actual S3 object size before accepting it. These environment variables are
configuration only; the scaffold does not enforce the limit yet.

`PRODUCTPLUS_UPLOAD_GRACE_SECONDS` is 120. Pending uploads become eligible for
cleanup two minutes after their upload URL expires; active referenced PDFs never
expire through this policy. The scheduled worker removes eligible objects on its
next run, so this is an eligibility threshold rather than an exact deletion time.

The current repo identifies users by verified email via `event.auth.email`.
`MEMBERS_TABLE` (`biztechMembers2027`) contains annual membership/profile data.
Existing team resolution uses `USER_REGISTRATIONS_TABLE` (`biztechRegistrations`),
keyed by `id` (email) and `eventID;year`, to read `teamID`. It then reads
`TEAMS_TABLE` (`biztechTeams`) by `id` and `eventID;year`; `memberIDs` contains
the team's user emails. This membership schema will stay unchanged. The new event
endpoints will provide six-digit `team_code` values. Confirm whether a new team's
code will be its `biztechTeams.id` (and the registration's `teamID`), or whether
the code is separate from that ID and needs a persisted mapping. Product Plus
must resolve it on the backend rather than trusting a caller-provided team code.

Product Plus now has read and transaction condition-check permissions for the
shared registrations and teams tables. A submission transaction must check that
the registration still points to the resolved team and the team's `memberIDs`
still includes the caller. It must not modify shared membership records.

PRD uploads, table writes, the cleanup worker, and team membership changes are
separate implementation steps.

## Step 5: S3 browser CORS

The CORS rules are declared directly in `serverless.yml` under
`resources.Resources.ProductPlusBucketCors.Properties.CorsRules`. Deployment
applies them to the existing stage-selected bucket: `biztech-pp-prd` for dev and
`biztech-pp-prd-prod` for prod. No console paste or separate JSON file is needed.
The HTTP routes' `cors: true` configures API Gateway, not S3.

Because these buckets were created manually, a CloudFormation custom resource
uses a small setup Lambda to call `PutBucketCors`. The stack owns that Lambda,
its restricted IAM role, and its log group. It does not create or own the bucket.
The setup role can change CORS only on the selected bucket. Application handlers
do not receive bucket-configuration permissions.

The origins follow the existing profiles service: localhost port 3000 and
`https://dev.app.ubcbiztech.com` for dev, and `https://app.ubcbiztech.com` for prod.
If the Product Plus frontend uses another origin, update `AllowedOrigins` in the
YAML before deployment. An origin is the scheme, hostname, and optional port,
with no path. `ProductPlusIsProduction` selects the appropriate origin list.

Creation and CORS rule updates replace the bucket's entire CORS configuration
with these rules. Failed S3 operations report a failed deployment to CloudFormation.
Deleting the stack leaves the external bucket, PDFs, and last CORS rules intact.

| Setting | Purpose |
| --- | --- |
| `AllowedOrigins` | Frontend origins that browsers may use for S3 requests. |
| `AllowedMethods` | `PUT` uploads; `GET` reads PDFs; `HEAD` reads metadata. |
| `AllowedHeaders` | Permit PDF content type, conditional upload headers, range requests, and AWS headers. |
| `If-None-Match` | Allows the future signed upload to require `*`, rejecting an existing object key. CORS alone does not enforce this condition. |
| `ExposeHeaders` | Allows browser JavaScript to read the returned `ETag`. |
| `MaxAgeSeconds` | Cache successful preflight checks for 300 seconds. |

Do not add `OPTIONS` to `AllowedMethods`; S3 handles preflight requests itself.
CORS does not grant S3 permissions. Keep Block Public Access enabled and ACLs
disabled; the browser will use signed URLs generated by the authenticated backend.

References: [CloudFormation custom resources](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-custom-resources.html),
[PutBucketCors](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutBucketCors.html),
[CORS fields](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html).

## Step 6: Lambda IAM

`serverless.yml` now declares `provider.iamRoleStatements`, following the existing
services. Serverless adds these permissions to the service's Lambda execution role
at deployment. They do not create any buckets or tables. All five handlers share
the role; Cognito and handler logic still enforce user, admin, and team access.

| YAML element or permission | Purpose |
| --- | --- |
| `Effect: Allow` | Grants the listed operations on the listed resources. |
| `Action` | AWS operations permitted for the Lambda role. |
| `Resource` | Limits those operations to particular bucket paths, tables, or indexes. |
| `s3:PutObject` | Issue usable signed PUT URLs to upload PDFs. |
| `s3:GetObject` | Validate uploaded PDF data/metadata and issue signed viewing URLs. `HeadObject` uses this permission too. |
| `s3:DeleteObject` | Remove replaced, abandoned, and deleted-team PDFs during cleanup. |
| `dynamodb:GetItem` | Read submission, config, and upload records. |
| `dynamodb:PutItem` | Create records. |
| `dynamodb:UpdateItem` | Update form fields, config, and upload state. |
| `dynamodb:DeleteItem` | Remove records during cleanup or team deletion. |
| `dynamodb:ConditionCheckItem` | Check record state within a transaction. |
| `dynamodb:Query` | Query event/team records and the upload lookup/cleanup indexes. |

The S3 ARN ends with `/productplus/*`, restricting access to that object prefix
inside the stage-selected bucket. DynamoDB ARNs use `us-west-2` and account
`432714361962`, matching the repo's registrations ARN convention, with table names
selected by the `ENVIRONMENT` suffix. Only the two declared upload
indexes receive index query permissions. The config row uses the submissions table.
DynamoDB transactions use the underlying item permissions rather than an IAM
action named `dynamodb:TransactWriteItems`.

Shared team/membership table reads and transaction checks are permitted on
`biztechRegistrations${ENVIRONMENT}` and `biztechTeams${ENVIRONMENT}`. Step 7
will implement these checks once the team-code mapping is established. Product
Plus has no write permissions on those shared tables.

These YAML changes take effect on the next Product Plus deployment. They have
only been checked locally; bucket CORS and deployed IAM must be checked in AWS
when deployment and the actual upload/save handlers are ready.

References: [Serverless IAM](https://www.serverless.com/framework/docs/providers/aws/guide/iam),
[S3 HeadObject permissions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html),
[DynamoDB transaction IAM](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html).

## Reading serverless.yml

| Heading | Meaning in this service |
| --- | --- |
| `service` | Name of the deployable Product Plus service and basis for AWS resource names. |
| `org` / `app` | Serverless Framework organization and application grouping. These are not AWS account IDs. |
| `frameworkVersion` | Compatible Serverless Framework versions (`^4.0.0` means version 4). |
| `build.esbuild: false` | Disable Framework's built-in builder because the repo uses the `serverless-esbuild` plugin. |
| `plugins` | Framework extensions: local DynamoDB, local API/Lambda emulation, custom-domain management, TypeScript bundling, and the repo's Mocha integration. |
| `provider` | AWS deployment defaults for the application Lambdas. |
| `provider.name` | Cloud provider: AWS. |
| `provider.stage` | Deployment environment from shared config; defaults to dev and can be selected with `--stage`. |
| `provider.runtime` | Lambda Node.js runtime from shared config (`nodejs22.x`). |
| `provider.region` | AWS region from shared config (`us-west-2`). |
| `provider.environment` | Environment variables available to the application Lambda handlers, including the stage's bucket and the `ENVIRONMENT`-selected table names. |
| `provider.apiGateway` | Import the existing shared REST API and its root resource instead of creating another API. |
| `provider.iamRoleStatements` | AWS operations allowed for the application Lambdas; see Step 6. |
| `custom` | Import shared plugin settings, including local development and stage-specific custom domains. |
| `functions` | Declare the five application Lambdas and how requests invoke them. |
| `handler` | Source module and exported function, such as `handler.getSubmission`. |
| `events.http.path` / `method` | URL route and HTTP verb for the Lambda. |
| `events.http.cors` | Configure API Gateway browser CORS for that route. |
| `events.http.authorizer` | Attach the existing Cognito user-pool authorizer. Admin/team checks remain in backend code. |
| `resources` | Additional AWS CloudFormation resources used during deployment. |
| `resources.Conditions` | Compute whether this is production to choose CORS origins. |
| `resources.Resources` | Declare the CORS setup Lambda, role, log group, and custom resource that invokes setup. |
| `Type` / `Properties` | CloudFormation resource kind and its settings. |
| `AssumeRolePolicyDocument` | Allow the Lambda service to assume the setup function's IAM role. |
| `Policies` | Allow that role to set bucket CORS and write its logs. |
| `Code.ZipFile` | Inline JavaScript deployed as `index.js` for the setup function. |
| `ServiceToken` | ARN of the setup Lambda CloudFormation invokes. |
| `ServiceTimeout` | Maximum seconds CloudFormation waits for the custom-resource response. |
| `DependsOn` | Create the setup log group before its Lambda. Role references also establish deployment dependencies. |
| `CorsRules` | Actual bucket CORS settings; see Step 5. |

Variable expressions are resolved by Serverless: `${file(...):...}` reads another
file, `${self:...}` reads this configuration, `${env:...}` reads the shell
environment, and `${cf:...}` reads an existing stack output.
`!ImportValue`, `Fn::GetAtt`, `Fn::Equals`, and
`Fn::If` are CloudFormation expressions evaluated during deployment.

To apply the YAML with the project's normal deployment credentials, run from
`services/productplus`:

```sh
npx serverless deploy --stage dev
```

Use `--stage prod` for production. `NODE_ENV` and Serverless/AWS authentication
must be configured as in the repo's deployment workflow. This deploys the entire
Product Plus service; submission and upload handlers are still scaffolds returning
501, while the admin config endpoints are implemented.
