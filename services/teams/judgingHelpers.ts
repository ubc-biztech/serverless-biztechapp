/**
 * Hackathon judging (bt-judging): settings, rubric, teams, judges, reviews and links per event,
 * with code-based login. Backs the `judging*` functions in serverless.yml.
 *
 * The routes, auth, validation and error statuses are generated from the ontology in
 * ubc-biztech/sdk (src/ontology/entities/judging.ts); this file is the `Impl` it asks for,
 * one function per declared action. To change the API: declare it in the sdk, bump the pinned
 * commit in the root package.json, and the missing method here is a compile error.
 *
 * Storage reuses the teams service's tables:
 *   biztechTeams  (id, eventID;year)   teams, with code/github/description/imageUrls added
 *   bizJudge      (id)                 judges (type "judge"), plus SETTINGS#, RUBRIC# and LINK# rows,
 *                                      the same way CURRENT_ROUND already lives here
 *   bizFeedback   (id=judgeID, teamID;round)   reviews, scores keyed by rubric criterion id
 */
import { randomBytes, randomUUID } from "node:crypto";
import { ActionError, type Ctx, type Impl, type Scope } from "@ubc-biztech/sdk/server/judging";
import type { Judge, JudgingLink, JudgingSettings, JudgingTeam, Review, Rubric } from "@ubc-biztech/sdk";
import db from "../../lib/db.js";
import { FEEDBACK_TABLE, JUDGING_TABLE, TEAMS_TABLE } from "../../constants/tables.js";

type C = Ctx<Scope>;
type Round = Review["round"];
type Row = Record<string, unknown>;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const eventKey = (s: Scope) => `${s.eventID};${s.year}`;
const now = () => new Date().toISOString();
const newId = () => `${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const normalizeCode = (c: string) => c.replace(/\s+/g, "").toUpperCase();
const newCode = () => {
  const s = [...randomBytes(8)].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
};
const isAdmin = (ctx: C) => ctx.principal?.role === "judgingAdmin";
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

// ─── bizJudge rows: judges and the per-event singletons ────────────────────

const settingsId = (s: Scope) => `SETTINGS#${eventKey(s)}`;
const rubricId = (s: Scope) => `RUBRIC#${eventKey(s)}`;
const linkId = (s: Scope, id: string) => `LINK#${eventKey(s)}#${id}`;

const scanJudgeTable = async (scope: Scope, type: string): Promise<Row[]> =>
  (await db.scan(JUDGING_TABLE, {
    FilterExpression: "#ey = :ey AND #type = :type",
    ExpressionAttributeNames: {
      "#ey": "eventID;year",
      "#type": "type"
    },
    ExpressionAttributeValues: {
      ":ey": eventKey(scope),
      ":type": type
    }
  })) as Row[];

const judgeOut = (ctx: C, row: Row): Judge => ({
  id: str(row.id),
  name: str(row.name),
  ...(isAdmin(ctx) ? { code: str(row.code) } : {}),
  isAdmin: !!row.isAdmin,
  assignedTeamIds: strs(row.assignedTeamIds)
});

const settingsOut = (row: Row): JudgingSettings => ({
  eventName: str(row.eventName),
  phase: row.phase as JudgingSettings["phase"],
  perTeamJudges: Number(row.perTeamJudges),
  finalsTopN: Number(row.finalsTopN),
  finalsTeamIds: strs(row.finalsTeamIds),
  finalsJudgeIds: strs(row.finalsJudgeIds),
  showTeamFeedback: !!row.showTeamFeedback,
  allowJudgeSeeOthers: !!row.allowJudgeSeeOthers,
  anonymizeTeams: !!row.anonymizeTeams,
  lockSubmissions: !!row.lockSubmissions,
  maxImages: Number(row.maxImages),
  updatedAt: str(row.updatedAt)
});

const rubricOut = (row: Row): Rubric => ({
  name: str(row.name),
  scaleMax: Number(row.scaleMax),
  scoreMode: row.scoreMode as Rubric["scoreMode"],
  criteria: row.criteria as Rubric["criteria"],
  updatedAt: str(row.updatedAt)
});

const linkOut = (row: Row): JudgingLink => ({
  id: str(row.linkId),
  label: str(row.label),
  url: str(row.url),
  order: Number(row.order)
});

// ─── biztechTeams rows ─────────────────────────────────────────────────────

const getTeamRow = async (scope: Scope, id: string): Promise<Row> => {
  const row = (await db.getOne(id, TEAMS_TABLE, {
    "eventID;year": eventKey(scope)
  })) as Row | null;
  if (!row) throw new ActionError("TeamNotFound", `No team ${id}.`);
  return row;
};

