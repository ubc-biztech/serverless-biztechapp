import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import res from "../../lib/responseHelpers";
import type { APIGatewayEvent, APIGatewayResponse } from "../../lib/types";

const GRAPH_BASE =
  process.env.INSTAGRAM_GRAPH_BASE || "https://graph.instagram.com/v25.0";
const ENV_ACCESS_TOKEN =
  process.env.IG_ACCESS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN;
const DEFAULT_START_DATE = process.env.IG_DEFAULT_START_DATE || "2025-08-01";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 24;
const TOKEN_RECORD_ID = "primary";
const TOKEN_TABLE_NAME = `biztechInstagramAuth${process.env.ENVIRONMENT || ""}`;
const REFRESH_LEAD_DAYS = Number(process.env.IG_REFRESH_LEAD_DAYS || 10);
const REFRESH_LEAD_MS = REFRESH_LEAD_DAYS * 24 * 60 * 60 * 1000;
const PRIMARY_MEDIA_INSIGHT_METRICS = [
  "reach",
  "likes",
  "comments",
  "saved",
  "shares",
  "views",
];
const FALLBACK_MEDIA_INSIGHT_METRICS = [
  ...PRIMARY_MEDIA_INSIGHT_METRICS,
  "plays",
  "video_views",
];

type HttpThrow = { status: number; message: string; details?: unknown };

type StoredTokenItem = {
  id: string;
  accessToken?: string;
  expiresIn?: number | null;
  expiresAt?: number | null;
  refreshedAt?: number | null;
  source?: string;
};

type TokenState = {
  token: string | null;
  source: string;
  state: StoredTokenItem | null;
};

type EnrichedPost = {
  id: string;
  caption: string;
  media_type: string;
  timestamp: string;
  permalink: string;
  metrics: Record<string, number>;
  derived: ReturnType<typeof computeDerivedMetrics>;
};

type BreakdownRow = {
  key: string;
  posts: number;
  reach: number;
  likes: number;
  comments: number;
  saved: number;
  shares: number;
  views: number;
  engagement: number;
  avgReachPerPost: number;
  avgEngagementPerPost: number;
  engagementRateByReach: number;
  saveRateByReach?: number;
  shareRateByReach?: number;
};

const cache = new Map<string, { createdAt: number; payload: unknown }>();
let hasLoggedTokenStoreError = false;

const createResponse = (statusCode: number, body?: unknown): APIGatewayResponse =>
  res.send(statusCode, body);

const errorStatus = (error: unknown): number =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof (error as { status: unknown }).status === "number"
    ? (error as { status: number }).status
    : 500;

const errorMessage = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof (error as { message: unknown }).message === "string"
    ? (error as { message: string }).message
    : error instanceof Error
      ? error.message
      : "Unknown error";

const errorDetails = (error: unknown): unknown | undefined =>
  typeof error === "object" && error !== null && "details" in error
    ? (error as { details: unknown }).details
    : undefined;

const toDateISO = (date: Date): string => date.toISOString().slice(0, 10);

