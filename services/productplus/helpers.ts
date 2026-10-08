import { randomUUID } from "node:crypto";
import {
  UpdateCommand,
  TransactWriteCommand,
  ScanCommand,
  type TransactWriteCommandInput
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import db from "../../lib/db.js";
// Writes use the shared client directly so conditional errors remain available for retries.
import docClient from "../../lib/docClient.js";
import type {
  Config,
  ConfigRecord,
  Submission,
  SubmissionRecord,
  UploadRecord,
  TeamRecord,
  RegistrationRecord,
  GetSubmissionResponse,
  PutSubmissionBody,
  UploadSubmissionResponse,
  CleanupTask
} from "./types";

// Deadline configuration: parse admin input and store one config row per event.
// Handlers turn this validation error into a 400 response.
export class ConfigValidationError extends Error {}

/** Validate and select the two public deadline fields. */
export function configResponse(value: Record<string, unknown>): Config {
  const { submission_deadline, voting_deadline } = value;

  if (
    typeof submission_deadline !== "string" ||
    typeof voting_deadline !== "string"
  ) {
    throw new ConfigValidationError(
      "Deadlines must be valid UTC ISO timestamps."
    );
  }

  // Validate the supplied strings without changing their stored/returned format.
  for (const [field, deadline] of [
    ["submission_deadline", submission_deadline],
    ["voting_deadline", voting_deadline]
  ]) {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+00:00)$/.test(
        deadline
      ) ||
      !Number.isFinite(Date.parse(deadline)) ||
      // Reject invalid calendar dates that Date silently rolls into another day.
      new Date(deadline).toISOString().slice(0, 19) !== deadline.slice(0, 19)
    ) {
      throw new ConfigValidationError(
        `${field} must be a valid UTC ISO timestamp.`
      );
    }
  }

  if (Date.parse(voting_deadline) <= Date.parse(submission_deadline)) {
    throw new ConfigValidationError(
      "voting_deadline must be after submission_deadline."
    );
  }

  return { submission_deadline, voting_deadline };
}

/** Parse the JSON body and reject fields outside the admin configuration contract. */
export function parseConfigBody(body: string | null): Config {
  let value: unknown;

  try {
    value = JSON.parse(body || "");
  } catch {
    throw new ConfigValidationError("Request body must be valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigValidationError("Request body must be a config object.");
  }

  const fields = ["submission_deadline", "voting_deadline"];

  if (Object.keys(value).some((key) => !fields.includes(key))) {
    throw new ConfigValidationError(`Only ${fields.join(", ")} are allowed.`);
  }

  return configResponse(value as Record<string, unknown>);
}

/** Configuration shares the submissions table, using the reserved team code "config". */
function configLocation() {
  const TableName = process.env.PRODUCTPLUS_SUBMISSIONS_TABLE;
  const event_key = process.env.PRODUCTPLUS_EVENT_KEY;

  if (!TableName || !event_key) {
    throw new Error("Product Plus table and event configuration are required.");
  }

  // The full environment-selected table name already includes its PROD suffix.
  return { TableName, Key: { event_key, team_code: "config" } };
}

/** Read the latest committed config; the custom wrapper accepts our actual key names. */
export async function getConfigRecord(): Promise<ConfigRecord | null> {
  return db.getOneCustom({
    ...configLocation(),
    ConsistentRead: true
  }) as Promise<ConfigRecord | null>;
}

/** Create or update the deadlines without replacing other attributes on the config row. */
export async function saveConfig(config: Config): Promise<Config> {
  const result = await docClient.send(
    new UpdateCommand({
      ...configLocation(),
      UpdateExpression:
        "SET #submission = :submission, #voting = :voting, " +
        "#updated = :updated",
      ExpressionAttributeNames: {
        "#submission": "submission_deadline",
        "#voting": "voting_deadline",
        "#updated": "updated_at"
      },
      ExpressionAttributeValues: {
        ":submission": config.submission_deadline,
        ":voting": config.voting_deadline,
        ":updated": new Date().toISOString()
      },
      ReturnValues: "ALL_NEW"
    })
  );

  if (!result.Attributes) {
    throw new Error("DynamoDB did not return the saved config.");
  }

  return configResponse(result.Attributes);
}

// The browser supplies PDF bytes later; do not sign an empty-body checksum.
const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });

// Shared storage and membership checks used by uploads, submissions, and cleanup.
// Expected participant errors carry the HTTP status that handlers should return.
export class ProductPlusError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

/** Fail early if deployment is missing a table, bucket, or event setting. */
function storageSettings() {
  const eventKey = process.env.PRODUCTPLUS_EVENT_KEY;
  const submissionsTable = process.env.PRODUCTPLUS_SUBMISSIONS_TABLE;
  const teamsTable = process.env.PRODUCTPLUS_TEAMS_TABLE;
  const registrationsTable = process.env.PRODUCTPLUS_REGISTRATIONS_TABLE;
  const uploadsTable = process.env.PRODUCTPLUS_UPLOADS_TABLE;
  const bucket = process.env.PRODUCTPLUS_PRD_BUCKET;

  if (
    !eventKey ||
    !submissionsTable ||
    !teamsTable ||
    !registrationsTable ||
    !uploadsTable ||
    !bucket
  ) {
    throw new Error("Product Plus storage settings are required.");
  }

  return {
    eventKey,
    submissionsTable,
    teamsTable,
    registrationsTable,
    uploadsTable,
    bucket
  };
}