const listTeamRows = async (scope: Scope): Promise<Row[]> =>
  (await db.scan(TEAMS_TABLE, {
    FilterExpression: "#ey = :ey",
    ExpressionAttributeNames: {
      "#ey": "eventID;year"
    },
    ExpressionAttributeValues: {
      ":ey": eventKey(scope)
    }
  })) as Row[];

const teamOut = (ctx: C, row: Row): JudgingTeam => ({
  id: str(row.id),
  name: str(row.teamName),
  members: strs(row.memberNames),
  description: typeof row.description === "string" ? row.description : undefined,
  github: typeof row.github === "string" ? row.github : undefined,
  devpost: str(row.submission) || undefined,
  imageUrls: strs(row.imageUrls),
  ...(isAdmin(ctx) && typeof row.code === "string" ? { code: row.code } : {}),
  createdAt: str(row.createdAt)
});

// ─── bizFeedback rows ──────────────────────────────────────────────────────

const reviewId = (round: string, teamId: string, judgeId: string) => `${round}__${teamId}__${judgeId}`;
const parseReviewId = (id: string) => {
  const [round, teamId, judgeId] = id.split("__");
  if (!round || !teamId || !judgeId) throw new ActionError("ReviewNotFound", `No review ${id}.`);
  return {
    round,
    teamId,
    judgeId
  };
};

const reviewOut = (row: Row): Review => {
  const [teamId, round] = str(row["teamID;round"]).split(";");
  return {
    id: reviewId(round ?? "", teamId ?? "", str(row.id)),
    round: round as Round,
    teamId: teamId ?? "",
    judgeId: str(row.id),
    judgeName: str(row.judgeName),
    scores: (row.scores ?? {}) as Record<string, number>,
    feedback: str(row.feedback),
    total: Number(row.total ?? 0),
    weightedTotal: Number(row.weightedTotal ?? 0),
    completedAt: str(row.createdAt)
  };
};

const reviewsForTeam = async (teamId: string): Promise<Row[]> =>
  (await db.query(FEEDBACK_TABLE, "team-round-query", {
    expression: "#team = :teamID",
    expressionValues: {
      ":teamID": teamId
    },
    expressionNames: {
      "#team": "teamID"
    }
  })) as Row[];

/**
 * Row-level visibility: admins see all; judges see all when allowJudgeSeeOthers, else their own;
 * a team sees its own reviews when showTeamFeedback. Throws Forbidden when the caller asked for
 * something outside that.
 */
const reviewFilter = async (ctx: C, asked: { teamId?: string; judgeId?: string }): Promise<(r: Review) => boolean> => {
  const p = ctx.principal!;
  if (isAdmin(ctx)) return () => true;
  const settings = (await db.getOne(settingsId(ctx.scope), JUDGING_TABLE)) as Row | null;
  if (p.role === "judge") {
    if (settings?.allowJudgeSeeOthers !== false) return () => true;
    if (asked.judgeId && asked.judgeId !== p.id) throw new ActionError("Forbidden", "Judges may only see their own reviews for this event.");
    return (r) => r.judgeId === p.id;
  }
  if (!settings?.showTeamFeedback) throw new ActionError("Forbidden", "Results are not public yet.");
  if (asked.teamId && asked.teamId !== p.id) throw new ActionError("Forbidden", "A team may only see its own reviews.");
  return (r) => r.teamId === p.id;
};

/** Mint a login code that no judge or team in this event already has. */
const issueCode = async (scope: Scope): Promise<string> => {
  const taken = new Set<string>();
  for (const row of [...(await scanJudgeTable(scope, "judge")), ...(await listTeamRows(scope))]) if (typeof row.code === "string") taken.add(row.code);
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = newCode();
    if (!taken.has(code)) return code;
  }
  throw new Error("Could not mint a unique code");
};

// ─── The implementation ────────────────────────────────────────────────────

