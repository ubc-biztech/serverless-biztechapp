import db from "../../lib/db.js";
import docClient from "../../lib/docClient.js";
import res from "../../lib/responseHelpers.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type {
  Config,
  AdminSubmission,
  Rubric,
  Submission,
  SubmissionRecord
} from "./typesProductPlus.js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  PRODUCT_PLUS_RUBRIC_CRITERIA,
  PRODUCT_PLUS_RUBRIC_SCORE_MAX
} from "./constants.js";

const s3 = new S3Client({ region: "us-west-2" });

/** Convert five raw scores out of 10, in criterion order, to a weighted total out of 100. */
export const calculateRubricTotal = (scores: Readonly<Rubric["scores"]>): number =>
  PRODUCT_PLUS_RUBRIC_CRITERIA.reduce(
    (total, criterion, index) =>
      total + (scores[index] / PRODUCT_PLUS_RUBRIC_SCORE_MAX) * criterion.weight,
    0
  );

/** WF2 supplies the complete environment-selected name, including any PROD suffix. */
export const tableName = () => {
  const table = process.env.PRODUCTPLUS_SUBMISSIONS_TABLE;
  if (!table)
    throw res.send(503, {
      message: "Product Plus submissions table is not configured"
    });
  return table;
};

export const getEventKey = () => {
  const key = process.env.PRODUCTPLUS_EVENT_KEY;
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

/** Query this event only, retaining pagination and projecting no unnecessary fields. */
export async function querySubmissions(
  event_key: string,
  projection: string,
  submittedOnly = false
) {
  const rows: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "#event = :event",
        ExpressionAttributeNames: { "#event": "event_key" },
        ExpressionAttributeValues: {
          ":event": event_key,
          ...(submittedOnly ? { ":empty": "" } : {})
        },
        ProjectionExpression: projection,
        ...(submittedOnly
          ? {
              FilterExpression:
                "attribute_exists(submitted_at) AND attribute_exists(video_url) AND video_url <> :empty"
            }
          : {}),
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {})
      })
    );
    rows.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  // A Query filter cannot contain its sort key, so exclude the reserved row here.
  return rows.filter((row) => row.team_code !== "config");
}

/** Same public submission fields as WF2; an admin draft can have no PDF yet. */
export async function submissionResponse(
  record: Pick<SubmissionRecord, keyof Omit<Submission, "prd_view_url">>,
  bucket = process.env.PRODUCTPLUS_PRD_BUCKET
): Promise<AdminSubmission> {
  let prdViewUrl: string | null = null;
  if (record.prd_path) {
    if (!bucket) throw new Error("Product Plus PDF bucket is required.");
    prdViewUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: bucket,
        Key: record.prd_path,
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: 'inline; filename="prd.pdf"'
      }),
      { expiresIn: 300, signingDate: new Date() }
    );
  }
  return {
    team_code: record.team_code,
    team_name: record.team_name,
    project_title: record.project_title ?? null,
    member_names: record.member_names,
    video_url: record.video_url,
    prd_path: record.prd_path,
    prd_filename: record.prd_filename ?? null,
    prd_view_url: prdViewUrl,
    submitted_at: record.submitted_at,
    updated_at: record.updated_at
  };
}
