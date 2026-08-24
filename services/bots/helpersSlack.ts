import {
  groups,
  query,
  installationID,
  reminderChannelID,
  btFields,
  btDevs,
  scoreCommandAdmins
} from "./constants";
import { ensureDocsIndexLoaded } from "./docsIndexStore";
import db from "../../lib/db.js";
import { STORY_POINTS_TABLE } from "../../constants/tables.js";
// `jsonwebtoken` ships no type declarations and `@types/jsonwebtoken` is not installed; no dependency was added, so the import is suppressed instead.
// @ts-expect-error TS7016 Could not find a declaration file for module 'jsonwebtoken'.
import jwt from "jsonwebtoken";
import fetch from "node-fetch";

const DOCS_QA_MODEL = process.env.OPENAI_DOCS_MODEL || "gpt-5.4-mini";
const DOCS_MAX_CONTEXT_SOURCES = 8;
const DOCS_MIN_TOP_SCORE = 4;
const DOCS_REPLY_FALLBACK = "Sorry, I couldn't verify that in BizWiki docs.";
const DOCS_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your"
]);

function normalizeForSearch(text = "") {
  return ` ${String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function tokenize(text = "") {
  const tokens =
    String(text)
      .toLowerCase()
      .match(/[a-z0-9]+/g) || [];
  return tokens.filter(
    (token) => token.length > 2 && !DOCS_STOPWORDS.has(token)
  );
}

const docsSearchCache = {
  cacheKey: "",
  preparedDocsChunks: [] as any[],
  tokenIdf: new Map<string, number>()
};

function buildDocsSearchArtifacts(docsChunks: any[] = []) {
  const preparedDocsChunks = docsChunks.map((chunk) => ({
    ...chunk,
    titleSearch: normalizeForSearch(chunk.title),
    sectionSearch: normalizeForSearch(chunk.section)
  }));

  const tokenDocumentFrequency = new Map<string, number>();
  for (const chunk of preparedDocsChunks) {
    const uniqueTokens = new Set(tokenize(chunk.searchText));
    for (const token of uniqueTokens) {
      tokenDocumentFrequency.set(
        token,
        (tokenDocumentFrequency.get(token) || 0) + 1
      );
    }
  }

  const tokenIdf = new Map<string, number>(
    [...tokenDocumentFrequency.entries()].map(([token, df]) => [
      token,
      Math.log((1 + preparedDocsChunks.length) / (1 + df)) + 1
    ])
  );

  return {
    preparedDocsChunks,
    tokenIdf
  };
}

function getDocsSearchArtifacts(docsState: any) {
  const cacheKey = `${docsState.docsIndexGeneratedAt}:${docsState.docsChunkCount}:${docsState.source}:${docsState.etag || ""}`;
  if (docsSearchCache.cacheKey !== cacheKey) {
    const { preparedDocsChunks, tokenIdf } = buildDocsSearchArtifacts(
      docsState.docsChunks
    );
    docsSearchCache.cacheKey = cacheKey;
    docsSearchCache.preparedDocsChunks = preparedDocsChunks;
    docsSearchCache.tokenIdf = tokenIdf;
  }

  return {
    preparedDocsChunks: docsSearchCache.preparedDocsChunks,
    tokenIdf: docsSearchCache.tokenIdf
  };
}

function queryBigrams(tokens: string[]) {
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

function routeIntentBoost(route: string, tokenSet: Set<string>) {
  let boost = 0;

  if (route === "/docs/getting-started") {
    const setupIntent =
      tokenSet.has("setup") ||
      tokenSet.has("install") ||
      tokenSet.has("run") ||
      tokenSet.has("start") ||
      tokenSet.has("local") ||
      tokenSet.has("locally");

    if (setupIntent) boost += 10;
    if (tokenSet.has("backend")) boost += 6;
    if (tokenSet.has("frontend")) boost += 6;
  }

  return boost;
}

function scoreChunkForQuestion(
  chunk: any,
  queryNorm: string,
  queryTokens: string[],
  bigrams: string[],
  tokenIdf: Map<string, number>
) {
  const queryPhrase = queryNorm.trim();
  const searchable = chunk.searchText || normalizeForSearch(chunk.content);
  const tokenSet = new Set(queryTokens);

  let score = 0;
  if (queryPhrase.length >= 10 && searchable.includes(queryPhrase)) {
    score += 12;
  }

  for (const token of tokenSet) {
    const weight = tokenIdf.get(token) || 1;
    const needle = ` ${token} `;
    if (chunk.titleSearch.includes(needle)) score += 6 * weight;
    if (chunk.sectionSearch.includes(needle)) score += 3 * weight;
    if (searchable.includes(needle)) score += weight;
  }

  for (const bigram of bigrams) {
    const phrase = ` ${bigram} `;
    if (chunk.titleSearch.includes(phrase)) score += 8;
    if (chunk.sectionSearch.includes(phrase)) score += 4;
    if (searchable.includes(phrase)) score += 2;
  }

  if (/\//.test(queryNorm) && /\//.test(chunk.content)) {
    score += 2;
  }

  score += routeIntentBoost(chunk.route, tokenSet);

  return score;
}

function retrieveTopDocsChunks(
  question: string,
  docsState: any,
  limit = DOCS_MAX_CONTEXT_SOURCES
) {
  const queryNorm = normalizeForSearch(question);
  const queryTokens = tokenize(question);
  const bigrams = queryBigrams(queryTokens);
  const { preparedDocsChunks, tokenIdf } = getDocsSearchArtifacts(docsState);

  if (!queryNorm.trim() && queryTokens.length === 0) return [];

  const scored = preparedDocsChunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunkForQuestion(
        chunk,
        queryNorm,
        queryTokens,
        bigrams,
        tokenIdf
      )
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.id.localeCompare(b.id);
    });

  const selected: any[] = [];
  const perRouteCount = new Map();

  for (const chunk of scored) {
    const routeCount = perRouteCount.get(chunk.route) || 0;
    if (routeCount >= 2) continue;
    selected.push(chunk);
    perRouteCount.set(chunk.route, routeCount + 1);
    if (selected.length >= limit) break;
  }

  return selected;
}

function formatDocsContext(sources: any[]) {
  return sources
    .map((source, index) => {
      const excerpt =
        source.content.length > 1200
          ? `${source.content.slice(0, 1197)}...`
          : source.content;
      return `[${index + 1}] ${source.title} — ${source.section}\nURL: ${
        source.url
      }\n${excerpt}`;
    })
    .join("\n\n---\n\n");
}

function extractCitationIndexes(text: string, maxIndex: number) {
  const matches = String(text).match(/\[(\d+)\]/g) || [];
  const indexes = matches
    .map((match) => Number(match.replace(/[^\d]/g, "")))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= maxIndex);

  return [...new Set(indexes)];
}

function buildNoConfidenceReply(docsBaseUrl: string, sources: any[] = []) {
  const suggested = sources
    .slice(0, 3)
    .map((source) => `• <${source.url}|${source.title}>`)
    .join("\n");

  if (!suggested) {
    return `${DOCS_REPLY_FALLBACK}\n\nBrowse BizWiki directly: <${docsBaseUrl}|${docsBaseUrl}>`;
  }

  return `${DOCS_REPLY_FALLBACK}\n\nClosest docs:\n${suggested}\n\nBrowse BizWiki directly: <${docsBaseUrl}|${docsBaseUrl}>`;
}

async function getDocsAnswerFromOpenAI(question: string, sources: any[]) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return {
      answer: "",
      error: "Missing OPENAI_API_KEY"
    };
  }

  const systemPrompt = [
    "You are BizWiki assistant for Slack for BizTech's codebase.",
    "BizTech's main application consists of two primary repositories:",
    "- bt-web-v2: the main frontend.",
    "- serverless-biztechapp-1: the backend and related services.",
    "The Judging Portal is a separate project and is NOT part of the main application.",
    "When the question is broad, general, or about onboarding, prioritize overview, setup, architecture, and API reference documentation before feature-specific documentation.",
    "For broad questions, do not answer primarily from niche feature documentation unless the question explicitly asks about that feature.",
    "For broad questions, do not try to create a complete codebase-wide summary from a small number of feature-specific excerpts.",
    "Features such as Events, NFC, Feedback, Partnerships CRM, BTX, and others are part of the main application.",
    "If a question is general (for example: setup, frontend, backend, endpoints, or local development), assume it refers to the main application unless explicitly stated otherwise.",
    "Do NOT use or mention the Judging Portal or it's documentation unless the user explicitly mentions it (for example: 'judging portal', 'judging', or 'hello hacks').",
    "Do not assume the question is about a specific feature unless it is explicitly mentioned or clearly supported by the documentation excerpts.",
    "Answer ONLY from the provided DOCUMENTATION EXCERPTS.",
    `If the excerpts do not directly support an answer, reply with exactly: "${DOCS_REPLY_FALLBACK}"`,
    "Do not use outside knowledge, inference, guesses, or assumptions about BizTech's codebase.",
    "Never invent endpoints, behavior, architecture, setup steps, examples, or implementation details.",
    "For broad or ambiguous questions, briefly state the ambiguity, then answer from the highest-level relevant documentation first.",
    "If the excerpts only partially answer the question, say what is supported and what is not clear from the docs.",
    "Every factual sentence must include citation markers like [1], [2].",
    "Citations must reference only the provided source numbers.",
    "Do not include a separate Sources section.",
    "It is better to be incomplete but correct based only on the provided documentation than complete but speculative.",
    "Avoid repeating the user's wording unless necessary."
  ].join(" ");

  const userPrompt = `Question:\n${question}\n\nDOCUMENTATION EXCERPTS:\n${formatDocsContext(
    sources
  )}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: DOCS_QA_MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ]
      })
    });

    const data: any = await response.json();

    if (!response.ok) {
      return {
        answer: "",
        error: `OpenAI error: ${
          data?.error?.message ? data.error.message : "Unknown error"
        }`
      };
    }

    return {
      answer: data?.choices?.[0]?.message?.content?.trim() || "",
      error: ""
    };
  } catch (error) {
    return {
      answer: "",
      error: "Failed to call OpenAI for docs QA."
    };
  }
}