type StorageSettings = ReturnType<typeof storageSettings>;
type TransactionItems = NonNullable<TransactWriteCommandInput["TransactItems"]>;

/** Resolve the caller's team for this event and verify the team's member list. */
// TODO(team workflow): reuse its membership helper when a compatible version merges.
async function currentTeam(email: string, settings: StorageSettings) {
  // The registration gives the team code without trusting a code from the browser.
  const registrationKey = { id: email, "eventID;year": settings.eventKey };
  const registration = (await db.getOneCustom({
    TableName: settings.registrationsTable,
    Key: registrationKey,
    ConsistentRead: true
  })) as RegistrationRecord | null;

  if (!registration) {
    throw new ProductPlusError(403, "Current team membership is required.");
  }

  const teamCode = registration.team_code;

  if (teamCode === undefined || teamCode === "") {
    throw new ProductPlusError(403, "Current team membership is required.");
  }

  if (typeof teamCode !== "string" || !/^\d{6}$/.test(teamCode)) {
    throw new ProductPlusError(
      409,
      "The team must have a six-digit team code to access submissions."
    );
  }

  // A stale registration cannot authorize someone removed from the team's list.
  const teamKey = { id: teamCode, "eventID;year": settings.eventKey };
  const team = (await db.getOneCustom({
    TableName: settings.teamsTable,
    Key: teamKey,
    ConsistentRead: true
  })) as TeamRecord | null;

  if (!Array.isArray(team?.memberIDs) || !team.memberIDs.includes(email)) {
    throw new ProductPlusError(403, "Current team membership is required.");
  }

  return { teamCode, registrationKey, teamKey };
}

type CurrentTeam = Awaited<ReturnType<typeof currentTeam>>;

/** Recheck the registration and team inside a write, so a concurrent removal blocks it. */
function membershipChecks(
  email: string,
  team: CurrentTeam,
  settings: StorageSettings
): TransactionItems {
  return [
    {
      ConditionCheck: {
        TableName: settings.registrationsTable,
        Key: team.registrationKey,
        ConditionExpression: "#code = :code",
        ExpressionAttributeNames: { "#code": "team_code" },
        ExpressionAttributeValues: { ":code": team.teamCode }
      }
    },
    {
      ConditionCheck: {
        TableName: settings.teamsTable,
        Key: team.teamKey,
        ConditionExpression: "contains(#members, :email)",
        ExpressionAttributeNames: { "#members": "memberIDs" },
        ExpressionAttributeValues: { ":email": email }
      }
    }
  ];
}

/** Reject a write if an admin changed the deadline after this request read it. */
function deadlineCheck(
  deadline: string,
  settings: StorageSettings
): TransactionItems[number] {
  return {
    ConditionCheck: {
      TableName: settings.submissionsTable,
      Key: { event_key: settings.eventKey, team_code: "config" },
      ConditionExpression: "#deadline = :deadline",
      ExpressionAttributeNames: { "#deadline": "submission_deadline" },
      ExpressionAttributeValues: { ":deadline": deadline }
    }
  };
}

/** Load the latest team submission; preserve undefined for existing internal callers. */
async function readSubmission(teamCode: string, settings: StorageSettings) {
  const item = await db.getOneCustom({
    TableName: settings.submissionsTable,
    Key: { event_key: settings.eventKey, team_code: teamCode },
    ConsistentRead: true
  });

  return (item as SubmissionRecord | null) ?? undefined;
}

/** Look up server-owned upload tracking before trusting a client-supplied PDF path. */
async function readUpload(prdPath: string, settings: StorageSettings) {
  const item = await db.getOneCustom({
    TableName: settings.uploadsTable,
    Key: { prd_path: prdPath },
    ConsistentRead: true
  });

  return (item as UploadRecord | null) ?? undefined;
}

// Object keys and upload state: ownership comes from tracking, not a supplied URL.
/** Derive the permanent destination from the upload's server-generated ID. */
function permanentPath(upload: UploadRecord, settings: StorageSettings) {
  return `productplus/submitted/${settings.eventKey}/${upload.team_code}/${upload.upload_id}/prd.pdf`;
}

function storedPath(upload: UploadRecord) {
  // Pending uploads have only a temporary key; promoted uploads also have a permanent key.
  return upload.permanent_path || upload.prd_path;
}

/** Require both matching ownership fields and the exact key generated for this upload. */
function ownedUpload(
  upload: UploadRecord,
  settings: StorageSettings,
  teamCode: string
) {
  const suffix = `${settings.eventKey}/${teamCode}/${upload.upload_id}/prd.pdf`;

  return (
    upload.event_key === settings.eventKey &&
    upload.team_code === teamCode &&
    typeof teamCode === "string" &&
    /^\d{6}$/.test(teamCode) &&
    typeof upload.upload_id === "string" &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
      upload.upload_id
    ) &&
    upload.prd_path === "productplus/temp/" + suffix &&
    (!upload.permanent_path ||
      upload.permanent_path === permanentPath(upload, settings))
  );
}

