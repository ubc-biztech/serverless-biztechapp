import { randomUUID } from "node:crypto";
import { HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CompanyProfileValidationError } from "./companyProfile";
import { CompanyProfileAccessError } from "./companyProfileAccess";
import type { CompanyProfileContext } from "./companyProfileAccess";

const region = "us-west-2";
const s3 = new S3Client({ region, requestChecksumCalculation: "WHEN_REQUIRED" });
const maxSize = 2 * 1024 * 1024;
const extensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

function isThumbnailType(value: unknown): value is keyof typeof extensions {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(extensions, value);
}

function isThumbnailSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maxSize;
}

export function readThumbnailUpload(body: string | null) {
  let value: { contentType?: unknown; size?: unknown } | null;
  try {
    value = JSON.parse(body ?? "");
  } catch {
    throw new CompanyProfileValidationError("Provide a valid JSON thumbnail upload request.");
  }
  const { contentType, size } = value ?? {};
  if (!isThumbnailType(contentType) || !isThumbnailSize(size)) {
    throw new CompanyProfileValidationError("Choose a JPEG, PNG, or WebP image up to 2 MiB.");
  }
  return { contentType, size };
}

function storageForCompany(company: CompanyProfileContext["company"]) {
  const bucket = process.env.BTX_THUMBNAIL_BUCKET;
  const stage = process.env.BTX_THUMBNAIL_STAGE;
  if (!bucket || !stage) {
    throw new CompanyProfileAccessError(503, "Company thumbnail uploads are not configured.");
  }
  const prefix = `event-thumbnails/btx/${stage}/${company.eventId}/${company.teamId}/`;
  const urlPath = prefix.split("/").map(encodeURIComponent).join("/");
  return { bucket, prefix, publicPrefix: `https://${bucket}.s3.${region}.amazonaws.com/${urlPath}` };
}

export async function signThumbnailUpload(
  company: CompanyProfileContext["company"],
  { contentType, size }: ReturnType<typeof readThumbnailUpload>,
  eventEnd: number,
) {
  const { bucket, prefix, publicPrefix } = storageForCompany(company);
  const signingDate = new Date(Date.now());
  const expiresIn = Math.min(60, Math.floor((eventEnd - signingDate.getTime()) / 1000));
  if (expiresIn < 1) {
    throw new CompanyProfileAccessError(409, "Company profile editing has closed for thumbnail uploads.");
  }
  const filename = `${randomUUID()}.${extensions[contentType]}`;
  // The browser sets Content-Length when it sends the file. Prevent reusing the URL to replace it.
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: bucket,
    Key: prefix + filename,
    ContentType: contentType,
    ContentLength: size,
    IfNoneMatch: "*",
  }), {
    signingDate,
    expiresIn,
    signableHeaders: new Set(["content-length", "content-type", "if-none-match"]),
  });
  return {
    uploadUrl,
    publicUrl: publicPrefix + filename,
    headers: { "Content-Type": contentType, "If-None-Match": "*" },
  };
}

export async function verifyCompanyThumbnail(company: CompanyProfileContext["company"], logo: string) {
  const { bucket, prefix, publicPrefix } = storageForCompany(company);
  const filename = logo.startsWith(publicPrefix) ? logo.slice(publicPrefix.length) : "";
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|png|webp)$/.test(filename)) {
    throw new CompanyProfileValidationError("Upload a thumbnail for this company.");
  }
  try {
    const object = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: prefix + filename }));
    if (isThumbnailType(object.ContentType) && isThumbnailSize(object.ContentLength) &&
        filename.endsWith(`.${extensions[object.ContentType]}`)) return;
  } catch (error) {
    // An absent object can return 403 with object-only bucket permissions.
    if (!(error instanceof S3ServiceException) || ![403, 404].includes(error.$metadata.httpStatusCode ?? 0)) {
      throw error;
    }
  }
  throw new CompanyProfileValidationError("Upload a valid company thumbnail before saving.");
}