function buildDocsReply(docsBaseUrl: string, answer: string, sources: any[]) {
  if (!answer) return buildNoConfidenceReply(docsBaseUrl, sources);

  if (answer.trim() === DOCS_REPLY_FALLBACK) {
    return buildNoConfidenceReply(docsBaseUrl, sources);
  }

  const citedIndexes = extractCitationIndexes(answer, sources.length);
  if (!citedIndexes.length) {
    return buildNoConfidenceReply(docsBaseUrl, sources);
  }

  const sourceLines = citedIndexes
    .map((index) => {
      const source = sources[index - 1];
      return `• [${index}] <${source.url}|${source.title}>`;
    })
    .join("\n");

  return `📚 *Answer from BizWiki docs*\n${answer}\n\n*Sources*\n${sourceLines}`;
}

export async function slackApi(method: string, endpoint: string, body?: any) {
  const SLACK_BOT_TOKEN = getSlackBotToken();
  if (!SLACK_BOT_TOKEN) {
    console.error("SLACK_BOT_TOKEN is missing or invalid.");
    return;
  }
  try {
    const res = await fetch(`https://slack.com/api/${endpoint}`, {
      method,
      headers: {
        "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data: any = await res.json();
    if (!data.ok) {
      console.error("Slack API Error occurred:", JSON.stringify(data));
      return;
    }
    return data;
  } catch (error) {
    console.error("Failed to call Slack API:", error);
  }
}

function getSlackBotToken() {
  const cleaned = String(process.env.SLACK_BOT_TOKEN || "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (!cleaned) return "";
  // Extract a valid Slack token and ignore accidental extra text/characters.
  const tokenMatch = cleaned.match(/xox[baprs]-[A-Za-z0-9-]+/);
  const token = tokenMatch ? tokenMatch[0] : "";
  if (!token) return "";
  if (/[^\x20-\x7E]/.test(token)) return "";
  return token;
}

function normalizeSlackUsername(username = "") {
  return String(username).trim().toLowerCase().replace(/^@/, "");
}

async function lookupSlackUsernameById(userId: string) {
  const userInfo = await slackApi("GET", `users.info?user=${userId}`);
  if (!userInfo || !userInfo.user) {
    return null;
  }

  const profile = userInfo.user.profile || {};
  const candidates = [
    userInfo.user.name,
    profile.display_name,
    profile.display_name_normalized,
    profile.real_name
  ];

  for (const candidate of candidates) {
    const normalized = normalizeSlackUsername(candidate);
    if (normalized) return normalized;
  }

  return null;
}

async function resolveCommandUsername(rawValue: any) {
  const value = String(rawValue || "").trim();
  if (!value) return null;

  const rawUserId = value.match(/^[A-Z0-9]{6,}$/i);
  if (rawUserId) {
    const lookedUp = await lookupSlackUsernameById(rawUserId[0]);
    return lookedUp || normalizeSlackUsername(rawUserId[0]);
  }

  const mentionWithName = value.match(/^<@([A-Z0-9]+)\|([^>]+)>$/i);
  if (mentionWithName) {
    return normalizeSlackUsername(mentionWithName[2]);
  }

  const mentionWithoutName = value.match(/^<@([A-Z0-9]+)>$/i);
  if (mentionWithoutName) {
    const lookedUp = await lookupSlackUsernameById(mentionWithoutName[1]);
    return lookedUp || normalizeSlackUsername(mentionWithoutName[1]);
  }

  return normalizeSlackUsername(value);
}

function parseScoreCommandText(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return { error: "Usage: `/score @username <points>`" };

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return { error: "Usage: `/score @username <points>`" };
  }

  const deltaRaw = parts[1];
  if (!/^-?\d+$/.test(deltaRaw)) {
    return { error: "Points must be an integer. Example: `/score @thomas 10`" };
  }

  return {
    targetRaw: parts[0],
    delta: Number.parseInt(deltaRaw, 10)
  };
}

async function addScoreForUser(username: string, delta: number) {
  const normalizedUser = normalizeSlackUsername(username);
  const now = Date.now();

  const result = await db.updateDBCustom({
    Key: { user: normalizedUser },
    TableName: STORY_POINTS_TABLE + (process.env.ENVIRONMENT || ""),
    UpdateExpression:
      "SET score = if_not_exists(score, :zero) + :delta, createdAt = if_not_exists(createdAt, :createdAt), updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":zero": 0,
      ":delta": delta,
      ":createdAt": now,
      ":updatedAt": now
    },
    ReturnValues: "ALL_NEW"
  });

  return result.Attributes;
}

export async function runScoreCommand(body: any) {
  const caller = await resolveCommandUsername(body.user_name || body.user_id);
  if (!caller || !scoreCommandAdmins.includes(caller)) {
    return {
      response_type: "ephemeral",
      text: "You are not allowed to use `/score`."
    };
  }

  // `parseScoreCommandText` returns one of two disjoint object shapes; annotating
  // the binding keeps every property access below legal without narrowing changes.
  const parsed: any = parseScoreCommandText(body.text);
  if (parsed.error) {
    return {
      response_type: "ephemeral",
      text: parsed.error
    };
  }

  const target = await resolveCommandUsername(parsed.targetRaw);
  if (!target) {
    return {
      response_type: "ephemeral",
      text: "Could not parse username. Example: `/score @thomas 10`"
    };
  }

  try {
    const updated = await addScoreForUser(target, parsed.delta);
    // `Attributes` is optional on the DynamoDB update output; the original JS would
    // throw a TypeError here if it were absent, so assert rather than guard.
    const newScore = Number(updated!.score || 0);
    const changePrefix = parsed.delta >= 0 ? "+" : "";

    return {
      response_type: "in_channel",
      text: `✅ Updated @${target}: ${newScore} points (${changePrefix}${parsed.delta})`
    };
  } catch (error) {
    console.error("Failed running /score:", error);
    return {
      response_type: "ephemeral",
      text: "Could not update score right now. Please try again."
    };
  }
}

export async function runLeaderboardCommand() {
  try {
    const rows = await db.scan(STORY_POINTS_TABLE);
    const leaderboard = (rows || [])
      .map((row) => ({
        username: normalizeSlackUsername(row.user),
        score: Number(row.score || 0)
      }))
      .filter((row) => row.username)
      .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));

    if (!leaderboard.length) {
      return {
        response_type: "in_channel",
        text: "🏆 *Dev story point leaderboards!*\nNo scores yet."
      };
    }

    const lines = leaderboard.map(
      (entry, index) => `${index + 1}. @${entry.username} - ${entry.score}`
    );

    return {
      response_type: "in_channel",
      text: `🏆 *Dev story point leaderboards!*\n${lines.join("\n")}`
    };
  } catch (error) {
    console.error("Failed running /leaderboard:", error);
    return {
      response_type: "ephemeral",
      text: "Could not load leaderboard right now. Please try again."
    };
  }
}