/** Tracking stays under the temporary key even after the submission uses a permanent key. */
async function submissionUpload(path: string, settings: StorageSettings) {
  const key = path.startsWith("productplus/submitted/")
    ? path.replace("productplus/submitted/", "productplus/temp/")
    : path;

  return readUpload(key, settings);
}

/** Retry changed conditions or competing writes; other database failures must propagate. */
function transactionConflict(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "TransactionConflictException") {
    return true;
  }

  return (
    error.name === "TransactionCanceledException" &&
    "CancellationReasons" in error &&
    Array.isArray(error.CancellationReasons) &&
    error.CancellationReasons.some((reason) =>
      ["ConditionalCheckFailed", "TransactionConflict"].includes(reason?.Code)
    )
  );
}

/** Match the strongly read upload before changing its lifecycle. */
function uploadCondition(upload: UploadRecord) {
  return {
    ConditionExpression:
      "#status = :priorStatus AND #updated = :priorUpdated AND " +
      "event_key = :event AND team_code = :code",
    ExpressionAttributeNames: { "#status": "status", "#updated": "updated_at" },
    ExpressionAttributeValues: {
      ":priorStatus": upload.status,
      ":priorUpdated": upload.updated_at,
      ":event": upload.event_key,
      ":code": upload.team_code
    }
  };
}

// Upload URLs: authorize a direct browser PUT to S3 and record who owns its key.
const MAX_URL_SECONDS = 300;

/** Accept PDF content type only; callers cannot choose their team, key, or upload ID. */
function validateUploadBody(body: string | null) {
  let value;

  try {
    value = JSON.parse(body || "");
  } catch {
    throw new ProductPlusError(400, "Request body must be valid JSON.");
  }

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.content_type !== "application/pdf" ||
    Object.keys(value).some((key) => key !== "content_type")
  ) {
    throw new ProductPlusError(
      400,
      "Provide only content_type: application/pdf."
    );
  }
}

/** Issue a temporary upload URL only while the caller is a member and submissions are open. */
export async function createPrdUpload(
  email: string,
  body: string | null
): Promise<UploadSubmissionResponse> {
  validateUploadBody(body);

  // Membership and deadlines are independent reads, so load them together.
  const settings = storageSettings();
  const [team, record] = await Promise.all([
    currentTeam(email, settings),
    getConfigRecord()
  ]);

  if (!record) {
    throw new ProductPlusError(
      503,
      "Product Plus submission deadline has not been set."
    );
  }

  // Cap the URL lifetime at the deadline; fractional seconds cannot extend access.
  const config = configResponse(record);
  const deadline = Date.parse(config.submission_deadline);
  const signingDate = new Date();
  const expiresIn = Math.min(
    MAX_URL_SECONDS,
    Math.floor((deadline - signingDate.getTime()) / 1000)
  );

  if (expiresIn < 1) {
    throw new ProductPlusError(
      403,
      "Submission uploads are closed or the deadline is too close."
    );
  }

  // A fresh key and signed If-None-Match header prevent overwriting an existing PDF.
  const uploadId = randomUUID();
  const prdPath = `productplus/temp/${settings.eventKey}/${team.teamCode}/${uploadId}/prd.pdf`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: settings.bucket,
      Key: prdPath,
      ContentType: "application/pdf",
      IfNoneMatch: "*"
    }),
    {
      signingDate,
      expiresIn,
      signableHeaders: new Set(["content-type", "if-none-match"])
    }
  );
  // SigV4 timestamps have second precision. Track the URL's actual expiry.
  const expiresAt =
    Math.floor(signingDate.getTime() / 1000) * 1000 + expiresIn * 1000;

  if (Date.now() >= deadline || Date.now() >= expiresAt) {
    throw new ProductPlusError(
      403,
      "Submission uploads are closed or the upload URL has expired."
    );
  }

  // This record establishes ownership before the browser uploads any bytes.
  const timestamp = signingDate.toISOString();
  const upload: UploadRecord = {
    prd_path: prdPath,
    event_key: settings.eventKey,
    team_code: team.teamCode,
    upload_id: uploadId,
    content_type: "application/pdf",
    status: "pending",
    created_at: timestamp,
    updated_at: timestamp,
    upload_expires_at: new Date(expiresAt).toISOString()
  };

  // Save tracking and check membership/deadline in one all-or-nothing transaction.
  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: settings.uploadsTable,
              Item: upload,
              ConditionExpression: "attribute_not_exists(prd_path)"
            }
          },
          ...membershipChecks(email, team, settings),
          deadlineCheck(config.submission_deadline, settings)
        ]
      })
    );
  } catch (error) {
    if (transactionConflict(error)) {
      throw new ProductPlusError(
        409,
        "Team membership or upload configuration changed. Request a new upload URL."
      );
    }

    throw error;
  }

  if (Date.now() >= deadline || Date.now() >= expiresAt) {
    // No object exists until PUT; S3 Lifecycle expires any temporary upload.
    throw new ProductPlusError(
      403,
      "Submission uploads are closed or the upload URL has expired."
    );
  }

  return {
    upload_url: uploadUrl,
    upload_method: "PUT",
    upload_headers: { "Content-Type": "application/pdf", "If-None-Match": "*" },
    prd_path: prdPath
  };
}

