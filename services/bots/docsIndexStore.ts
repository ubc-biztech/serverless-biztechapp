import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  docsBaseUrl as bundledDocsBaseUrl,
  docsChunkCount as bundledDocsChunkCount,
  docsChunks as bundledDocsChunks,
  docsIndexGeneratedAt as bundledDocsIndexGeneratedAt
} from "./docsIndex.js";

const DEFAULT_REFRESH_SECONDS = 300;
const DEFAULT_ERROR_RETRY_SECONDS = 30;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_S3_REGION = "us-west-2";
const DEFAULT_S3_KEY = "slack-docs-index/latest.json";
const DEFAULT_S3_BUCKET = "biztech-docs-index";

function normalizeForSearch(text = "") {
  return ` ${String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const docsIndexConfig = {
  bucket: String(process.env.DOCS_INDEX_S3_BUCKET || DEFAULT_S3_BUCKET).trim(),
  key: String(process.env.DOCS_INDEX_S3_KEY || DEFAULT_S3_KEY).trim(),
  region: String(
    process.env.DOCS_INDEX_S3_REGION || process.env.AWS_REGION || DEFAULT_S3_REGION
  ).trim(),
  refreshMs:
    positiveInt(
      process.env.DOCS_INDEX_REFRESH_SECONDS,
      DEFAULT_REFRESH_SECONDS
    ) * 1000,
  errorRetryMs:
    positiveInt(
      process.env.DOCS_INDEX_ERROR_RETRY_SECONDS,
      DEFAULT_ERROR_RETRY_SECONDS
    ) * 1000,
  maxBytes: positiveInt(process.env.DOCS_INDEX_MAX_BYTES, DEFAULT_MAX_BYTES)
};

const s3Client = docsIndexConfig.bucket
  ? new S3Client({ region: docsIndexConfig.region })
  : null;

function buildDocsState(payload: any, source: string, etag = "") {
  const baseUrl = String(
    payload?.docsBaseUrl || payload?.baseUrl || bundledDocsBaseUrl
  ).trim();
  const rawChunks = Array.isArray(payload?.docsChunks) ? payload.docsChunks : [];
  const docsChunks = rawChunks
    .map((chunk: any, index: number) => {
      if (!chunk || typeof chunk !== "object") return null;

      const content = String(chunk.content || "").trim();
      if (!content) return null;

      const routeRaw = String(chunk.route || "").trim();
      const route = routeRaw
        ? routeRaw.startsWith("/")
          ? routeRaw
          : `/${routeRaw}`
        : "/";
      const url = String(chunk.url || `${baseUrl}${route}`).trim();
      const title = String(chunk.title || "Untitled").trim() || "Untitled";
      const section = String(chunk.section || "Overview").trim() || "Overview";
      const searchText = String(chunk.searchText || "").trim()
        ? String(chunk.searchText)
        : normalizeForSearch(`${title}\n${section}\n${content}\n${route}`);

      return {
        id: String(chunk.id || `doc_${String(index + 1).padStart(5, "0")}`),
        route,
        url,
        title,
        section,
        content,
        searchText
      };
    })
    .filter(Boolean);

  if (!docsChunks.length) {
    throw new Error("Docs index payload does not contain valid docsChunks.");
  }

  const docsIndexGeneratedAt = String(
    payload?.docsIndexGeneratedAt || new Date().toISOString()
  );
  return {
    docsBaseUrl: baseUrl,
    docsIndexGeneratedAt,
    docsChunkCount: docsChunks.length,
    docsChunks,
    source,
    etag
  };
}

let activeDocsState = buildDocsState(
  {
    docsBaseUrl: bundledDocsBaseUrl,
    docsIndexGeneratedAt: bundledDocsIndexGeneratedAt,
    docsChunkCount: bundledDocsChunkCount,
    docsChunks: bundledDocsChunks
  },
  "bundle"
);
let refreshPromise: Promise<typeof activeDocsState> | null = null;
let nextRefreshAt = Date.now();
let lastKnownEtag = "";

async function streamToUtf8(body: any) {
  if (!body) return "";
  if (typeof body.transformToString === "function") {
    return body.transformToString("utf-8");
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    body.on("data", (chunk: any) => chunks.push(Buffer.from(chunk)));
    body.on("error", reject);
    body.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function refreshFromS3() {
  if (!s3Client || !docsIndexConfig.bucket || !docsIndexConfig.key) {
    return activeDocsState;
  }

  const head = await s3Client.send(
    new HeadObjectCommand({
      Bucket: docsIndexConfig.bucket,
      Key: docsIndexConfig.key
    })
  );

  const contentLength = Number(head.ContentLength || 0);
  if (contentLength > docsIndexConfig.maxBytes) {
    throw new Error(
      `S3 docs index too large (${contentLength} bytes > ${docsIndexConfig.maxBytes}).`
    );
  }

  // `String.prototype.replaceAll` is ES2021; tsconfig still declares lib ES2020 even though the runtime is Node 22. Cast rather than change the build config.
  const currentEtag = (String(head.ETag || "") as any).replaceAll("\"", "");
  if (currentEtag && lastKnownEtag && currentEtag === lastKnownEtag) {
    return activeDocsState;
  }

  const getResponse = await s3Client.send(
    new GetObjectCommand({
      Bucket: docsIndexConfig.bucket,
      Key: docsIndexConfig.key
    })
  );

  const payloadRaw = await streamToUtf8(getResponse.Body);
  const payload = JSON.parse(payloadRaw);
  const nextState = buildDocsState(payload, "s3", currentEtag);

  activeDocsState = nextState;
  lastKnownEtag = currentEtag || lastKnownEtag;
  console.log(
    `Loaded docs index from s3://${docsIndexConfig.bucket}/${docsIndexConfig.key} (${nextState.docsChunkCount} chunks).`
  );
  return activeDocsState;
}

export async function ensureDocsIndexLoaded(options: { forceRefresh?: boolean } = {}) {
  const forceRefresh = Boolean(options.forceRefresh);

  if (!s3Client) {
    return activeDocsState;
  }

  const now = Date.now();
  if (!forceRefresh && now < nextRefreshAt) {
    return activeDocsState;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    let hadError = false;
    try {
      return await refreshFromS3();
    } catch (error) {
      hadError = true;
      console.error(
        `Failed to refresh docs index from S3; using bundled cache instead: ${(error as { message?: unknown }).message}`
      );
      return activeDocsState;
    } finally {
      nextRefreshAt = Date.now() +
        (hadError ? docsIndexConfig.errorRetryMs : docsIndexConfig.refreshMs);
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export function getDocsIndexConfig() {
  return {
    ...docsIndexConfig,
    source: activeDocsState.source,
    docsChunkCount: activeDocsState.docsChunkCount,
    docsIndexGeneratedAt: activeDocsState.docsIndexGeneratedAt,
    hasS3Config: Boolean(s3Client)
  };
}