export async function openPingShortcut(body: any) {
  if (body.type !== "message_action" || body.callback_id !== "ping") {
    console.error("Invalid shortcut call:", body);
    return;
  }

  const groupOptions = Object.keys(groups).map((group) => ({
    text: {
      type: "plain_text",
      text: group,
      emoji: true
    },
    value: group
  }));

  // trigger modal
  try {
    await slackApi("POST", "views.open", {
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "ping_modal_submit",
        title: {
          type: "plain_text",
          text: "Ping Group"
        },
        submit: {
          type: "plain_text",
          text: "Send"
        },
        close: {
          type: "plain_text",
          text: "Cancel"
        },
        private_metadata: JSON.stringify({
          channel_id: body.channel.id,
          message_ts: body.message_ts,
          user_id: body.user.id
        }),
        blocks: [
          {
            type: "input",
            block_id: "group_select",
            label: {
              type: "plain_text",
              text: "Select a group"
            },
            element: {
              type: "static_select",
              action_id: "selected_group",
              placeholder: {
                type: "plain_text",
                text: "Choose a group"
              },
              options: groupOptions
            }
          }
        ]
      }
    });
  } catch (error) {
    console.error("Error opening modal:", error);
  }
}

export async function submitPingShortcut(body: any) {
  console.log("Submitting ping shortcut modal", body);
  if (
    body.type !== "view_submission" ||
    body.view.callback_id !== "ping_modal_submit"
  ) {
    console.error("Invalid modal submission:", body);
    return;
  }
  try {
    // parse data from modal submission
    const metadata = JSON.parse(body.view.private_metadata);
    const group =
      body.view.state.values.group_select.selected_group.selected_option.value;
    const user = metadata.user_id;
    const channel = metadata.channel_id;
    const message_ts = metadata.message_ts;

    const members = (groups as Record<string, string[]>)[group] || [];

    const mentions = members.map((id: string) => `<@${id}>`).join(" ");
    const message = `🔔 <@${user}> pinged *${group}*: ${mentions}`;

    // attempt to ping in thread
    await slackApi("POST", "chat.postMessage", {
      channel,
      thread_ts: message_ts,
      text: message
    });
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

export async function answerDocsQuestion(opts: any) {
  const { channel_id, thread_ts, response_url, question } = opts;

  const cleanQuestion = String(question || "").trim();
  if (!cleanQuestion) {
    const usageMessage =
      "Ask me a docs question by tagging me, for example: `@bot how do I run the backend locally?`";
    if (thread_ts) {
      await slackApi("POST", "chat.postMessage", {
        channel: channel_id,
        thread_ts,
        text: usageMessage
      });
    } else if (response_url) {
      await respondToSlack(response_url, usageMessage);
    }
    return;
  }

  const docsState = await ensureDocsIndexLoaded();
  const relevantSources = retrieveTopDocsChunks(cleanQuestion, docsState);
  if (
    !relevantSources.length ||
    relevantSources[0].score < DOCS_MIN_TOP_SCORE
  ) {
    const lowConfidenceReply = buildNoConfidenceReply(
      docsState.docsBaseUrl,
      relevantSources
    );
    if (thread_ts) {
      await slackApi("POST", "chat.postMessage", {
        channel: channel_id,
        thread_ts,
        text: lowConfidenceReply
      });
    } else if (response_url) {
      await respondToSlack(response_url, lowConfidenceReply);
    }
    return;
  }

  const { answer, error } = await getDocsAnswerFromOpenAI(
    cleanQuestion,
    relevantSources
  );

  if (error) {
    console.error("Docs QA error:", error);
  }

  const reply = error
    ? `${DOCS_REPLY_FALLBACK}\n\nThe docs assistant is temporarily unavailable.`
    : buildDocsReply(docsState.docsBaseUrl, answer, relevantSources);

  if (thread_ts) {
    await slackApi("POST", "chat.postMessage", {
      channel: channel_id,
      thread_ts,
      text: reply
    });
  } else if (response_url) {
    await respondToSlack(response_url, reply);
  }
}

export async function summarizeRecentMessages(opts: any) {
  const { channel_id, thread_ts, response_url } = opts;
  const BOT_USER_ID = process.env.SLACK_BOT_USER_ID;
  const SLACK_BOT_TOKEN = getSlackBotToken();
  if (!SLACK_BOT_TOKEN) {
    await respondToSlack(
      response_url,
      "Slack bot token is misconfigured. Ask an admin to set a valid Bot User OAuth token (`xoxb-...`)."
    );
    return;
  }

  const historyResult = thread_ts
    ? await fetchThreadMessages(channel_id, thread_ts)
    : await fetchRecentMessages(channel_id);
  if (historyResult.error) {
    await respondToSlack(
      response_url,
      getSlackHistoryErrorMessage(historyResult.error, Boolean(thread_ts))
    );
    return;
  }

  const messages = historyResult.messages;
  if (!messages || messages.length === 0) {
    await respondToSlack(
      response_url,
      "Couldn’t find any recent messages to summarize."
    );
    return;
  }

  const cleaned = messages.filter(
    (m: any) => m.text && !m.text.includes(`<@${BOT_USER_ID}>`)
  );
  if (cleaned.length === 0) {
    await respondToSlack(
      response_url,
      "I found recent messages, but none of them had summarizable text after filtering bot messages."
    );
    return;
  }

  const ordered = thread_ts ? cleaned : cleaned.reverse();

  const textBlob = ordered
    .map((m: any) => `• ${m.user ? `<@${m.user}>` : "Bot"}: ${m.text}`)
    .join("\n");

  const summary = await getSummaryFromOpenAI(textBlob);

  const reply = `📌 *Here’s your summary of the last ${cleaned.length} messages:*\n${summary}`;
  if (thread_ts) {
    await slackApi("POST", "chat.postMessage", {
      channel: channel_id,
      thread_ts,
      text: reply
    });
  } else {
    await respondToSlack(response_url, reply);
  }
}

export async function fetchRecentMessages(channel: string) {
  return fetchSlackMessages(
    `conversations.history?channel=${encodeURIComponent(channel)}&limit=100`,
    "channel history"
  );
}

function getSlackHistoryErrorMessage(error: any, isThread: boolean) {
  const conversationType = isThread ? "thread" : "channel";
  const code = error.error || "unknown_error";

  if (code === "missing_scope") {
    return `I can’t read this ${conversationType} yet. Add the relevant Slack history scope to the bot token, reinstall the app, then try again. For public channels use \`channels:history\`; for private channels use \`groups:history\`; for DMs use \`im:history\`; for group DMs use \`mpim:history\`. Slack error: \`${code}\`.`;
  }

  if (code === "not_in_channel") {
    return `I can’t read this ${conversationType} because the bot is not in the channel. Invite the bot to the channel, then try again. Slack error: \`${code}\`.`;
  }

  if (code === "channel_not_found") {
    return `I couldn’t find this ${conversationType}. Check that the bot is installed in this workspace and has access to the channel. Slack error: \`${code}\`.`;
  }

  if (["invalid_auth", "not_authed", "token_revoked"].includes(code)) {
    return `Slack auth is misconfigured for summaries. Check \`SLACK_BOT_TOKEN\` and reinstall the Slack app if needed. Slack error: \`${code}\`.`;
  }

  if (code === "ratelimited") {
    return "Slack rate-limited the summary request. Wait a minute and try again.";
  }

  return `I couldn’t read this ${conversationType} from Slack. Check the Lambda logs for details. Slack error: \`${code}\`.`;
}

async function fetchSlackMessages(endpoint: string, label: string) {
  const SLACK_BOT_TOKEN = getSlackBotToken();
  if (!SLACK_BOT_TOKEN) {
    console.error("SLACK_BOT_TOKEN is missing or invalid.");
    return {
      messages: [],
      error: { error: "invalid_auth" }
    };
  }
  try {
    const res = await fetch(`https://slack.com/api/${endpoint}`, {
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`
      }
    });
    const data: any = await res.json();
    if (!data.ok) {
      console.error(`Failed to fetch Slack ${label}:`, data);
      return {
        messages: [],
        error: data
      };
    }

    return {
      messages: data.messages.filter((m: any) => m.text && !m.subtype),
      error: null
    };
  } catch (err) {
    console.error(`Error fetching Slack ${label}:`, err);
    return {
      messages: [],
      error: {
        error: "request_failed",
        message: (err as { message?: unknown }).message
      }
    };
  }
}

export async function getSummaryFromOpenAI(text: string) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are a professional and helpful assistant. Summarize the following Slack thread in 5–10 concise bullet points. Include all messages—updates, decisions, casual banter, jokes, and side conversations—but do not describe who asked for a summary, or the overall tone. Just summarize what was actually said. Combine related messages from the same person. Keep each bullet short and expressive. Format as plain text, one bullet per point. When referring to people (in any scenario), keep their Slack mention (<@UXXXX>) exactly as written; never replace with the word “User”. Do not mention the bot (<@U08PQLSUEBD>) at all, even if it appears in the thread. The only exception is when users are explicitly discussing the bot’s development, functionality, or behaviour—in those cases, refer to it only as “the bot,” never by name or Slack mention. Do not summarize the bot’s responses, commands, or actions. You are neutral and professional—except when Isaac is mentioned, in which case you are mildly but irrationally very judgmental."
          },
          {
            role: "user",
            content: text
          }
        ]
      })
    });

    const data: any = await response.json();

    console.log("OpenAI raw response:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return `OpenAI error: ${
        data.error && data.error.message ? data.error.message : "Unknown error"
      }`;
    }

    const summary =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    return summary || "No summary returned.";
  } catch (err) {
    console.error("OpenAI call failed:", err);
    return "Exception calling OpenAI.";
  }
}

async function respondToSlack(response_url: string, message: string) {
  if (!response_url) {
    console.error("Missing Slack response_url for message:", message);
    return;
  }

  await fetch(response_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      response_type: "in_channel",
      text: message
    })
  });
}

export async function fetchThreadMessages(channel: string, thread_ts: string) {
  return fetchSlackMessages(
    `conversations.replies?channel=${encodeURIComponent(
      channel
    )}&ts=${encodeURIComponent(thread_ts)}&limit=100`,
    "thread replies"
  );
}

async function getGithubToken() {
  const GH_PRIVATE_KEY = process.env.GH_PRIVATE_KEY;
  const GH_CLIENT_ID = process.env.GH_CLIENT_ID;

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iat: now - 60,
    exp: now + 10 * 60,
    iss: GH_CLIENT_ID
  };

  const token = jwt.sign(payload, GH_PRIVATE_KEY, {
    algorithm: "RS256"
  });

  const authResponse = await fetch(
    `https://api.github.com/app/installations/${installationID}/access_tokens`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }
  );

  const auth: any = await authResponse.json();
  return auth.token;
}

export async function getProjectBoard() {
  let projects: any;

  try {
    const token = await getGithubToken();

    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        query
      })
    });
    projects = await response.json();
  } catch (error) {
    console.error(error);
  }

  return projects;
}