// Submission reads and validation: build the public response and validate form input.
/** Resolve the current team, deadlines, and submission together for each read/save attempt. */
async function submissionContext(email: string, settings: StorageSettings) {
  const [team, record] = await Promise.all([
    currentTeam(email, settings),
    getConfigRecord()
  ]);

  if (!record) {
    throw new ProductPlusError(
      503,
      "Product Plus submission deadline has not been set."
    );
  }

  const config = configResponse(record);
  const submission = await readSubmission(team.teamCode, settings);

  return { team, config, submission };
}

/** Explicit projection also serves the judging workflow without leaking storage fields. */
export async function submissionResponse(
  record: Pick<SubmissionRecord, keyof Omit<Submission, "prd_view_url">>,
  bucket = process.env.PRODUCTPLUS_PRD_BUCKET
): Promise<Submission> {
  if (!bucket) {
    throw new Error("Product Plus PDF bucket is required.");
  }

  // Viewing uses a separate short-lived GET URL; it grants no upload permission.
  const prdViewUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: record.prd_path,
      ResponseContentType: "application/pdf",
      ResponseContentDisposition: 'inline; filename="prd.pdf"'
    }),
    { expiresIn: 300, signingDate: new Date() }
  );

  // Select public fields explicitly so upload, judging, and voting metadata stays private.
  return {
    team_code: record.team_code,
    team_name: record.team_name,
    member_names: record.member_names,
    video_url: record.video_url,
    prd_path: record.prd_path,
    prd_view_url: prdViewUrl,
    submitted_at: record.submitted_at,
    updated_at: record.updated_at
  };
}

/** Viewing stays available after the deadline; only can_edit changes when time expires. */
export async function loadSubmission(
  email: string
): Promise<GetSubmissionResponse> {
  const settings = storageSettings();
  const { config, submission } = await submissionContext(email, settings);

  return {
    submission: submission
      ? await submissionResponse(submission, settings.bucket)
      : null,
    submission_deadline: config.submission_deadline,
    can_edit: Date.now() < Date.parse(config.submission_deadline)
  };
}

/** Validate YouTube URL structure only; this does not check visibility or video duration. */
function supportedVideo(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return false;
  }

  let videoId: string | null | undefined;

  // Extract the video ID from supported hosts/paths, then validate its exact format.
  if (url.hostname === "youtu.be") {
    videoId = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  } else if (
    ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
  ) {
    if (url.pathname === "/watch") {
      if (url.searchParams.getAll("v").length !== 1) {
        return false;
      }

      videoId = url.searchParams.get("v");
    } else {
      videoId = /^\/(?:shorts|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    }
  }

  return typeof videoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(videoId);
}

/** Accept exactly the four editable fields and trim their text before storing it. */
function parseSubmissionBody(body: string | null): PutSubmissionBody {
  let value;

  try {
    value = JSON.parse(body || "");
  } catch {
    throw new ProductPlusError(400, "Request body must be valid JSON.");
  }

  // Reject ownership or judging fields supplied through the form body.
  const fields = ["team_name", "member_names", "video_url", "prd_path"];

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  ) {
    throw new ProductPlusError(400, "Provide only the submission form fields.");
  }

  if (
    typeof value.team_name !== "string" ||
    !value.team_name.trim() ||
    !Array.isArray(value.member_names) ||
    !value.member_names.length ||
    value.member_names.some(
      (name: unknown) => typeof name !== "string" || !name.trim()
    )
  ) {
    throw new ProductPlusError(
      400,
      "Team name and member names must be nonempty."
    );
  }

  if (
    typeof value.video_url !== "string" ||
    !supportedVideo(value.video_url.trim())
  ) {
    throw new ProductPlusError(
      400,
      "Provide a supported HTTPS YouTube video URL."
    );
  }

  if (typeof value.prd_path !== "string" || !value.prd_path.trim()) {
    throw new ProductPlusError(400, "An uploaded PRD path is required.");
  }

  return {
    team_name: value.team_name.trim(),
    member_names: value.member_names.map((name: string) => name.trim()),
    video_url: value.video_url.trim(),
    prd_path: value.prd_path.trim()
  };
}