const isValidDateString = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const parseDateOrThrow = (value: string, endOfDay = false): Date => {
  if (!isValidDateString(value)) {
    throw {
      status: 406,
      message: `Invalid date format '${value}'. Expected YYYY-MM-DD.`,
    } satisfies HttpThrow;
  }

  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}Z`);
  if (Number.isNaN(date.getTime())) {
    throw {
      status: 406,
      message: `Invalid date value '${value}'.`,
    } satisfies HttpThrow;
  }

  return date;
};

const logTokenStoreErrorOnce = (message: string, error: unknown): void => {
  if (hasLoggedTokenStoreError) return;
  hasLoggedTokenStoreError = true;
  const errMsg =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  console.warn("[instagram analytics] token store unavailable:", message, errMsg);
};

const readStoredTokenState = async (): Promise<StoredTokenItem | null> => {
  try {
    const command = new GetCommand({
      TableName: TOKEN_TABLE_NAME,
      Key: {
        id: TOKEN_RECORD_ID,
      },
    });
    const result = await docClient.send(command);
    return (result?.Item as StoredTokenItem | undefined) || null;
  } catch (error) {
    logTokenStoreErrorOnce("read failed", error);
    return null;
  }
};

const writeStoredTokenState = async (args: {
  accessToken: string;
  expiresIn: number | null;
  source?: string;
}): Promise<StoredTokenItem> => {
  const now = Date.now();
  const expiresAt =
    typeof args.expiresIn === "number" && Number.isFinite(args.expiresIn)
      ? now + args.expiresIn * 1000
      : null;

  const item: StoredTokenItem = {
    id: TOKEN_RECORD_ID,
    accessToken: args.accessToken,
    expiresIn: typeof args.expiresIn === "number" ? args.expiresIn : null,
    expiresAt,
    refreshedAt: now,
    source: args.source || "refresh",
  };

  const command = new PutCommand({
    TableName: TOKEN_TABLE_NAME,
    Item: item as Record<string, unknown>,
  });
  await docClient.send(command);
  return item;
};

const getCurrentTokenState = async (): Promise<TokenState> => {
  const stored = await readStoredTokenState();
  if (stored?.accessToken) {
    return {
      token: stored.accessToken,
      source: "stored",
      state: stored,
    };
  }

  if (ENV_ACCESS_TOKEN) {
    return {
      token: ENV_ACCESS_TOKEN,
      source: "env",
      state: null,
    };
  }

  return {
    token: null,
    source: "missing",
    state: null,
  };
};

const makeRequest = async (
  urlOrPath: string,
  params: Record<string, string | number | undefined | null> | null = null,
  accessToken: string | null | undefined = ENV_ACCESS_TOKEN,
): Promise<Record<string, unknown>> => {
  const url = urlOrPath.startsWith("http")
    ? new URL(urlOrPath)
    : new URL(`${GRAPH_BASE}/${urlOrPath}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  if (!url.searchParams.has("access_token")) {
    if (!accessToken) {
      throw {
        status: 500,
        message: "Instagram access token is not configured on the server.",
      } satisfies HttpThrow;
    }
    url.searchParams.set("access_token", accessToken);
  }

  const response = await fetch(url.toString());
  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    payload = { message: raw };
  }

  if (!response.ok) {
    const errObj = payload.error as { message?: string } | undefined;
    const msgObj = payload.message as string | undefined;
    throw {
      status: response.status,
      message:
        errObj?.message ||
        msgObj ||
        "Instagram API request failed.",
      details: payload,
    } satisfies HttpThrow;
  }

  return payload;
};

const getMe = async (
  accessToken: string,
): Promise<{ user_id: string; [key: string]: unknown }> => {
  const raw = await makeRequest(
    "me",
    {
      fields: "user_id,username,account_type,followers_count,media_count",
    },
    accessToken,
  );
  return raw as { user_id: string; [key: string]: unknown };
};

const getUserInsights = async (
  igUserId: string,
  metric: string,
  period: string,
  since: string,
  until: string,
  accessToken: string,
): Promise<unknown[]> => {
  const response = await makeRequest(
    `${igUserId}/insights`,
    {
      metric,
      period,
      since,
      until,
    },
    accessToken,
  );
  return (response.data as unknown[]) || [];
};

const getAllMedia = async (
  igUserId: string,
  sinceDate: Date,
  accessToken: string,
): Promise<
  Array<{
    id: string;
    caption?: string;
    media_type: string;
    timestamp: string;
    permalink: string;
  }>
> => {
  let nextUrl: string | null = `${GRAPH_BASE}/${igUserId}/media`;
  const posts: Array<{
    id: string;
    caption?: string;
    media_type: string;
    timestamp: string;
    permalink: string;
  }> = [];

  while (nextUrl) {
    const requestParams = nextUrl.includes("?")
      ? null
      : {
          fields: "id,caption,media_type,timestamp,permalink",
          limit: 50,
        };

    const response = await makeRequest(nextUrl, requestParams, accessToken);

    const batch = (response.data as typeof posts) || [];
    for (const post of batch) {
      const ts = new Date(post.timestamp);
      if (ts < sinceDate) {
        return posts;
      }
      posts.push(post);
    }

    const paging = response.paging as { next?: string } | undefined;
    nextUrl = paging?.next || null;
  }

  return posts;
};

const getMediaInsights = async (
  mediaId: string,
  accessToken: string,
): Promise<
  Array<{
    name?: string;
    values?: Array<{ value?: unknown }>;
  }>