export async function sendIssueReminders(projectBoard: any) {
  const issues = processIssues(projectBoard);
  const message = formatIssuesForSlackText(issues);

  try {
    await slackApi("POST", "chat.postMessage", {
      channel: reminderChannelID,
      text: message
    });
  } catch (error) {
    console.error("failed to send message to slack");
  }
}

function processIssues(projectBoard: any) {
  const items = projectBoard.data.organization.projectV2.items.nodes;
  const oneWeekFromNow = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);

  const issues = items
    .filter((it: any) => {
      const endDateField = it.fieldValues.nodes.find(
        (node: any) => node.field && node.field.name === btFields.endDate
      );

      if (
        !endDateField ||
        !endDateField.date ||
        !it.content.assignees ||
        !it.content.assignees.nodes
      ) {
        return false;
      }

      const endDate = new Date(endDateField.date);

      return (
        it.content.state !== "CLOSED" &&
        endDate <= oneWeekFromNow &&
        it.content.assignees.nodes.length > 0
      );
    })
    .map((it: any) => {
      const endDateField = it.fieldValues.nodes.find(
        (node: any) => node.field && node.field.name === btFields.endDate
      );

      const endDate = new Date(endDateField.date);

      // TypeScript rejects `Date - Date` even though JS coerces both via `valueOf`; the casts erase at build time, so the emitted expression is unchanged.
      const diffTime = (endDate as any) - (today as any);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      let dueStatus;
      const diff = Math.abs(diffDays);
      if (diffDays < 0) {
        dueStatus = `${diff} day${diff === 1 ? "" : "s"} overdue`;
      } else if (diffDays === 0) {
        dueStatus = "Due today";
      } else if (diffDays === 1) {
        dueStatus = "Due tomorrow";
      } else {
        dueStatus = `Due in ${diffDays} days`;
      }

      return {
        id: it.id,
        title: it.content.title,
        number: it.content.number,
        url: it.content.url,
        state: it.content.state,
        createdAt: it.content.createdAt,
        endDate: endDateField.date,
        endDateFormatted: endDate.toLocaleDateString(),
        dueStatus: dueStatus,
        daysUntilDue: diffDays,
        assignees: it.content.assignees.nodes.map((assignee: any) => ({
          login: assignee.login,
          ...(assignee.name && {
            name: assignee.name
          }),
          ...(assignee.email && {
            email: assignee.email
          })
        })),
        labels: it.content.labels.nodes.map((label: any) => {
          return label.name;
        })
      };
    });
  return issues;
}