/** Check S3 metadata and the PDF header, returning the ETag used to protect the later copy. */
async function validatePdf(path: string, settings: StorageSettings) {
  const limit = Number(process.env.PRODUCTPLUS_MAX_PRD_BYTES);

  if (!Number.isSafeInteger(limit) || limit < 8) {
    throw new Error("Product Plus PDF size limit is required.");
  }

  try {
    // HEAD checks existence, declared content type, and size without downloading the PDF.
    const metadata = await s3.send(
      new HeadObjectCommand({ Bucket: settings.bucket, Key: path })
    );

    if (
      metadata.ContentType !== "application/pdf" ||
      !Number.isSafeInteger(metadata.ContentLength) ||
      metadata.ContentLength! < 8 ||
      metadata.ContentLength! > limit
    ) {
      throw new ProductPlusError(
        400,
        `PRD must be a PDF no larger than ${limit} bytes.`
      );
    }

    if (!metadata.ETag) {
      throw new Error("S3 returned no PDF ETag.");
    }

    // Read only the eight-byte header. IfMatch ties it to the object checked by HEAD.
    const object = await s3.send(
      new GetObjectCommand({
        Bucket: settings.bucket,
        Key: path,
        Range: "bytes=0-7",
        // Protect the header check if the object changes outside this workflow.
        IfMatch: metadata.ETag
      })
    );

    if (!object.Body) {
      throw new Error("S3 returned no PDF body.");
    }

    // ASCII decoding masks high bits and could accept an invalid PDF header.
    const header = Buffer.from(
      await object.Body.transformToByteArray()
    ).toString("latin1");

    if (!/^%PDF-\d\.\d/.test(header)) {
      throw new ProductPlusError(400, "PRD must contain a PDF file header.");
    }

    return metadata.ETag;
  } catch (error) {
    if (missingObject(error) || errorName(error) === "PreconditionFailed") {
      throw new ProductPlusError(
        400,
        "The uploaded PRD is missing or changed. Upload it again."
      );
    }

    throw error;
  }
}

// Saving: copy the PDF first, then atomically update its submission and tracking.
const lambda = new LambdaClient({ maxAttempts: 2 });

/** Match bots' InvokeCommand pattern; the request awaits acceptance, not execution. */
async function enqueueCleanup(task: CleanupTask) {
  try {
    const functionName = process.env.PRODUCTPLUS_CLEANUP_FUNCTION;

    if (!functionName) {
      throw new Error("Cleanup function is not configured.");
    }

    const result = await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify(task))
      })
    );

    if (result.StatusCode !== 202) {
      throw new Error("Cleanup invocation was not accepted.");
    }
  } catch (error) {
    // The database already committed. Preserve that success and a replayable task.
    console.error("Product Plus cleanup delivery failed", {
      task,
      error: errorName(error)
    });
  }
}

/** Keep our error summaries small; response bodies never include raw storage errors. */
function errorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

/** Check server time immediately before writes, including retried saves. */
function requireOpen(deadline: string) {
  if (Date.now() >= Date.parse(deadline)) {
    throw new ProductPlusError(403, "Submissions are closed.");
  }
}

/** Update form fields only; initialize timestamps, rubrics, and counters on first save. */
function submissionWrite(
  form: PutSubmissionBody,
  path: string,
  team: CurrentTeam,
  prior: SubmissionRecord | undefined,
  now: string,
  settings: StorageSettings
): TransactionItems[number] {
  return {
    Update: {
      TableName: settings.submissionsTable,
      Key: { event_key: settings.eventKey, team_code: team.teamCode },
      // The previous PDF must still match, or another save won and we need a fresh read.
      ConditionExpression: prior
        ? "prd_path = :priorPath"
        : "attribute_not_exists(team_code)",
      UpdateExpression:
        "SET team_name = :name, member_names = :members, " +
        "video_url = :video, prd_path = :path, updated_at = :now, " +
        "submitted_at = if_not_exists(submitted_at, :now), " +
        "graded_submissions = if_not_exists(graded_submissions, :rubrics), " +
        "upvotes = if_not_exists(upvotes, :zero), downvotes = if_not_exists(downvotes, :zero)",
      ExpressionAttributeValues: {
        ":name": form.team_name,
        ":members": form.member_names,
        ":video": form.video_url,
        ":path": path,
        ":now": now,
        ":rubrics": [],
        ":zero": 0,
        ...(prior ? { ":priorPath": prior.prd_path } : {})
      }
    }
  };
}

/** Reserve one upload, then copy its validated PDF into permanent storage. */
async function promoteUpload(
  email: string,
  upload: UploadRecord,
  team: CurrentTeam,
  deadline: string,
  settings: StorageSettings
): Promise<UploadRecord> {
  // Validate before reserving; the token identifies the request allowed to finish this save.
  const etag = await validatePdf(upload.prd_path, settings);
  const token = randomUUID();
  const destination = permanentPath(upload, settings);
  const condition = uploadCondition(upload);
  const now = new Date().toISOString();

  requireOpen(deadline);

  try {
    // The reservation excludes other saves and cleanup while S3 copies the file.
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: settings.uploadsTable,
              Key: { prd_path: upload.prd_path },
              ...condition,
              UpdateExpression:
                "SET #status = :promoting, #updated = :now, permanent_path = :path, promotion_token = :token",
              ExpressionAttributeValues: {
                ...condition.ExpressionAttributeValues,
                ":promoting": "promoting",
                ":now": now,
                ":path": destination,
                ":token": token
              }
            }
          },
          ...membershipChecks(email, team, settings),
          deadlineCheck(deadline, settings),
          noReference({ ...upload, permanent_path: destination }, settings)
        ]
      })
    );
  } catch (error) {
    if (!transactionConflict(error)) {
      console.error("Product Plus promotion reservation needs recovery", {
        prd_path: upload.prd_path,
        error: errorName(error)
      });
    }

    throw error;
  }

  // Copy only the object we validated. The original temporary file expires via Lifecycle.
  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: settings.bucket,
        Key: destination,
        CopySource: `${settings.bucket}/${encodeURIComponent(upload.prd_path)}`,
        CopySourceIfMatch: etag
      })
    );
  } catch (error) {
    if (missingObject(error) || errorName(error) === "PreconditionFailed") {
      // S3 rejected the source, so this reservation can safely be released.
      await docClient.send(
        new UpdateCommand({
          TableName: settings.uploadsTable,
          Key: { prd_path: upload.prd_path },
          ConditionExpression:
            "#status = :promoting AND promotion_token = :token",
          UpdateExpression:
            "SET #status = :pending REMOVE permanent_path, promotion_token",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":promoting": "promoting",
            ":token": token,
            ":pending": "pending"
          }
        })
      );

      throw new ProductPlusError(
        400,
        "The uploaded PRD is missing or changed. Upload it again."
      );
    }

    // A timed-out copy may still finish. Retain its key for manual cleanup.
    console.error("Product Plus promotion needs recovery", {
      prd_path: upload.prd_path,
      error: errorName(error)
    });
    throw error;
  }

  return {
    ...upload,
    status: "promoting",
    updated_at: now,
    permanent_path: destination,
    promotion_token: token
  };
}