> => {
  try {
    const response = await makeRequest(
      `${mediaId}/insights`,
      {
        metric: PRIMARY_MEDIA_INSIGHT_METRICS.join(","),
      },
      accessToken,
    );
    return (response.data as Array<{ name?: string; values?: Array<{ value?: unknown }> }>) || [];
  } catch {
    const settled = await Promise.allSettled(
      FALLBACK_MEDIA_INSIGHT_METRICS.map(async (metric) => {
        const response = await makeRequest(
          `${mediaId}/insights`,
          { metric },
          accessToken,
        );
        return (response.data as Array<{ name?: string; values?: Array<{ value?: unknown }> }>) || [];
      }),
    );

    const flattened: Array<{ name?: string; values?: Array<{ value?: unknown }> }> =
      [];
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      flattened.push(...(result.value || []));
    }

    if (!flattened.length) return [];

    const deduped = new Map<string, { name?: string; values?: Array<{ value?: unknown }> }>();
    for (const row of flattened) {
      if (!row?.name) continue;
      deduped.set(row.name, row);
    }
    return Array.from(deduped.values());
  }
};

const metricMap = (
  insights: Array<{ name?: string; values?: Array<{ value?: unknown }> }> | undefined,
): Record<string, number> => {
  const output: Record<string, number> = {};
  for (const metric of insights || []) {
    const value = metric?.values?.[0]?.value;
    const normalizedName =
      metric?.name === "plays" || metric?.name === "video_views"
        ? "views"
        : metric?.name;
    if (!normalizedName) continue;
    const numericValue = typeof value === "number" ? value : 0;
    if (normalizedName === "views") {
      output.views = Math.max(output.views || 0, numericValue);
    } else {
      output[normalizedName] = numericValue;
    }
  }
  return output;
};

const sumDailyInsightValues = (
  insightData: Array<{ values?: Array<{ value?: unknown }> }> | undefined,
): number => {
  let total = 0;
  for (const metric of insightData || []) {
    for (const point of metric?.values || []) {
      if (typeof point?.value === "number") {
        total += point.value;
      }
    }
  }
  return total;
};

const computeDerivedMetrics = (metrics: Record<string, number>) => {
  const engagement =
    (metrics.likes || 0) +
    (metrics.comments || 0) +
    (metrics.saved || 0) +
    (metrics.shares || 0);
  const reach = metrics.reach || 0;
  const views = metrics.views || 0;

  return {
    engagement,
    engagementRateByReach: reach > 0 ? engagement / reach : 0,
    saveRateByReach: reach > 0 ? (metrics.saved || 0) / reach : 0,
    shareRateByReach: reach > 0 ? (metrics.shares || 0) / reach : 0,
    likeRateByReach: reach > 0 ? (metrics.likes || 0) / reach : 0,
    commentRateByReach: reach > 0 ? (metrics.comments || 0) / reach : 0,
    viewToReachRatio: reach > 0 ? views / reach : 0,
  };
};

