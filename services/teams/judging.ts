/**
 * Judging for hackathons (HelloHacks): settings, rubric, teams, judges, reviews and links per
 * event, with code-based login. Backs ubc-biztech/bt-judging.
 *
 * This is a GENERATED-router service: routes, auth, validation and error statuses come from the
 * ontology in ubc-biztech/sdk (src/ontology/entities/judging.ts) via
 * @ubc-biztech/sdk/server/judging. This file supplies the business logic (JudgingImpl, one method
 * per declared action) and storage (DynamoStore over biztechJudging via lib/db). To change the API,
 * declare it in the sdk, bump the pinned commit in the root package.json, and the missing Impl
 * method here is a compile error.
 *
 * Distinct from the five-metric flow in handler.ts (bizJudge, bizFeedback); the two share no tables.
 *
 * Table biztechJudging: id = "<eventID>;<year>" (the event partition), sk = record key below.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { ActionError, type Ctx, type Impl, type Scope } from "@ubc-biztech/sdk/server/judging";
import type { Judge, JudgingLink, JudgingSettings, JudgingTeam, Review, Rubric } from "@ubc-biztech/sdk";
import db from "../../lib/db.js";
import { JUDGING_EVENTS_TABLE } from "../../constants/tables.js";

// ─── Keys and codes ────────────────────────────────────────────────

/**
 * One partition per event in biztechJudging: id = "<eventID>;<year>" (the repo's usual
 * composite event key), sk = one of the prefixes below + the record id.
 */
const eventKey = (eventID: string, year: number) => `${eventID};${year}`;

const SK = {
  SETTINGS: "SETTINGS",
  RUBRIC: "RUBRIC",
  TEAM: "TEAM#",
  JUDGE: "JUDGE#",
  REVIEW: "REVIEW#",
  LINK: "LINK#",
  CODE: "CODE#"
} as const;

/** Login codes: XXXX-XXXX from an alphabet without 0/O/1/I. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// ─── Storage ───────────────────────────────────────────────────────

/** A row in biztechJudging. `id` is the event key, `sk` the record key within the event. */
export type Item = { id: string; sk: string; [k: string]: unknown };

/**
 * The four operations JudgingImpl needs; DynamoStore is a thin pass-through to lib/db.
 */
export interface Store {
  get(id: string, sk: string): Promise<Item | null>;
  put(item: Item, createNew: boolean): Promise<void>;
  delete(id: string, sk: string): Promise<void>;
  /** Every row in the event whose sk starts with `skPrefix`. */
  list(id: string, skPrefix: string): Promise<Item[]>;
}

export class DynamoStore implements Store {
  async get(id: string, sk: string) {
    return (await db.getOne(id, JUDGING_EVENTS_TABLE, { sk })) as Item | null;
  }
  async put(item: Item, createNew: boolean) {
    await db.put(item, JUDGING_EVENTS_TABLE, createNew);
  }
  async delete(id: string, sk: string) {
    await db.deleteOne(id, JUDGING_EVENTS_TABLE, { sk });
  }
  async list(id: string, skPrefix: string) {
    return (await db.query(JUDGING_EVENTS_TABLE, null, {
      expression: "#id = :id AND begins_with(#sk, :p)",
      expressionValues: { ":id": id, ":p": skPrefix },
      expressionNames: { "#id": "id", "#sk": "sk" }
    })) as Item[];
  }
}

// ─── Implementation ────────────────────────────────────────────────

type C = Ctx<Scope>;
type Round = Review["round"];