/** Coordinate form edits or a new PDF, with fresh membership/deadline checks on each retry. */
export async function saveSubmission(
  email: string,
  body: string | null
): Promise<Submission> {
  const form = parseSubmissionBody(body);
  const settings = storageSettings();
  let promotion: UploadRecord | undefined;

  try {
    // Keep a successful copy across retries, but reload the team and submission each time.
    for (let attempt = 0; attempt < 3; attempt++) {
      let context = await submissionContext(email, settings);

      requireOpen(context.config.submission_deadline);

      let upload: UploadRecord | undefined;
      const formOnly = form.prd_path === context.submission?.prd_path;

      if (formOnly) {
        // A form-only edit retains the current permanent PDF and performs no S3 copy.
        upload = await submissionUpload(form.prd_path, settings);

        if (
          !upload ||
          !ownedUpload(upload, settings, context.team.teamCode) ||
          upload.status !== "referenced" ||
          storedPath(upload) !== form.prd_path
        ) {
          throw new ProductPlusError(400, "The current PRD is unavailable.");
        }

        await validatePdf(form.prd_path, settings);
      } else if (!promotion) {
        // New PDFs must start from a pending upload owned by this team.
        upload = await readUpload(form.prd_path, settings);

        if (
          !upload ||
          !ownedUpload(upload, settings, context.team.teamCode) ||
          upload.content_type !== "application/pdf"
        ) {
          throw new ProductPlusError(
            400,
            "PRD must be an upload belonging to your current team."
          );
        }

        if (upload.status === "promoting") {
          throw new ProductPlusError(
            409,
            "This upload is already being submitted."
          );
        }

        if (upload.status !== "pending") {
          throw new ProductPlusError(
            400,
            "Request a new upload for a new PDF."
          );
        }

        try {
          promotion = await promoteUpload(
            email,
            upload,
            context.team,
            context.config.submission_deadline,
            settings
          );
        } catch (error) {
          if (transactionConflict(error)) {
            continue;
          }

          throw error;
        }
        // Membership/configuration could change while S3 copies the file.
        context = await submissionContext(email, settings);
      }

      // After copying, confirm this request still owns the reservation and the team.
      requireOpen(context.config.submission_deadline);
      upload = formOnly
        ? upload
        : await readUpload(promotion!.prd_path, settings);

      if (
        !upload ||
        !ownedUpload(upload, settings, context.team.teamCode) ||
        (!formOnly &&
          (upload.status !== "promoting" ||
            upload.promotion_token !== promotion?.promotion_token))
      ) {
        throw new ProductPlusError(
          409,
          "Upload or team changed while saving. Request a new upload."
        );
      }

      // Find the PDF being replaced so its tracking changes in the same transaction.
      const path = formOnly ? form.prd_path : upload.permanent_path!;
      const prior = context.submission;
      const previous =
        prior && prior.prd_path !== path
          ? await submissionUpload(prior.prd_path, settings)
          : undefined;

      if (
        prior &&
        prior.prd_path !== path &&
        (!previous ||
          !ownedUpload(previous, settings, context.team.teamCode) ||
          previous.status !== "referenced")
      ) {
        // Another save may have replaced it between our submission and tracking reads.
        const latest = await readSubmission(context.team.teamCode, settings);

        if (latest?.prd_path !== prior.prd_path) {
          continue;
        }

        throw new Error("Current submission tracking is inconsistent.");
      }

      // Prepare the response before committing, so URL-signing failure cannot hide a save.
      const now = new Date().toISOString();
      const result = await submissionResponse(
        {
          ...form,
          prd_path: path,
          team_code: context.team.teamCode,
          submitted_at: prior?.submitted_at || now,
          updated_at: now
        },
        settings.bucket
      );
      // Commit the form, reference the chosen PDF, and recheck membership/deadline together.
      const condition = uploadCondition(upload);
      const items: TransactionItems = [
        submissionWrite(form, path, context.team, prior, now, settings),
        {
          Update: {
            TableName: settings.uploadsTable,
            Key: { prd_path: upload.prd_path },
            ...condition,
            ConditionExpression:
              condition.ConditionExpression +
              (formOnly ? "" : " AND promotion_token = :token"),
            UpdateExpression:
              "SET #status = :referenced, #updated = :now REMOVE promotion_token",
            ExpressionAttributeValues: {
              ...condition.ExpressionAttributeValues,
              ":referenced": "referenced",
              ":now": now,
              ...(!formOnly ? { ":token": promotion!.promotion_token } : {})
            }
          }
        },
        ...membershipChecks(email, context.team, settings),
        deadlineCheck(context.config.submission_deadline, settings)
      ];

      if (previous) {
        // Mark the old PDF replaced only if this transaction also saves the new reference.
        const oldCondition = uploadCondition(previous);

        items.push({
          Update: {
            TableName: settings.uploadsTable,
            Key: { prd_path: previous.prd_path },
            ...oldCondition,
            UpdateExpression: "SET #status = :replaced, #updated = :now",
            ExpressionAttributeValues: {
              ...oldCondition.ExpressionAttributeValues,
              ":replaced": "replaced",
              ":now": now
            }
          }
        });
      }

      requireOpen(context.config.submission_deadline);

      try {
        await docClient.send(
          new TransactWriteCommand({ TransactItems: items })
        );
      } catch (error) {
        if (transactionConflict(error)) {
          continue;
        }

        // A timeout may have committed. Leave both files in place and let GET
        // show the saved state; never delete a possibly referenced PDF here.
        throw error;
      }

      // Cleanup starts only after commit; delivery failure must not undo a successful save.
      if (previous) {
        await enqueueCleanup({
          internalTask: "retire_upload",
          payload: { event_key: settings.eventKey, prd_path: previous.prd_path }
        });
      }

      return result;
    }

    throw new ProductPlusError(
      409,
      "Submission or team configuration changed. Try saving again."
    );
  } catch (error) {
    // A copied PDF may remain after a failed save. Keep its tracking for manual recovery.
    if (promotion) {
      console.error("Product Plus promotion needs recovery", {
        prd_path: promotion.prd_path,
        error: errorName(error)
      });
    }

    throw error;
  }
}

