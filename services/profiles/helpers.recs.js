// services/profiles/helpers.recs.js
import { OpenAI } from "openai";
import db from "../../lib/db.js";
import {
  EVENTS_TABLE,
  USER_REGISTRATIONS_TABLE,
  PROFILES_TABLE
} from "../../constants/tables.js";

// ───────────────── OpenAI setup (embeddings only; no generation) ─────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ───────────────── Helpers: Profile text & embeddings ─────────────────
export function buildProfileText(p = {}) {
  const parts = [
    p.description,
    p.hobby1,
    p.hobby2,
    p.funQuestion1,
    p.funQuestion2
  ].filter(Boolean);
  return parts.join("\n");
}

/**
 * Best-effort embedding. Returns null if:
 *  - no API key
 *  - profile already has embedding
 *  - profile has no text to embed
 * If it creates an embedding, it persists it.
 */
export async function ensureEmbedding(profileItem) {
  if (!openai) return null; // embedding optional mode
  if (Array.isArray(profileItem.embedding) && profileItem.embedding.length) {
    return profileItem.embedding;
  }

  const text = buildProfileText(profileItem);
  if (!text || !text.trim()) return null;

  const resp = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text.slice(0, 8000)
  });
  const vec = resp.data?.[0]?.embedding || null;
  if (!vec) return null;

  // Persist embedding back (PK = compositeID + type)
  await db.updateDBCustom({
    TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
    Key: {
      compositeID: `PROFILE#${profileItem.profileID}`,
      type: "PROFILE"
    },
    UpdateExpression:
      "set embedding = :e, embeddingModel = :m, embeddingUpdatedAt = :t",
    ExpressionAttributeValues: {
      ":e": vec,
      ":m": EMBED_MODEL,
      ":t": Date.now()
    },
    ConditionExpression:
      "attribute_exists(compositeID) AND attribute_exists(#t)",
    ExpressionAttributeNames: { "#t": "type" }
  });

  return vec;
}

// ───────────────── Similarity & normalization ─────────────────
export function cosine(a = [], b = []) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const MAJOR_SYNONYMS = {
  "cs": "computer science",
  "comp sci": "computer science",
  "compsci": "computer science",
  "cpsc": "computer science",
  "biz": "business",
  "bcom": "business"
};

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}
function normMajor(s) {
  const x = norm(s);
  return MAJOR_SYNONYMS[x] || x;
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "your",
  "about",
  "this",
  "that",
  "from",
  "into",
  "over",
  "under",
  "you",
  "are",
  "have",
  "been",
  "will"
]);

function topOverlapTokens(textA, textB) {
  const tok = (t) =>
    norm(t)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w));
  const A = new Set(tok(textA));
  const B = new Set(tok(textB));
  const common = [...A].filter((x) => B.has(x));
  return common.slice(0, 2);
}

// ───────────────── Events → shared attendance counts ─────────────────
export async function getUserEventKeys(email) {
  const regs = await db.query(USER_REGISTRATIONS_TABLE, null, {
    expression: "id = :id",
    expressionValues: { ":id": email }
  });
  const keys = new Set();
  for (const r of regs) {
    if (r["eventID;year"]) keys.add(r["eventID;year"]);
  }
  return [...keys]; // e.g. ["blueprint;2025", ...]
}

export async function mapSharedEventsByCandidate(eventKeys) {
  const counts = new Map(); // email -> count
  for (const key of eventKeys) {
    const regs = await db.query(USER_REGISTRATIONS_TABLE, "event-query", {
      expression: "#ey = :ey",
      expressionNames: { "#ey": "eventID;year" },
      expressionValues: { ":ey": key }
    });
    for (const r of regs) {
      const email = r.id;
      counts.set(email, (counts.get(email) || 0) + 1);
    }
  }
  return counts;
}

// ───────────────── Profiles scan (attendee-like) ─────────────────
export async function scanAllProfiles() {
  const results = await db.scan(PROFILES_TABLE, {
    FilterExpression: "#type = :t",
    ExpressionAttributeNames: { "#type": "type" },
    ExpressionAttributeValues: { ":t": "PROFILE" }
  });
  return results || [];
}

// ───────────────── Score & deterministic reason (no LLM) ─────────────────
export function computeScoreAndReason(
  self,
  selfVec,
  other,
  otherVec,
  sharedEventCount,
  maxSelfEvents
) {
  // text similarity (optional)
  const textSim = selfVec && otherVec ? cosine(selfVec, otherVec) : 0;

  // structured
  const isSameMajor =
    normMajor(self.major) && normMajor(self.major) === normMajor(other.major);
  const isSameFaculty =
    norm(self.faculty) && norm(self.faculty) === norm(other.faculty);
  const isSameYear = norm(self.year) && norm(self.year) === norm(other.year);

  const structured =
    (isSameMajor ? 0.5 : 0) +
    (isSameFaculty ? 0.3 : 0) +
    (isSameYear ? 0.2 : 0); // 0..1

  const sharedNorm =
    maxSelfEvents > 0 ? Math.min(1, sharedEventCount / maxSelfEvents) : 0;

  // weights
  const alpha = 0.6; // text
  const beta = 0.25; // shared events
  const gamma = 0.15; // structured

  const blended = alpha * textSim + beta * sharedNorm + gamma * structured; // 0..1
  const score = Math.round(blended * 100); // 0..100

  // deterministic reason
  const selfText = buildProfileText(self);
  const otherText = buildProfileText(other);
  const overlap = topOverlapTokens(selfText, otherText);

  const parts = [];
  if (sharedEventCount > 0) {
    parts.push(
      sharedEventCount === 1
        ? "Attended 1 of the same events"
        : `Attended ${sharedEventCount} of the same events`
    );
  }
  if (isSameMajor) parts.push(`Same major (${normMajor(self.major)})`);
  if (isSameFaculty) parts.push(`Same faculty (${norm(self.faculty)})`);
  if (isSameYear) parts.push(`Same year (${norm(self.year)})`);
  if (overlap.length) parts.push(`Similar interests: ${overlap.join(", ")}`);

  const reason = parts.slice(0, 2).join(" • ") || "General profile similarity";

  const facts = {
    sharedEvents: sharedEventCount,
    sameMajor: Boolean(isSameMajor),
    sameFaculty: Boolean(isSameFaculty),
    sameYear: Boolean(isSameYear),
    overlapTokens: overlap
  };

  return {
    score,
    reason,
    facts
  };
}