const key = (s: Scope) => eventKey(s.eventID, s.year);
const now = () => new Date().toISOString();
/** Time-sortable opaque id. */
const newId = () => `${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const normalizeCode = (c: string) => c.replace(/\s+/g, "").toUpperCase();
const newCode = () => {
  const b = randomBytes(8);
  const s = [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
};
/** The API-facing record: the row minus its table keys. Entity ids live in `recordId`, not `id`. */
const strip = <T extends object>(item: Item, ...drop: string[]): T => {
  const { id: _id, sk: _sk, type: _t, recordId, ...rest } = item;
  for (const d of drop) delete (rest as Record<string, unknown>)[d];
  return (recordId === undefined ? rest : { id: recordId, ...rest }) as T;
};
const isAdmin = (ctx: C) => ctx.principal?.role === "judgingAdmin";
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

export class JudgingImpl implements Impl {
  constructor(
    private readonly store: Store,
    private readonly opts: { bootstrapCode: string | null },
  ) {}

  // ─── Auth ──────────────────────────────────────────────────────────

  async authenticate(token: string, scope: Scope) {
    const code = normalizeCode(token);
    if (!code) return null;
    if (this.opts.bootstrapCode && code === normalizeCode(this.opts.bootstrapCode)) return { role: "judgingAdmin", id: "admin", name: "Organizer" };
    const ref = await this.store.get(key(scope), `${SK.CODE}${code}`);
    if (!ref) return null;
    if (ref.kind === "judge") {
      const j = await this.store.get(key(scope), `${SK.JUDGE}${ref.refId}`);
      if (!j) return null;
      return { role: j.isAdmin ? "judgingAdmin" : "judge", id: String(j.recordId), name: String(j.name) };
    }
    if (ref.kind === "team") {
      const t = await this.store.get(key(scope), `${SK.TEAM}${ref.refId}`);
      if (!t) return null;
      return { role: "judgingCode", id: String(t.recordId), name: String(t.name) };
    }
    return null;
  }

  private async session(ctx: C, principal: NonNullable<C["principal"]>) {
    const settings = await this.store.get(key(ctx.scope), SK.SETTINGS);
    const role = principal.role === "judgingCode" ? ("team" as const) : (principal.role as "judgingAdmin" | "judge");
    return { role, id: principal.id, name: principal.name, eventName: settings ? String(settings.eventName) : ctx.scope.eventID };
  }

  async sessionLogin(ctx: C, input: { code: string }) {
    const principal = await this.authenticate(input.code, ctx.scope);
    if (!principal) throw new ActionError("UnknownCode", "That code does not match anything for this event.");
    return this.session(ctx, principal);
  }

  async sessionMe(ctx: C) {
    return this.session(ctx, ctx.principal!);
  }

  // ─── Settings and rubric ───────────────────────────────────────────

  async settingsGet(ctx: C): Promise<JudgingSettings> {
    const s = await this.store.get(key(ctx.scope), SK.SETTINGS);
    if (!s) throw new ActionError("EventNotFound", `No judging has been set up for ${ctx.scope.eventID} ${ctx.scope.year}.`);
    return strip<JudgingSettings>(s);
  }

  async settingsSet(ctx: C, input: Omit<JudgingSettings, "updatedAt"> & Scope): Promise<JudgingSettings> {
    const { eventID: _e, year: _y, ...fields } = input;
    const existing = await this.store.get(key(ctx.scope), SK.SETTINGS);
    const item: Item = { id: key(ctx.scope), sk: SK.SETTINGS, type: "settings", ...fields, updatedAt: now() };
    await this.store.put(item, !existing);
    return strip<JudgingSettings>(item);
  }

  async rubricGet(ctx: C): Promise<Rubric> {
    const r = await this.store.get(key(ctx.scope), SK.RUBRIC);
    if (!r) throw new ActionError("RubricNotFound", "No rubric has been set for this event.");
    return strip<Rubric>(r);
  }

  async rubricSet(ctx: C, input: Omit<Rubric, "updatedAt"> & Scope): Promise<Rubric> {
    const { eventID: _e, year: _y, ...fields } = input;
    if (!fields.criteria.length) throw new ActionError("InvalidRubric", "A rubric needs at least one criterion.");
    if (fields.scaleMax <= 0) throw new ActionError("InvalidRubric", "scaleMax must be positive.");
    const ids = new Set<string>();
    for (const c of fields.criteria) {
      if (ids.has(c.id)) throw new ActionError("InvalidRubric", `Duplicate criterion id "${c.id}".`);
      ids.add(c.id);
      if (c.maxScore !== undefined && c.maxScore <= 0) throw new ActionError("InvalidRubric", `Criterion "${c.id}" has a non-positive maxScore.`);
    }
    const existing = await this.store.get(key(ctx.scope), SK.RUBRIC);
    const item: Item = { id: key(ctx.scope), sk: SK.RUBRIC, type: "rubric", ...fields, updatedAt: now() };
    await this.store.put(item, !existing);
    return strip<Rubric>(item);
  }

  // ─── Teams ─────────────────────────────────────────────────────────

  private teamOut(ctx: C, item: Item): JudgingTeam {
    return isAdmin(ctx) ? strip<JudgingTeam>(item) : strip<JudgingTeam>(item, "code");
  }

  async teamsList(ctx: C): Promise<JudgingTeam[]> {
    const items = await this.store.list(key(ctx.scope), SK.TEAM);
    return items.map((i) => this.teamOut(ctx, i)).sort(byName);
  }

  async teamsCreate(ctx: C, input: Scope & Omit<JudgingTeam, "id" | "code" | "createdAt" | "imageUrls"> & { imageUrls?: string[] }): Promise<JudgingTeam> {
    const { eventID: _e, year: _y, ...fields } = input;
    const id = newId();
    const code = await this.issueCode(ctx.scope, "team", id);
    const item: Item = { id: key(ctx.scope), sk: `${SK.TEAM}${id}`, type: "team", recordId: id, ...fields, imageUrls: fields.imageUrls ?? [], code, createdAt: now() };
    await this.store.put(item, true);
    return strip<JudgingTeam>(item);
  }

  private async team(ctx: C, id: string): Promise<Item> {
    const t = await this.store.get(key(ctx.scope), `${SK.TEAM}${id}`);
    if (!t) throw new ActionError("TeamNotFound", `No team ${id}.`);
    return t;
  }

  async teamGet(ctx: C, input: { id: string }): Promise<JudgingTeam> {
    return this.teamOut(ctx, await this.team(ctx, input.id));
  }

  async teamUpdate(ctx: C, input: Scope & { id: string } & Omit<JudgingTeam, "id" | "code" | "createdAt" | "imageUrls"> & { imageUrls?: string[] }): Promise<JudgingTeam> {
    const existing = await this.team(ctx, input.id);
    const p = ctx.principal!;
    if (!isAdmin(ctx)) {
      if (!(p.role === "judgingCode" && p.id === input.id)) throw new ActionError("Forbidden", "Only the team itself or an organizer may edit a team.");
      const settings = await this.store.get(key(ctx.scope), SK.SETTINGS);
      if (settings?.phase !== "submission" || settings?.lockSubmissions) throw new ActionError("SubmissionsLocked", "Submissions are closed.");
      const max = Number(settings?.maxImages ?? 10);
      if ((input.imageUrls?.length ?? 0) > max) throw new ActionError("SubmissionsLocked", `At most ${max} images.`);
    }
    const { eventID: _e, year: _y, id: _i, ...fields } = input;
    const item: Item = { ...existing, ...fields, imageUrls: fields.imageUrls ?? [] };
    await this.store.put(item, false);
    return this.teamOut(ctx, item);
  }

  async teamDelete(ctx: C, input: { id: string }) {
    const t = await this.team(ctx, input.id);
    await this.store.delete(key(ctx.scope), `${SK.CODE}${normalizeCode(String(t.code ?? ""))}`);
    for (const r of await this.store.list(key(ctx.scope), SK.REVIEW)) if (r.teamId === input.id) await this.store.delete(key(ctx.scope), r.sk);
    await this.store.delete(key(ctx.scope), t.sk);
    return { message: `Deleted team ${input.id} and its reviews.` };
  }

  // ─── Judges ────────────────────────────────────────────────────────

  private judgeOut(ctx: C, item: Item): Judge {
    return isAdmin(ctx) ? strip<Judge>(item) : strip<Judge>(item, "code");
  }

  async judgesList(ctx: C): Promise<Judge[]> {
    const items = await this.store.list(key(ctx.scope), SK.JUDGE);
    return items.map((i) => this.judgeOut(ctx, i)).sort(byName);
  }

  async judgesCreate(ctx: C, input: Scope & { name: string; isAdmin?: boolean }): Promise<Judge> {
    const id = newId();
    const code = await this.issueCode(ctx.scope, "judge", id);
    const item: Item = { id: key(ctx.scope), sk: `${SK.JUDGE}${id}`, type: "judge", recordId: id, name: input.name, isAdmin: !!input.isAdmin, assignedTeamIds: [], code };
    await this.store.put(item, true);
    return strip<Judge>(item);
  }

  async judgesAutoAssign(ctx: C, input: Scope & { perTeamJudges?: number }): Promise<Record<string, string[]>> {
    const settings = await this.store.get(key(ctx.scope), SK.SETTINGS);
    const per = input.perTeamJudges ?? Number(settings?.perTeamJudges ?? 2);
    const teams = (await this.store.list(key(ctx.scope), SK.TEAM)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const judges = (await this.store.list(key(ctx.scope), SK.JUDGE)).filter((j) => !j.isAdmin);
    if (!judges.length) throw new ActionError("NoJudges", "Create at least one non-admin judge first.");
    const buckets: Record<string, string[]> = Object.fromEntries(judges.map((j) => [String(j.recordId), [] as string[]]));
    teams.forEach((t, i) => {
      for (let k = 0; k < Math.min(per, judges.length); k++) buckets[String(judges[(i + k) % judges.length]!.recordId)]!.push(String(t.recordId));
    });
    for (const j of judges) await this.store.put({ ...j, assignedTeamIds: buckets[String(j.recordId)] }, false);
    return buckets;
  }

  private async judge(ctx: C, id: string): Promise<Item> {
    const j = await this.store.get(key(ctx.scope), `${SK.JUDGE}${id}`);
    if (!j) throw new ActionError("JudgeNotFound", `No judge ${id}.`);
    return j;
  }

  async judgeGet(ctx: C, input: { id: string }): Promise<Judge> {
    return this.judgeOut(ctx, await this.judge(ctx, input.id));
  }

  async judgeUpdate(ctx: C, input: Scope & { id: string; name?: string; isAdmin?: boolean; assignedTeamIds?: string[] }): Promise<Judge> {
    const j = await this.judge(ctx, input.id);
    const item: Item = { ...j };
    if (input.name !== undefined) item.name = input.name;
    if (input.isAdmin !== undefined) item.isAdmin = input.isAdmin;
    if (input.assignedTeamIds !== undefined) item.assignedTeamIds = input.assignedTeamIds;
    await this.store.put(item, false);
    return strip<Judge>(item);
  }

  async judgeDelete(ctx: C, input: { id: string }) {
    const j = await this.judge(ctx, input.id);
    await this.store.delete(key(ctx.scope), `${SK.CODE}${normalizeCode(String(j.code ?? ""))}`);
    await this.store.delete(key(ctx.scope), j.sk);
    return { message: `Deleted judge ${input.id}.` };
  }

  // ─── Reviews ───────────────────────────────────────────────────────

  /**
   * Row-level visibility. Returns a filter for the caller: admins see all; judges see all when
   * `allowJudgeSeeOthers`, else their own; a team sees its own team's reviews when `showTeamFeedback`.
   * Throws Forbidden when the caller asked for something outside that.
   */
  private async reviewFilter(ctx: C, asked: { teamId?: string; judgeId?: string }): Promise<(r: Review) => boolean> {
    const p = ctx.principal!;
    if (isAdmin(ctx)) return () => true;
    const settings = await this.store.get(key(ctx.scope), SK.SETTINGS);
    if (p.role === "judge") {
      if (settings?.allowJudgeSeeOthers !== false) return () => true;
      if (asked.judgeId && asked.judgeId !== p.id) throw new ActionError("Forbidden", "Judges may only see their own reviews for this event.");
      return (r) => r.judgeId === p.id;
    }
    if (!settings?.showTeamFeedback) throw new ActionError("Forbidden", "Results are not public yet.");
    if (asked.teamId && asked.teamId !== p.id) throw new ActionError("Forbidden", "A team may only see its own reviews.");
    return (r) => r.teamId === p.id;
  }

  async reviewsList(ctx: C, input: Scope & { round?: Round; teamId?: string; judgeId?: string }): Promise<Review[]> {
    const visible = await this.reviewFilter(ctx, input);
    const items = await this.store.list(key(ctx.scope), SK.REVIEW);
    return items
      .map((i) => strip<Review>(i))
      .filter(visible)
      .filter((r) => (!input.round || r.round === input.round) && (!input.teamId || r.teamId === input.teamId) && (!input.judgeId || r.judgeId === input.judgeId))
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  }

  async reviewsSubmit(ctx: C, input: Scope & { teamId: string; scores: Record<string, number>; feedback?: string }): Promise<Review> {
    const p = ctx.principal!;
    const settings = await this.store.get(key(ctx.scope), SK.SETTINGS);
    const phase = String(settings?.phase ?? "submission");
    if (phase !== "prelim" && phase !== "finals") throw new ActionError("PhaseClosed", `Judging is not open (phase is "${phase}").`);
    const round = phase as Round;
    await this.team(ctx, input.teamId);
    if (round === "finals") {
      const finalists = (settings?.finalsTeamIds as string[] | undefined) ?? [];
      const finalsJudges = (settings?.finalsJudgeIds as string[] | undefined) ?? [];
      if (!finalists.includes(input.teamId)) throw new ActionError("PhaseClosed", "That team is not in the finals.");
      if (!isAdmin(ctx) && !finalsJudges.includes(p.id)) throw new ActionError("PhaseClosed", "You are not a finals judge.");
    }
    const rubricItem = await this.store.get(key(ctx.scope), SK.RUBRIC);
    if (!rubricItem) throw new ActionError("InvalidScores", "No rubric has been set, so scores cannot be validated.");
    const rubric = strip<Rubric>(rubricItem);
    const expected = new Set(rubric.criteria.map((c) => c.id));
    for (const c of rubric.criteria) {
      const v = input.scores[c.id];
      const max = c.maxScore ?? rubric.scaleMax;
      if (v === undefined) throw new ActionError("InvalidScores", `Missing score for "${c.label}".`);
      if (v < 0 || v > max) throw new ActionError("InvalidScores", `"${c.label}" must be between 0 and ${max}.`);
    }
    for (const k of Object.keys(input.scores)) if (!expected.has(k)) throw new ActionError("InvalidScores", `"${k}" is not a rubric criterion.`);
    const total = rubric.criteria.reduce((n, c) => n + input.scores[c.id]!, 0);
    const weightedTotal = rubric.criteria.reduce((n, c) => n + input.scores[c.id]! * c.weight, 0);
    const id = `${round}__${input.teamId}__${p.id}`;
    const item: Item = {
      id: key(ctx.scope), sk: `${SK.REVIEW}${id}`, type: "review",
      recordId: id, round, teamId: input.teamId, judgeId: p.id, judgeName: p.name,
      scores: input.scores, feedback: input.feedback ?? "", total, weightedTotal, completedAt: now(),
    };
    await this.store.put(item, !(await this.store.get(key(ctx.scope), item.sk)));
    return strip<Review>(item);
  }

  async reviewGet(ctx: C, input: { id: string }): Promise<Review> {
    const r = await this.store.get(key(ctx.scope), `${SK.REVIEW}${input.id}`);
    if (!r) throw new ActionError("ReviewNotFound", `No review ${input.id}.`);
    const review = strip<Review>(r);
    const visible = await this.reviewFilter(ctx, { teamId: review.teamId, judgeId: review.judgeId });
    if (!visible(review)) throw new ActionError("Forbidden", "Not visible to this caller.");
    return review;
  }

  async reviewDelete(ctx: C, input: { id: string }) {
    const r = await this.store.get(key(ctx.scope), `${SK.REVIEW}${input.id}`);
    if (!r) throw new ActionError("ReviewNotFound", `No review ${input.id}.`);
    await this.store.delete(key(ctx.scope), r.sk);
    return { message: `Deleted review ${input.id}.` };
  }

  // ─── Links ─────────────────────────────────────────────────────────

  async linksList(ctx: C): Promise<JudgingLink[]> {
    return (await this.store.list(key(ctx.scope), SK.LINK)).map((i) => strip<JudgingLink>(i)).sort((a, b) => a.order - b.order);
  }

  async linksCreate(ctx: C, input: Scope & { label: string; url: string; order?: number }): Promise<JudgingLink> {
    const existing = await this.store.list(key(ctx.scope), SK.LINK);
    const order = input.order ?? Math.max(0, ...existing.map((l) => Number(l.order))) + 1;
    const id = newId();
    const item: Item = { id: key(ctx.scope), sk: `${SK.LINK}${id}`, type: "link", recordId: id, label: input.label, url: input.url, order };
    await this.store.put(item, true);
    return strip<JudgingLink>(item);
  }

  async linkDelete(ctx: C, input: { id: string }) {
    const l = await this.store.get(key(ctx.scope), `${SK.LINK}${input.id}`);
    if (!l) throw new ActionError("LinkNotFound", `No link ${input.id}.`);
    await this.store.delete(key(ctx.scope), l.sk);
    return { message: `Deleted link ${input.id}.` };
  }

  // ─── Codes ─────────────────────────────────────────────────────────

  /** Mint a unique login code for a judge or team and index it for lookup. */
  private async issueCode(scope: Scope, kind: "judge" | "team", refId: string): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = newCode();
      const sk = `${SK.CODE}${normalizeCode(code)}`;
      if (await this.store.get(key(scope), sk)) continue;
      await this.store.put({ id: key(scope), sk, type: "code", kind, refId }, true);
      return code;
    }
    throw new Error("Could not mint a unique code after 10 attempts");
  }
}