const monthlyRollup = (posts: EnrichedPost[]) => {
  const buckets: Record<
    string,
    {
      month: string;
      posts: number;
      reach: number;
      likes: number;
      comments: number;
      saved: number;
      shares: number;
      views: number;
      engagement: number;
    }
  > = {};

  for (const post of posts) {
    const month = post.timestamp.slice(0, 7);
    const { metrics, derived } = post;

    if (!buckets[month]) {
      buckets[month] = {
        month,
        posts: 0,
        reach: 0,
        likes: 0,
        comments: 0,
        saved: 0,
        shares: 0,
        views: 0,
        engagement: 0,
      };
    }

    buckets[month].posts += 1;
    buckets[month].reach += metrics.reach || 0;
    buckets[month].likes += metrics.likes || 0;
    buckets[month].comments += metrics.comments || 0;
    buckets[month].saved += metrics.saved || 0;
    buckets[month].shares += metrics.shares || 0;
    buckets[month].views += metrics.views || 0;
    buckets[month].engagement += derived.engagement || 0;
  }

  return Object.values(buckets)
    .map((row) => ({
      ...row,
      avgReachPerPost: row.posts ? row.reach / row.posts : 0,
      avgEngagementPerPost: row.posts ? row.engagement / row.posts : 0,
      engagementRateByReach: row.reach ? row.engagement / row.reach : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
};

const breakdownBy = (
  posts: EnrichedPost[],
  keyFn: (post: EnrichedPost) => string,
): BreakdownRow[] => {
  const buckets: Record<string, Omit<BreakdownRow, "avgReachPerPost" | "avgEngagementPerPost" | "engagementRateByReach" | "saveRateByReach" | "shareRateByReach">> =
    {};

  for (const post of posts) {
    const key = keyFn(post);
    const { metrics, derived } = post;

    if (!buckets[key]) {
      buckets[key] = {
        key,
        posts: 0,
        reach: 0,
        likes: 0,
        comments: 0,
        saved: 0,
        shares: 0,
        views: 0,
        engagement: 0,
      };
    }

    buckets[key].posts += 1;
    buckets[key].reach += metrics.reach || 0;
    buckets[key].likes += metrics.likes || 0;
    buckets[key].comments += metrics.comments || 0;
    buckets[key].saved += metrics.saved || 0;
    buckets[key].shares += metrics.shares || 0;
    buckets[key].views += metrics.views || 0;
    buckets[key].engagement += derived.engagement || 0;
  }

  return Object.values(buckets).map((row) => ({
    ...row,
    avgReachPerPost: row.posts ? row.reach / row.posts : 0,
    avgEngagementPerPost: row.posts ? row.engagement / row.posts : 0,
    engagementRateByReach: row.reach ? row.engagement / row.reach : 0,
    saveRateByReach: row.reach ? row.saved / row.reach : 0,
    shareRateByReach: row.reach ? row.shares / row.reach : 0,
  }));
};

const getWeekdayName = (timestamp: string): string =>
  new Date(timestamp).toLocaleDateString("en-US", { weekday: "short" });

const getHourBucket = (timestamp: string): string => {
  const hour = new Date(timestamp).getHours();
  return `${String(hour).padStart(2, "0")}:00`;
};

const sortTop = (
  posts: EnrichedPost[],
  valueFn: (post: EnrichedPost) => number,
  limit = 5,
): EnrichedPost[] =>
  [...posts].sort((a, b) => valueFn(b) - valueFn(a)).slice(0, limit);

const mapWithConcurrency = async <T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 6,
): Promise<R[]> => {
  const output: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({
    length: Math.min(concurrency, items.length),
  }).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  });

  await Promise.all(workers);
  return output;
};

const setCache = (key: string, payload: unknown): void => {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }

  cache.set(key, {
    createdAt: Date.now(),
    payload,
  });
};

const getCached = (key: string): unknown | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.payload;
};

const refreshLongLivedAccessToken = async (
  currentToken: string,
): Promise<{ accessToken: string; expiresIn: number | null }> => {
  const response = await makeRequest(
    "refresh_access_token",
    {
      grant_type: "ig_refresh_token",
    },
    currentToken,
  );

  const accessToken = response.access_token as string | undefined;
  if (!accessToken) {
    throw {
      status: 500,
      message:
        "Instagram token refresh succeeded but no access_token was returned.",
      details: response,
    } satisfies HttpThrow;
  }

  return {
    accessToken,
    expiresIn:
      typeof response.expires_in === "number"
        ? (response.expires_in as number)
        : Number(response.expires_in as string | number | undefined) || null,
  };
};

const buildRefreshResponse = (
  storedToken: StoredTokenItem | null,
  previousSource: string,
) => {
  const expiresAtIso = storedToken?.expiresAt
    ? new Date(storedToken.expiresAt).toISOString()
    : null;
  const refreshedAtIso = storedToken?.refreshedAt
    ? new Date(storedToken.refreshedAt).toISOString()
    : null;

  return {
    message: "Instagram access token refreshed successfully.",
    previousSource,
    expiresIn: storedToken?.expiresIn || null,
    expiresAt: expiresAtIso,
    refreshedAt: refreshedAtIso,
  };
};

