import helpers from "../../lib/handlerHelpers";
import docClient from "../../lib/docClient";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

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
  "views"
];
const FALLBACK_MEDIA_INSIGHT_METRICS = [
  ...PRIMARY_MEDIA_INSIGHT_METRICS,
  "plays",
  "video_views"
];

const cache = new Map();
let hasLoggedTokenStoreError = false;

const toDateISO = (date) => date.toISOString().slice(0, 10);

const isValidDateString = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const parseDateOrThrow = (value, endOfDay = false) => {
  if (!isValidDateString(value)) {
    throw {
      status: 406,
      message: `Invalid date format '${value}'. Expected YYYY-MM-DD.`
    };
  }

  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}Z`);
  if (Number.isNaN(date.getTime())) {
    throw {
      status: 406,
      message: `Invalid date value '${value}'.`
    };
  }

  return date;
};

const logTokenStoreErrorOnce = (message, error) => {
  if (hasLoggedTokenStoreError) return;
  hasLoggedTokenStoreError = true;
  console.warn(
    "[instagram analytics] token store unavailable:",
    message,
    error?.message || error
  );
};

const readStoredTokenState = async () => {
  try {
    const command = new GetCommand({
      TableName: TOKEN_TABLE_NAME,
      Key: {
        id: TOKEN_RECORD_ID
      }
    });
    const result = await docClient.send(command);
    return result?.Item || null;
  } catch (error) {
    logTokenStoreErrorOnce("read failed", error);
    return null;
  }
};

const writeStoredTokenState = async ({ accessToken, expiresIn, source }) => {
  const now = Date.now();
  const expiresAt =
    typeof expiresIn === "number" && Number.isFinite(expiresIn)
      ? now + expiresIn * 1000
      : null;

  const item = {
    id: TOKEN_RECORD_ID,
    accessToken,
    expiresIn: typeof expiresIn === "number" ? expiresIn : null,
    expiresAt,
    refreshedAt: now,
    source: source || "refresh"
  };

  const command = new PutCommand({
    TableName: TOKEN_TABLE_NAME,
    Item: item
  });
  await docClient.send(command);
  return item;
};

const getCurrentTokenState = async () => {
  const stored = await readStoredTokenState();
  if (stored?.accessToken) {
    return {
      token: stored.accessToken,
      source: "stored",
      state: stored
    };
  }

  if (ENV_ACCESS_TOKEN) {
    return {
      token: ENV_ACCESS_TOKEN,
      source: "env",
      state: null
    };
  }

  return {
    token: null,
    source: "missing",
    state: null
  };
};

const makeRequest = async (
  urlOrPath,
  params = null,
  accessToken = ENV_ACCESS_TOKEN
) => {
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
        message: "Instagram access token is not configured on the server."
      };
    }
    url.searchParams.set("access_token", accessToken);
  }

  const response = await fetch(url.toString());
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { message: raw };
  }

  if (!response.ok) {
    throw {
      status: response.status,
      message:
        payload?.error?.message ||
        payload?.message ||
        "Instagram API request failed.",
      details: payload
    };
  }

  return payload;
};

const getMe = async (accessToken) => {
  return makeRequest(
    "me",
    {
      fields: "user_id,username,account_type,followers_count,media_count"
    },
    accessToken
  );
};

const getUserInsights = async (
  igUserId,
  metric,
  period,
  since,
  until,
  accessToken
) => {
  const response = await makeRequest(
    `${igUserId}/insights`,
    {
      metric,
      period,
      since,
      until
    },
    accessToken
  );
  return response?.data || [];
};

const getAllMedia = async (igUserId, sinceDate, accessToken) => {
  let nextUrl = `${GRAPH_BASE}/${igUserId}/media`;
  const posts = [];

  while (nextUrl) {
    const requestParams = nextUrl.includes("?")
      ? null
      : {
          fields: "id,caption,media_type,timestamp,permalink",
          limit: 50
        };

    const response = await makeRequest(nextUrl, requestParams, accessToken);

    const batch = response?.data || [];
    for (const post of batch) {
      const ts = new Date(post.timestamp);
      if (ts < sinceDate) {
        return posts;
      }
      posts.push(post);
    }

    nextUrl = response?.paging?.next || null;
  }

  return posts;
};

const getMediaInsights = async (mediaId, accessToken) => {
  try {
    const response = await makeRequest(
      `${mediaId}/insights`,
      {
        metric: PRIMARY_MEDIA_INSIGHT_METRICS.join(",")
      },
      accessToken
    );
    return response?.data || [];
  } catch {
    // some media types reject mixed metric requests so we fallback to individual metric requests if the batch request fails
    const settled = await Promise.allSettled(
      FALLBACK_MEDIA_INSIGHT_METRICS.map(async (metric) => {
        const response = await makeRequest(
          `${mediaId}/insights`,
          { metric },
          accessToken
        );
        return response?.data || [];
      })
    );

    const flattened = [];
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      flattened.push(...(result.value || []));
    }

    if (!flattened.length) return [];

    const deduped = new Map();
    for (const row of flattened) {
      if (!row?.name) continue;
      deduped.set(row.name, row);
    }
    return Array.from(deduped.values());
  }
};

const metricMap = (insights) => {
  const output = {};
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

const sumDailyInsightValues = (insightData) => {
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

const computeDerivedMetrics = (metrics) => {
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
    viewToReachRatio: reach > 0 ? views / reach : 0
  };
};

const monthlyRollup = (posts) => {
  const buckets = {};

  for (const post of posts) {
    const month = post.timestamp.slice(0, 7);
    const metrics = post.metrics || {};
    const derived = post.derived || {};

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
        engagement: 0
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
      engagementRateByReach: row.reach ? row.engagement / row.reach : 0
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
};

const breakdownBy = (posts, keyFn) => {
  const buckets = {};

  for (const post of posts) {
    const key = keyFn(post);
    const metrics = post.metrics || {};
    const derived = post.derived || {};

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
        engagement: 0
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
    shareRateByReach: row.reach ? row.shares / row.reach : 0
  }));
};

const getWeekdayName = (timestamp) =>
  new Date(timestamp).toLocaleDateString("en-US", { weekday: "short" });

const getHourBucket = (timestamp) => {
  const hour = new Date(timestamp).getHours();
  return `${String(hour).padStart(2, "0")}:00`;
};

const sortTop = (posts, valueFn, limit = 5) =>
  [...posts].sort((a, b) => valueFn(b) - valueFn(a)).slice(0, limit);

const mapWithConcurrency = async (items, worker, concurrency = 6) => {
  const output = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({
    length: Math.min(concurrency, items.length)
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

const setCache = (key, payload) => {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }

  cache.set(key, {
    createdAt: Date.now(),
    payload
  });
};

const getCached = (key) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.payload;
};

const refreshLongLivedAccessToken = async (currentToken) => {
  const response = await makeRequest(
    "refresh_access_token",
    {
      grant_type: "ig_refresh_token"
    },
    currentToken
  );

  if (!response?.access_token) {
    throw {
      status: 500,
      message:
        "Instagram token refresh succeeded but no access_token was returned.",
      details: response
    };
  }

  return {
    accessToken: response.access_token,
    expiresIn:
      typeof response.expires_in === "number"
        ? response.expires_in
        : Number(response.expires_in) || null
  };
};

const buildRefreshResponse = (storedToken, previousSource) => {
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
    refreshedAt: refreshedAtIso
  };
};

export const refreshTokenManual = async () => {
  try {
    const { token, source } = await getCurrentTokenState();
    if (!token) {
      return helpers.createResponse(500, {
        message: "Instagram access token is not configured on the server."
      });
    }

    const refreshed = await refreshLongLivedAccessToken(token);
    const stored = await writeStoredTokenState({
      accessToken: refreshed.accessToken,
      expiresIn: refreshed.expiresIn,
      source: "manual_refresh"
    });
    cache.clear();

    return helpers.createResponse(200, buildRefreshResponse(stored, source));
  } catch (error) {
    console.error("[instagram analytics] manual token refresh error", error);
    return helpers.createResponse(error.status || 500, {
      message: error.message || "Failed to refresh Instagram access token.",
      details: error.details || undefined
    });
  }
};

export const refreshTokenScheduled = async () => {
  try {
    const { token, source, state } = await getCurrentTokenState();
    if (!token) {
      return helpers.createResponse(200, {
        skipped: true,
        reason: "No token configured."
      });
    }

    if (state?.expiresAt) {
      const remainingMs = state.expiresAt - Date.now();
      if (remainingMs > REFRESH_LEAD_MS) {
        const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
        return helpers.createResponse(200, {
          skipped: true,
          reason: `Token not due for refresh yet (${remainingDays} day(s) remaining).`
        });
      }
    }

    const refreshed = await refreshLongLivedAccessToken(token);
    const stored = await writeStoredTokenState({
      accessToken: refreshed.accessToken,
      expiresIn: refreshed.expiresIn,
      source: "scheduled_refresh"
    });
    cache.clear();

    return helpers.createResponse(200, {
      ...buildRefreshResponse(stored, source),
      scheduled: true
    });
  } catch (error) {
    console.error("[instagram analytics] scheduled token refresh error", error);
    return helpers.createResponse(error.status || 500, {
      message: error.message || "Failed to refresh Instagram access token.",
      details: error.details || undefined
    });
  }
};

export const getTokenStatus = async () => {
  try {
    const { token, source, state } = await getCurrentTokenState();
    const now = Date.now();
    const expiresAt = state?.expiresAt || null;
    const remainingMs = expiresAt ? expiresAt - now : null;

    return helpers.createResponse(200, {
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
          : source === "env"
    });
  } catch (error) {
    console.error("[instagram analytics] token status error", error);
    return helpers.createResponse(error.status || 500, {
      message: error.message || "Failed to fetch Instagram token status.",
      details: error.details || undefined
    });
  }
};

export const getAnalytics = async (event) => {
  try {
    const { token: accessToken } = await getCurrentTokenState();

    if (!accessToken) {
      return helpers.createResponse(500, {
        message: "Instagram access token is not configured on the server."
      });
    }

    const query = event?.queryStringParameters || {};

    const requestedSince = isValidDateString(query.since)
      ? query.since
      : DEFAULT_START_DATE;
    const requestedUntil = isValidDateString(query.until)
      ? query.until
      : toDateISO(new Date());

    const sinceDate = parseDateOrThrow(requestedSince, false);
    const untilDate = parseDateOrThrow(requestedUntil, true);

    if (sinceDate > untilDate) {
      return helpers.createResponse(406, {
        message: "'since' must be on or before 'until'."
      });
    }

    const daySpan = Math.ceil(
      (untilDate.getTime() - sinceDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daySpan > 730) {
      return helpers.createResponse(406, {
        message: "Date range is too large. Please select 730 days or fewer."
      });
    }

    const cacheKey = `${requestedSince}:${requestedUntil}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return helpers.createResponse(200, {
        ...cached,
        fromCache: true
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
        accessToken
      ),
      getUserInsights(
        igUserId,
        "follower_count",
        "day",
        requestedSince,
        requestedUntil,
        accessToken
      ),
      getAllMedia(igUserId, sinceDate, accessToken)
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
        derived
      };
    });

    posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const totals = {
      posts: posts.length,
      accountReach: sumDailyInsightValues(reachData),
      netFollowers: sumDailyInsightValues(followerCountData),
      postReach: posts.reduce(
        (sum, post) => sum + (post.metrics.reach || 0),
        0
      ),
      likes: posts.reduce((sum, post) => sum + (post.metrics.likes || 0), 0),
      comments: posts.reduce(
        (sum, post) => sum + (post.metrics.comments || 0),
        0
      ),
      saved: posts.reduce((sum, post) => sum + (post.metrics.saved || 0), 0),
      shares: posts.reduce((sum, post) => sum + (post.metrics.shares || 0), 0),
      views: posts.reduce((sum, post) => sum + (post.metrics.views || 0), 0),
      engagement: posts.reduce(
        (sum, post) => sum + (post.derived.engagement || 0),
        0
      )
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
      (post) => post.media_type
    ).sort((a, b) => b.avgReachPerPost - a.avgReachPerPost);

    const weekdayOrder = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weekdayBreakdown = breakdownBy(posts, (post) =>
      getWeekdayName(post.timestamp)
    ).sort((a, b) => weekdayOrder.indexOf(a.key) - weekdayOrder.indexOf(b.key));

    const hourBreakdown = breakdownBy(posts, (post) =>
      getHourBucket(post.timestamp)
    ).sort((a, b) => a.key.localeCompare(b.key));

    const topPosts = {
      byReach: sortTop(posts, (post) => post.metrics.reach || 0),
      byEngagementRate: sortTop(
        posts,
        (post) => post.derived.engagementRateByReach || 0
      ),
      bySaved: sortTop(posts, (post) => post.metrics.saved || 0),
      byShares: sortTop(posts, (post) => post.metrics.shares || 0)
    };

    const payload = {
      account,
      since: requestedSince,
      until: requestedUntil,
      totals,
      accountInsights: {
        reach: reachData,
        follower_count: followerCountData
      },
      monthly: monthlyRollup(posts),
      mediaTypeBreakdown,
      weekdayBreakdown,
      hourBreakdown,
      topPosts,
      posts,
      fetchedAt: Date.now()
    };

    setCache(cacheKey, payload);

    return helpers.createResponse(200, payload);
  } catch (error) {
    console.error("[instagram analytics] error", error);
    return helpers.createResponse(error.status || 500, {
      message: error.message || "Failed to fetch Instagram analytics.",
      details: error.details || undefined
    });
  }
};
