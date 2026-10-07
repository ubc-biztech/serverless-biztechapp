// TEMPORARY WF2 adapter: replace settings/config access with WF2's helpers.
import db from "../../lib/db.js";
import res from "../../lib/responseHelpers";
import type { Config } from "./typesProductPlus.temporary";

export const submissionsTable = () =>
  process.env.PRODUCT_PLUS_SUBMISSIONS_TABLE || "biztechPPSubmissions";

export const tableName = () => submissionsTable() + (process.env.ENVIRONMENT || "");

// TEMPORARY: replace with WF2's PRD view signer when it merges.
export const getPrdViewUrl = async (prd_path: string): Promise<string> => {
  if (!prd_path) throw new Error("Submission has no PRD path");
  // Load signing dependencies only when a PRD view URL is requested.
  const [{ S3Client, GetObjectCommand }, { getSignedUrl }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/s3-request-presigner")
  ]);
  const client = new S3Client({ region: process.env.AWS_REGION || "us-west-2" });
  const command = new GetObjectCommand({
    Bucket: process.env.ENVIRONMENT === "PROD" ? "biztech-pp-prd-prod" : "biztech-pp-prd",
    Key: prd_path
  });
  return getSignedUrl(client, command, { expiresIn: 15 * 60 });
};

export const getEventKey = () => {
  const key = process.env.PRODUCT_PLUS_EVENT_KEY;
  if (!key) throw res.send(503, { message: "Product Plus event is not configured" });
  return key;
};

export const getVotingConfig = async (event_key: string): Promise<Config> => {
  const config = await db.getOneCustom({
    TableName: tableName(), Key: { event_key, team_code: "config" }, ConsistentRead: true
  });
  const votingOpens = Date.parse(config?.submission_deadline);
  // TODO: Config Row in Product Plus Notion missing voting_deadline but should have according to shared types?
  const votingCloses = Date.parse(config?.voting_deadline);
  if (!Number.isFinite(votingOpens) || !Number.isFinite(votingCloses) || votingCloses <= votingOpens)
    throw res.send(503, { message: "Product Plus voting deadlines are not configured" });
  return config as Config;
};

export const isVotingOpen = (config: Config, now = Date.now()) =>
  Date.parse(config.submission_deadline) <= now && now < Date.parse(config.voting_deadline);