const instagramHelpers = {
  async refreshTokenManual(): Promise<APIGatewayResponse> {
    try {
      const { token, source } = await getCurrentTokenState();
      if (!token) {
        return createResponse(500, {
          message: "Instagram access token is not configured on the server.",
        });
      }

      const refreshed = await refreshLongLivedAccessToken(token);
      const stored = await writeStoredTokenState({
        accessToken: refreshed.accessToken,
        expiresIn: refreshed.expiresIn,
        source: "manual_refresh",
      });
      cache.clear();

      return createResponse(200, buildRefreshResponse(stored, source));
    } catch (error) {
      console.error("[instagram analytics] manual token refresh error", error);
      return createResponse(errorStatus(error), {
        message: errorMessage(error) || "Failed to refresh Instagram access token.",
        details: errorDetails(error),
      });
    }
  },

  async refreshTokenScheduled(): Promise<APIGatewayResponse> {
    try {
      const { token, source, state } = await getCurrentTokenState();
      if (!token) {
        return createResponse(200, {
          skipped: true,
          reason: "No token configured.",
        });
      }

      if (state?.expiresAt) {
        const remainingMs = state.expiresAt - Date.now();
        if (remainingMs > REFRESH_LEAD_MS) {
          const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
          return createResponse(200, {
            skipped: true,
            reason: `Token not due for refresh yet (${remainingDays} day(s) remaining).`,
          });
        }
      }

      const refreshed = await refreshLongLivedAccessToken(token);
      const stored = await writeStoredTokenState({
        accessToken: refreshed.accessToken,
        expiresIn: refreshed.expiresIn,
        source: "scheduled_refresh",
      });
      cache.clear();

      return createResponse(200, {
        ...buildRefreshResponse(stored, source),
        scheduled: true,
      });
    } catch (error) {
      console.error("[instagram analytics] scheduled token refresh error", error);
      return createResponse(errorStatus(error), {
        message: errorMessage(error) || "Failed to refresh Instagram access token.",
        details: errorDetails(error),
      });
    }
  },

  async getTokenStatus(): Promise<APIGatewayResponse> {
    try {
      const { token, source, state } = await getCurrentTokenState();
      const now = Date.now();
      const expiresAt = state?.expiresAt || null;
      const remainingMs = expiresAt ? expiresAt - now : null;

      return createResponse(200, {
        configured: Boolean(token),
        source,
        refreshLeadDays: REFRESH_LEAD_DAYS,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        refreshedAt: state?.refreshedAt
          ? new Date(state.refreshedAt).toISOString()
          : null,
        daysRemaining:
          typeof remainingMs === "number"
            ? Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))
            : null,
        dueForRefresh:
          typeof remainingMs === "number"
            ? remainingMs <= REFRESH_LEAD_MS
            : source === "env",
      });
    } catch (error) {
      console.error("[instagram analytics] token status error", error);
      return createResponse(errorStatus(error), {
        message: errorMessage(error) || "Failed to fetch Instagram token status.",
        details: errorDetails(error),
      });
    }
  },

  async getAnalytics(event: APIGatewayEvent): Promise<APIGatewayResponse> {
    try {
      const { token: accessToken } = await getCurrentTokenState();

      if (!accessToken) {
        return createResponse(500, {
          message: "Instagram access token is not configured on the server.",
        });
      }

      const query = event.queryStringParameters || {};

      const requestedSince = isValidDateString(query.since)
        ? query.since
        : DEFAULT_START_DATE;
      const requestedUntil = isValidDateString(query.until)
        ? query.until
        : toDateISO(new Date());

      const sinceDate = parseDateOrThrow(requestedSince, false);
      const untilDate = parseDateOrThrow(requestedUntil, true);

      if (sinceDate > untilDate) {
        return createResponse(406, {
          message: "'since' must be on or before 'until'.",
        });
      }

      const daySpan = Math.ceil(
        (untilDate.getTime() - sinceDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daySpan > 730) {
        return createResponse(406, {
          message: "Date range is too large. Please select 730 days or fewer.",
        });
      }

      const cacheKey = `${requestedSince}:${requestedUntil}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return createResponse(200, {
          ...(cached as Record<string, unknown>),
          fromCache: true,
        });
      }

      const account = await getMe(accessToken);
      const igUserId = account.user_id;

      const [reachData, followerCountData, media] = await Promise.all([
        getUserInsights(
          igUserId,
          "reach",
          "day",
          requestedSince,
          requestedUntil,
          accessToken,
        ),
        getUserInsights(
          igUserId,
          "follower_count",
          "day",
          requestedSince,
          requestedUntil,
          accessToken,
        ),
        getAllMedia(igUserId, sinceDate, accessToken),
      ]);

      const filteredMedia = media.filter((post) => {
        const ts = new Date(post.timestamp);
        return ts >= sinceDate && ts <= untilDate;
      });

      const posts = await mapWithConcurrency(filteredMedia, async (post) => {
        const insights = await getMediaInsights(post.id, accessToken);
        const metrics = metricMap(insights);
        const derived = computeDerivedMetrics(metrics);

        return {
          id: post.id,
          caption: post.caption || "",
          media_type: post.media_type,
          timestamp: post.timestamp,
          permalink: post.permalink,
          metrics,
          derived,
        } satisfies EnrichedPost;
      });

      posts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const totals: Record<string, number> = {
        posts: posts.length,
        accountReach: sumDailyInsightValues(reachData as Array<{ values?: Array<{ value?: unknown }> }>),
        netFollowers: sumDailyInsightValues(
          followerCountData as Array<{ values?: Array<{ value?: unknown }> }>,
        ),
        postReach: posts.reduce(
          (sum, post) => sum + (post.metrics.reach || 0),
          0,
        ),
        likes: posts.reduce((sum, post) => sum + (post.metrics.likes || 0), 0),
        comments: posts.reduce(
          (sum, post) => sum + (post.metrics.comments || 0),
          0,
        ),
        saved: posts.reduce((sum, post) => sum + (post.metrics.saved || 0), 0),
        shares: posts.reduce((sum, post) => sum + (post.metrics.shares || 0), 0),
        views: posts.reduce((sum, post) => sum + (post.metrics.views || 0), 0),
        engagement: posts.reduce(
          (sum, post) => sum + (post.derived.engagement || 0),
          0,
        ),
      };
      totals.avgReachPerPost = totals.posts ? totals.postReach / totals.posts : 0;
      totals.avgEngagementPerPost = totals.posts
        ? totals.engagement / totals.posts
        : 0;
      totals.engagementRateByReach = totals.postReach
        ? totals.engagement / totals.postReach
        : 0;
      totals.likeRateByReach = totals.postReach
        ? totals.likes / totals.postReach
        : 0;
      totals.commentRateByReach = totals.postReach
        ? totals.comments / totals.postReach
        : 0;
      totals.saveRateByReach = totals.postReach
        ? totals.saved / totals.postReach
        : 0;
      totals.shareRateByReach = totals.postReach
        ? totals.shares / totals.postReach
        : 0;
      totals.viewToReachRatio = totals.postReach
        ? totals.views / totals.postReach
        : 0;
      totals.avgLikesPerPost = totals.posts ? totals.likes / totals.posts : 0;
      totals.avgCommentsPerPost = totals.posts
        ? totals.comments / totals.posts
        : 0;
      totals.avgViewsPerPost = totals.posts ? totals.views / totals.posts : 0;

      const mediaTypeBreakdown = breakdownBy(
        posts,
        (post) => post.media_type,
      ).sort((a, b) => b.avgReachPerPost - a.avgReachPerPost);

      const weekdayOrder = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const weekdayBreakdown = breakdownBy(posts, (post) =>
        getWeekdayName(post.timestamp),
      ).sort(
        (a, b) => weekdayOrder.indexOf(a.key) - weekdayOrder.indexOf(b.key),
      );

      const hourBreakdown = breakdownBy(posts, (post) =>
        getHourBucket(post.timestamp),
      ).sort((a, b) => a.key.localeCompare(b.key));

      const topPosts = {
        byReach: sortTop(posts, (post) => post.metrics.reach || 0),
        byEngagementRate: sortTop(
          posts,
          (post) => post.derived.engagementRateByReach || 0,
        ),
        bySaved: sortTop(posts, (post) => post.metrics.saved || 0),
        byShares: sortTop(posts, (post) => post.metrics.shares || 0),
      };

      const payload = {
        account,
        since: requestedSince,
        until: requestedUntil,
        totals,
        accountInsights: {
          reach: reachData,
          follower_count: followerCountData,
        },
        monthly: monthlyRollup(posts),
        mediaTypeBreakdown,
        weekdayBreakdown,
        hourBreakdown,
        topPosts,
        posts,
        fetchedAt: Date.now(),
      };

      setCache(cacheKey, payload);

      return createResponse(200, payload);
    } catch (error) {
      console.error("[instagram analytics] error", error);
      return createResponse(errorStatus(error), {
        message: errorMessage(error) || "Failed to fetch Instagram analytics.",
        details: errorDetails(error),
      });
    }
  },
};

export default instagramHelpers;