// Cleanup: claim an unreferenced file before deletion, and leave active PDFs untouched.
/** Prevent cleanup or promotion from changing a file currently referenced by a submission. */
function noReference(
  upload: UploadRecord,
  settings: StorageSettings
): TransactionItems[number] {
  return {
    ConditionCheck: {
      TableName: settings.submissionsTable,
      Key: { event_key: settings.eventKey, team_code: upload.team_code },
      ConditionExpression:
        "attribute_not_exists(prd_path) OR prd_path <> :path",
      ExpressionAttributeValues: { ":path": storedPath(upload) }
    }
  };
}

/** Check team absence inside the delete transaction, not just in an earlier read. */
function absentTeam(
  teamCode: string,
  settings: StorageSettings
): TransactionItems[number] {
  return {
    ConditionCheck: {
      TableName: settings.teamsTable,
      Key: { id: teamCode, "eventID;year": settings.eventKey },
      ConditionExpression: "attribute_not_exists(id)"
    }
  };
}

/** S3 missing-file responses can have a named error or only HTTP status metadata. */
function missingObject(error: unknown) {
  return (
    error instanceof Error &&
    (["NotFound", "NoSuchKey"].includes(error.name) ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404)
  );
}

/** Delete one eligible tracked file; return false when no cleanup is needed or it is in use. */
async function cleanUpload(
  key: string,
  mode: "retire" | "team",
  settings: StorageSettings,
  teamCode?: string
) {
  const upload = await readUpload(key, settings);

  if (!upload) {
    return false;
  }

  if (
    !ownedUpload(upload, settings, upload.team_code) ||
    (teamCode && upload.team_code !== teamCode)
  ) {
    throw new Error("Cleanup upload ownership is invalid.");
  }

  // Completed tasks are safe to repeat. Active or still-copying files cannot be retired.
  if (upload.status === "deleted") {
    return false;
  }

  if (mode === "retire" && !["replaced", "deleting"].includes(upload.status)) {
    return false;
  }

  if (mode === "team" && upload.status === "promoting") {
    throw new Error(
      "An interrupted promotion requires reconciliation before deleting its team files."
    );
  }

  const condition = uploadCondition(upload);

  try {
    // This same upload participates in submission saves: only one transaction can
    // reference it or claim it for deletion. A claimed upload cannot be resubmitted.
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: settings.uploadsTable,
              Key: { prd_path: key },
              ...condition,
              UpdateExpression: "SET #status = :deleting, #updated = :now",
              ExpressionAttributeValues: {
                ...condition.ExpressionAttributeValues,
                ":deleting": "deleting",
                ":now": new Date().toISOString()
              }
            }
          },
          noReference(upload, settings),
          ...(mode === "team" ? [absentTeam(upload.team_code, settings)] : [])
        ]
      })
    );
  } catch (error) {
    if (!transactionConflict(error)) {
      throw error;
    }

    const latest = await readUpload(key, settings);
    const submission = await readSubmission(upload.team_code, settings);

    if (
      latest?.status === "deleted" ||
      submission?.prd_path === storedPath(upload)
    ) {
      return false;
    }

    throw error; // A concurrent change without a reference must be retried.
  }

  const path = storedPath(upload);
  // Delete the claimed file directly. Lifecycle expires its original temp copy.
  const paths = new Set([path]);

  if (mode === "team") {
    paths.add(upload.prd_path);
  }

  for (const objectKey of paths) {
    await s3.send(
      new DeleteObjectCommand({ Bucket: settings.bucket, Key: objectKey })
    );
  }

  // Mark completion only after all deletes succeed; otherwise a retry can finish the work.
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: settings.uploadsTable,
        Key: { prd_path: key },
        ConditionExpression: "#status = :deleting",
        UpdateExpression:
          "SET #status = :deleted, #updated = :now REMOVE promotion_token",
        ExpressionAttributeNames: {
          "#status": "status",
          "#updated": "updated_at"
        },
        ExpressionAttributeValues: {
          ":deleting": "deleting",
          ":deleted": "deleted",
          ":now": new Date().toISOString()
        }
      })
    );
  } catch (error) {
    if (
      errorName(error) !== "ConditionalCheckFailedException" ||
      (await readUpload(key, settings))?.status !== "deleted"
    ) {
      throw error;
    }
  }

  return true;
}