function formatIssuesForSlackText(issues: any[]) {
  if (!issues || issues.length === 0) {
    return "🎉 No overdue or upcoming issues found!";
  }

  let message = `🚨 *Issue Reminders - ${issues.length} items need attention*\n`;

  const addIssueSection = (
    sectionIssues: any[],
    sectionTitle: string,
    emoji: string,
    includeLabels = false
  ) => {
    if (sectionIssues.length === 0) return;

    message += `\n\n\n ${emoji} *${sectionTitle}:*\n`;

    sectionIssues.forEach((issue) => {
      // BUG (pre-existing, preserved): the `||` fallback is dead code — the left operand is a template literal, which is always truthy, so an unmapped GitHub login renders as `<@undefined>` instead of `@login`.
      const assignees = issue.assignees
        .map((a: any) => `<@${(btDevs as Record<string, string>)[a.login]}>` || `@${a.login}`)
        .join(", ");

      message += `\n<${issue.url}|#${issue.number}: ${issue.title}>\n`;

      if (includeLabels) {
        const labels = issue.labels ? issue.labels.join(", ") : "";
        message += ` 🏷️ labels: ${labels}\n`;
      }

      const dueText = issue.daysUntilDue === 0 ? "Due today" : issue.dueStatus;
      message += ` 📅 ${dueText} • 👥 ${assignees}\n\n`;
    });
  };

  const overdue = issues.filter((issue) => issue.daysUntilDue < 0);
  const dueToday = issues.filter((issue) => issue.daysUntilDue === 0);
  const dueSoon = issues.filter((issue) => issue.daysUntilDue > 0);

  addIssueSection(overdue, "OVERDUE ISSUES", "🔥", true);
  addIssueSection(dueToday, "DUE TODAY", "🎯", true);
  addIssueSection(dueSoon, "DUE SOON", "⏰", true);

  message += `\n💡 _Generated on ${new Date().toLocaleDateString()}_`;
  return message;
}