const judgingImpl: Impl = {
  async authenticate(token, scope) {
    const code = normalizeCode(token);
    if (!code) return null;
    const boot = process.env.JUDGING_BOOTSTRAP_CODE;
    if (boot && code === normalizeCode(boot)) {
      return {
        role: "judgingAdmin",
        id: "admin",
        name: "Organizer"
      };
    }
    const judge = (await scanJudgeTable(scope, "judge")).find((j) => j.code === code);
    if (judge) {
      return {
        role: judge.isAdmin ? "judgingAdmin" : "judge",
        id: str(judge.id),
        name: str(judge.name)
      };
    }
    const team = (await listTeamRows(scope)).find((t) => t.code === code);
    if (team) {
      return {
        role: "judgingCode",
        id: str(team.id),
        name: str(team.teamName)
      };
    }
    return null;
  },

  async sessionLogin(ctx, input) {
    const principal = await judgingImpl.authenticate(input.code, ctx.scope);
    if (!principal) throw new ActionError("UnknownCode", "That code does not match anything for this event.");
    const settings = (await db.getOne(settingsId(ctx.scope), JUDGING_TABLE)) as Row | null;
    return {
      role: principal.role === "judgingCode" ? "team" : (principal.role as "judgingAdmin" | "judge"),
      id: principal.id,
      name: principal.name,
      eventName: str(settings?.eventName, ctx.scope.eventID)
    };
  },

  async sessionMe(ctx) {
    const p = ctx.principal!;
    const settings = (await db.getOne(settingsId(ctx.scope), JUDGING_TABLE)) as Row | null;
    return {
      role: p.role === "judgingCode" ? "team" : (p.role as "judgingAdmin" | "judge"),
      id: p.id,
      name: p.name,
      eventName: str(settings?.eventName, ctx.scope.eventID)
    };
  },

  async settingsGet(ctx) {
    const row = (await db.getOne(settingsId(ctx.scope), JUDGING_TABLE)) as Row | null;
    if (!row) throw new ActionError("EventNotFound", `No judging has been set up for ${eventKey(ctx.scope)}.`);
    return settingsOut(row);
  },

  async settingsSet(ctx, input) {
    const { eventID, year, ...fields } = input;
    void eventID;
    void year;
    const existing = await db.getOne(settingsId(ctx.scope), JUDGING_TABLE);
    const row: Row = {
      id: settingsId(ctx.scope),
      type: "settings",
      "eventID;year": eventKey(ctx.scope),
      ...fields,
      updatedAt: now()
    };
    await db.put(row, JUDGING_TABLE, !existing);
    return settingsOut(row);
  },

  async rubricGet(ctx) {
    const row = (await db.getOne(rubricId(ctx.scope), JUDGING_TABLE)) as Row | null;
    if (!row) throw new ActionError("RubricNotFound", "No rubric has been set for this event.");
    return rubricOut(row);
  },

  async rubricSet(ctx, input) {
    const { eventID, year, ...fields } = input;
    void eventID;
    void year;
    if (!fields.criteria.length) throw new ActionError("InvalidRubric", "A rubric needs at least one criterion.");
    if (fields.scaleMax <= 0) throw new ActionError("InvalidRubric", "scaleMax must be positive.");
    const ids = new Set<string>();
    for (const c of fields.criteria) {
      if (ids.has(c.id)) throw new ActionError("InvalidRubric", `Duplicate criterion id "${c.id}".`);
      ids.add(c.id);
      if (c.maxScore !== undefined && c.maxScore <= 0) throw new ActionError("InvalidRubric", `Criterion "${c.id}" has a non-positive maxScore.`);
    }
    const existing = await db.getOne(rubricId(ctx.scope), JUDGING_TABLE);
    const row: Row = {
      id: rubricId(ctx.scope),
      type: "rubric",
      "eventID;year": eventKey(ctx.scope),
      ...fields,
      updatedAt: now()
    };
    await db.put(row, JUDGING_TABLE, !existing);
    return rubricOut(row);
  },

  async teamsList(ctx) {
    return (await listTeamRows(ctx.scope)).map((row) => teamOut(ctx, row)).sort(byName);
  },

  async teamsCreate(ctx, input) {
    const id = randomUUID();
    const row: Row = {
      id,
      "eventID;year": eventKey(ctx.scope),
      teamName: input.name,
      memberNames: input.members,
      memberIDs: [],
      scannedQRs: [],
      points: 0,
      pointsSpent: 0,
      transactions: [],
      inventory: [],
      metadata: {},
      submission: input.devpost ?? "",
      github: input.github,
      description: input.description,
      imageUrls: input.imageUrls ?? [],
      code: await issueCode(ctx.scope),
      createdAt: now()
    };
    await db.put(row, TEAMS_TABLE, true);
    return teamOut(ctx, row);
  },

  async teamGet(ctx, input) {
    return teamOut(ctx, await getTeamRow(ctx.scope, input.id));
  },

  async teamUpdate(ctx, input) {
    const existing = await getTeamRow(ctx.scope, input.id);
    const p = ctx.principal!;
    if (!isAdmin(ctx)) {
      if (!(p.role === "judgingCode" && p.id === input.id)) throw new ActionError("Forbidden", "Only the team itself or an organizer may edit a team.");
      const settings = (await db.getOne(settingsId(ctx.scope), JUDGING_TABLE)) as Row | null;
      if (settings?.phase !== "submission" || settings?.lockSubmissions) throw new ActionError("SubmissionsLocked", "Submissions are closed.");
      const max = Number(settings?.maxImages ?? 10);
      if ((input.imageUrls?.length ?? 0) > max) throw new ActionError("SubmissionsLocked", `At most ${max} images.`);
    }
    const row: Row = {
      ...existing,
      teamName: input.name,
      memberNames: input.members,
      submission: input.devpost ?? "",
      github: input.github,
      description: input.description,
      imageUrls: input.imageUrls ?? []
    };
    await db.put(row, TEAMS_TABLE, false);
    return teamOut(ctx, row);
  },

  async teamDelete(ctx, input) {
    await getTeamRow(ctx.scope, input.id);
    for (const r of await reviewsForTeam(input.id)) {
      await db.deleteOne(str(r.id), FEEDBACK_TABLE, {
        "teamID;round": r["teamID;round"]
      });
    }
    await db.deleteOne(input.id, TEAMS_TABLE, {
      "eventID;year": eventKey(ctx.scope)
    });
    return {
      message: `Deleted team ${input.id} and its reviews.`
    };
  },

  async judgesList(ctx) {
    return (await scanJudgeTable(ctx.scope, "judge")).map((row) => judgeOut(ctx, row)).sort(byName);
  },

  async judgesCreate(ctx, input) {
    const row: Row = {
      id: newId(),
      type: "judge",
      "eventID;year": eventKey(ctx.scope),
      name: input.name,
      isAdmin: !!input.isAdmin,
      assignedTeamIds: [],
      code: await issueCode(ctx.scope)
    };
    await db.put(row, JUDGING_TABLE, true);
    return judgeOut(ctx, row);
  },

  async judgesAutoAssign(ctx, input) {
    const settings = (await db.getOne(settingsId(ctx.scope), JUDGING_TABLE)) as Row | null;
    const per = input.perTeamJudges ?? Number(settings?.perTeamJudges ?? 2);
    const teams = (await listTeamRows(ctx.scope)).sort((a, b) => str(a.teamName).localeCompare(str(b.teamName)));
    const judges = (await scanJudgeTable(ctx.scope, "judge")).filter((j) => !j.isAdmin);
    if (!judges.length) throw new ActionError("NoJudges", "Create at least one non-admin judge first.");
    const buckets: Record<string, string[]> = Object.fromEntries(judges.map((j) => [str(j.id), [] as string[]]));
    teams.forEach((t, i) => {
      for (let k = 0; k < Math.min(per, judges.length); k++) buckets[str(judges[(i + k) % judges.length]!.id)]!.push(str(t.id));
    });
    for (const j of judges) {
      await db.put({
        ...j,
        assignedTeamIds: buckets[str(j.id)]
      }, JUDGING_TABLE, false);
    }
    return buckets;
  },

  async judgeGet(ctx, input) {
    const row = (await db.getOne(input.id, JUDGING_TABLE)) as Row | null;
    if (!row || row.type !== "judge") throw new ActionError("JudgeNotFound", `No judge ${input.id}.`);
    return judgeOut(ctx, row);
  },

  async judgeUpdate(ctx, input) {
    const row = (await db.getOne(input.id, JUDGING_TABLE)) as Row | null;
    if (!row || row.type !== "judge") throw new ActionError("JudgeNotFound", `No judge ${input.id}.`);
    if (input.name !== undefined) row.name = input.name;
    if (input.isAdmin !== undefined) row.isAdmin = input.isAdmin;
    if (input.assignedTeamIds !== undefined) row.assignedTeamIds = input.assignedTeamIds;
    await db.put(row, JUDGING_TABLE, false);
    return judgeOut(ctx, row);
  },

  async judgeDelete(ctx, input) {
    const row = (await db.getOne(input.id, JUDGING_TABLE)) as Row | null;
    if (!row || row.type !== "judge") throw new ActionError("JudgeNotFound", `No judge ${input.id}.`);
    await db.deleteOne(input.id, JUDGING_TABLE);
    return {
      message: `Deleted judge ${input.id}.`
    };
  },

  async reviewsList(ctx, input) {
    const visible = await reviewFilter(ctx, input);
    let rows: Row[];
    if (input.teamId) {
      rows = await reviewsForTeam(input.teamId);
    } else if (input.judgeId) {
      rows = (await db.query(FEEDBACK_TABLE, null, {
        expression: "#id = :judgeID",
        expressionValues: {
          ":judgeID": input.judgeId
        },
        expressionNames: {
          "#id": "id"
        }
      })) as Row[];
    } else {
      rows = (await db.scan(FEEDBACK_TABLE, {
        FilterExpression: "#ey = :ey",
        ExpressionAttributeNames: {
          "#ey": "eventID;year"
        },
        ExpressionAttributeValues: {
          ":ey": eventKey(ctx.scope)
        }
      })) as Row[];
    }
    return rows
      .filter((r) => r["eventID;year"] === eventKey(ctx.scope))
      .map(reviewOut)
      .filter(visible)
      .filter((r) => (!input.round || r.round === input.round) && (!input.judgeId || r.judgeId === input.judgeId))
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  },

  async reviewsSubmit(ctx, input) {
    const p = ctx.principal!;
    const settings = (await db.getOne(settingsId(ctx.scope), JUDGING_TABLE)) as Row | null;
    const phase = str(settings?.phase, "submission");
    if (phase !== "prelim" && phase !== "finals") throw new ActionError("PhaseClosed", `Judging is not open (phase is "${phase}").`);
    const round = phase as Round;
    const team = await getTeamRow(ctx.scope, input.teamId);
    if (round === "finals") {
      if (!strs(settings?.finalsTeamIds).includes(input.teamId)) throw new ActionError("PhaseClosed", "That team is not in the finals.");
      if (!isAdmin(ctx) && !strs(settings?.finalsJudgeIds).includes(p.id)) throw new ActionError("PhaseClosed", "You are not a finals judge.");
    }
    const rubricRow = (await db.getOne(rubricId(ctx.scope), JUDGING_TABLE)) as Row | null;
    if (!rubricRow) throw new ActionError("InvalidScores", "No rubric has been set, so scores cannot be validated.");
    const rubric = rubricOut(rubricRow);
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
    const key = {
      "teamID;round": `${input.teamId};${round}`
    };
    const existing = await db.getOne(p.id, FEEDBACK_TABLE, key);
    const row: Row = {
      id: p.id,
      ...key,
      teamID: input.teamId,
      round,
      "eventID;year": eventKey(ctx.scope),
      judgeName: p.name,
      teamName: str(team.teamName),
      scores: input.scores,
      feedback: input.feedback ?? "",
      total,
      weightedTotal,
      createdAt: now()
    };
    await db.put(row, FEEDBACK_TABLE, !existing);
    return reviewOut(row);
  },

  async reviewGet(ctx, input) {
    const { round, teamId, judgeId } = parseReviewId(input.id);
    const row = (await db.getOne(judgeId, FEEDBACK_TABLE, {
      "teamID;round": `${teamId};${round}`
    })) as Row | null;
    if (!row) throw new ActionError("ReviewNotFound", `No review ${input.id}.`);
    const review = reviewOut(row);
    const visible = await reviewFilter(ctx, {
      teamId: review.teamId,
      judgeId: review.judgeId
    });
    if (!visible(review)) throw new ActionError("Forbidden", "Not visible to this caller.");
    return review;
  },

  async reviewDelete(ctx, input) {
    const { round, teamId, judgeId } = parseReviewId(input.id);
    const key = {
      "teamID;round": `${teamId};${round}`
    };
    if (!(await db.getOne(judgeId, FEEDBACK_TABLE, key))) throw new ActionError("ReviewNotFound", `No review ${input.id}.`);
    await db.deleteOne(judgeId, FEEDBACK_TABLE, key);
    return {
      message: `Deleted review ${input.id}.`
    };
  },

  async linksList(ctx) {
    return (await scanJudgeTable(ctx.scope, "link")).map(linkOut).sort((a, b) => a.order - b.order);
  },

  async linksCreate(ctx, input) {
    const existing = await scanJudgeTable(ctx.scope, "link");
    const id = newId();
    const row: Row = {
      id: linkId(ctx.scope, id),
      linkId: id,
      type: "link",
      "eventID;year": eventKey(ctx.scope),
      label: input.label,
      url: input.url,
      order: input.order ?? Math.max(0, ...existing.map((l) => Number(l.order))) + 1
    };
    await db.put(row, JUDGING_TABLE, true);
    return linkOut(row);
  },

  async linkDelete(ctx, input) {
    const id = linkId(ctx.scope, input.id);
    if (!(await db.getOne(id, JUDGING_TABLE))) throw new ActionError("LinkNotFound", `No link ${input.id}.`);
    await db.deleteOne(id, JUDGING_TABLE);
    return {
      message: `Deleted link ${input.id}.`
    };
  }
};

export default judgingImpl;