/** Collect every page of this team's tracking records, including pages filtered to zero items. */
async function teamUploads(
  teamCode: string,
  settings: StorageSettings
): Promise<UploadRecord[]> {
  const uploads: UploadRecord[] = [];
  let cursor: Record<string, unknown> | undefined;

  do {
    // GSI reads cannot be strong. Team deletion is infrequent, so scan the base
    // table to include uploads committed immediately before the team disappeared.
    const result = await docClient.send(
      new ScanCommand({
        TableName: settings.uploadsTable,
        ConsistentRead: true,
        FilterExpression: "event_key = :event AND team_code = :code",
        ExpressionAttributeValues: {
          ":event": settings.eventKey,
          ":code": teamCode
        },
        ExclusiveStartKey: cursor
      })
    );

    uploads.push(...((result.Items || []) as UploadRecord[]));
    cursor = result.LastEvaluatedKey;
  } while (cursor);

  return uploads;
}

/** Process private replacement/team-deletion tasks and report failures for Lambda retries. */
export async function cleanupProductPlus(task: CleanupTask) {
  const settings = storageSettings();

  if (!task?.payload || task.payload.event_key !== settings.eventKey) {
    throw new Error("Invalid cleanup event.");
  }

  let cleaned = 0;

  try {
    if (task.internalTask === "retire_upload") {
      if (typeof task.payload.prd_path !== "string") {
        throw new Error("Invalid cleanup upload.");
      }

      cleaned += Number(
        await cleanUpload(task.payload.prd_path, "retire", settings)
      );
    } else if (task.internalTask === "team_deleted") {
      const { team_code: teamCode } = task.payload;

      if (typeof teamCode !== "string" || !/^\d{6}$/.test(teamCode)) {
        throw new Error("Invalid cleanup team.");
      }

      // The caller's task is not proof of deletion: verify absence before removing data.
      const team = await db.getOneCustom({
        TableName: settings.teamsTable,
        Key: { id: teamCode, "eventID;year": settings.eventKey },
        ConsistentRead: true
      });

      if (team) {
        throw new Error("Team still exists; cleanup is not allowed.");
      }

      const submission = await readSubmission(teamCode, settings);

      if (submission) {
        // Remove the public submission before file cleanup, even if S3 or scanning fails.
        await docClient.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Delete: {
                  TableName: settings.submissionsTable,
                  Key: { event_key: settings.eventKey, team_code: teamCode },
                  ConditionExpression: "prd_path = :path",
                  ExpressionAttributeValues: {
                    ":path": submission.prd_path
                  }
                }
              },
              absentTeam(teamCode, settings)
            ]
          })
        );
      }

      const uploads = await teamUploads(teamCode, settings);

      // Continue other files when one fails; fail the invocation for automatic retry.
      let failures = 0;

      for (const upload of uploads) {
        try {
          cleaned += Number(
            await cleanUpload(upload.prd_path, "team", settings, teamCode)
          );
        } catch (error) {
          failures++;
          console.error("Product Plus file cleanup failed", {
            prd_path: upload.prd_path,
            error: errorName(error)
          });
        }
      }

      if (failures) {
        throw new Error("Some team files need cleanup retry.");
      }
    } else {
      throw new Error("Unknown cleanup task.");
    }

    console.log("Product Plus cleanup completed", {
      task: task.internalTask,
      cleaned
    });

    return { cleaned };
  } catch (error) {
    console.error("Product Plus cleanup failed", {
      task,
      cleaned,
      error: errorName(error)
    });

    throw new Error(
      "Product Plus cleanup failed; retry or inspect tracking records."
    );
  }
}
