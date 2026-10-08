import db from "../../lib/db.js";
import res from "../../lib/responseHelpers.js";
import type {
  Config,
  Submission,
  SubmissionRecord
} from "./typesProductPlus.temporary.js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({ region: "us-west-2" });

export const submissionsTable = () =>
  process.env.PRODUCT_PLUS_SUBMISSIONS_TABLE || "biztechPPSubmissions";

export const tableName = () =>
  submissionsTable() + (process.env.ENVIRONMENT || "");

export const getEventKey = () => {
  const key = process.env.PRODUCT_PLUS_EVENT_KEY;
  if (!key)
    throw res.send(503, { message: "Product Plus event is not configured" });
  return key;
};

export const getVotingConfig = async (event_key: string): Promise<Config> => {
  const config = await db.getOneCustom({
    TableName: tableName(),
    Key: { event_key, team_code: "config" },
    ConsistentRead: true
  });
  const votingOpens = Date.parse(config?.submission_deadline);

  const votingCloses = Date.parse(config?.voting_deadline);
  if (
    !Number.isFinite(votingOpens) ||
    !Number.isFinite(votingCloses) ||
    votingCloses <= votingOpens
  )
    throw res.send(503, {
      message: "Product Plus voting deadlines are not configured"
    });
  return config as Config;
};

export const isVotingOpen = (config: Config, now = Date.now()) =>
  Date.parse(config.submission_deadline) <= now &&
  now < Date.parse(config.voting_deadline);

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
