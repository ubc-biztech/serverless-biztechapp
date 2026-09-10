/**
 * End-to-end through the generated router with an in-memory store: the same code path as
 * production minus DynamoDB. Run with `npm test` in this directory (Node's built-in runner).
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "@ubc-biztech/sdk/server/judging";
import { JudgingImpl } from "../impl";
import { MemoryStore } from "../store";

const BOOT = "ORG-BOOT";
const store = new MemoryStore();
const handler = createHandler(new JudgingImpl(store, { bootstrapCode: BOOT }), () => {});
const E = "/judging/hellohacks/2027";

async function call<T = any>(method: string, path: string, opts: { token?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<{ status: number; body: T }> {
  const r = await handler({
    httpMethod: method,
    path,
    headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
    body: opts.body ? JSON.stringify(opts.body) : null,
    queryStringParameters: opts.query ?? null,
    requestContext: { requestId: "t" },
  });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
const ok = async <T = any>(...args: Parameters<typeof call>): Promise<T> => {
  const r = await call<T>(...args);
  assert.equal(r.status, 200, `${args[0]} ${args[1]} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

let judgeA: { id: string; code: string };
let judgeB: { id: string; code: string };
let teamX: { id: string; code: string };
let teamY: { id: string; code: string };

describe("judging service", () => {
  before(async () => {
    await ok("PUT", `${E}/settings`, { token: BOOT, body: { eventName: "HelloHacks 2027", phase: "submission", perTeamJudges: 2, finalsTopN: 2, finalsTeamIds: [], finalsJudgeIds: [], showTeamFeedback: false, allowJudgeSeeOthers: true, anonymizeTeams: false, lockSubmissions: false, maxImages: 10 } });
    await ok("PUT", `${E}/rubric`, { token: BOOT, body: { name: "Official", scaleMax: 5, scoreMode: "weighted", criteria: [{ id: "design", label: "Design", weight: 1 }, { id: "impact", label: "Impact", weight: 2 }] } });
    judgeA = await ok("POST", `${E}/judges`, { token: BOOT, body: { name: "Ada" } });
    judgeB = await ok("POST", `${E}/judges`, { token: BOOT, body: { name: "Bob" } });
    teamX = await ok("POST", `${E}/teams`, { token: BOOT, body: { name: "X", members: ["x1"] } });
    teamY = await ok("POST", `${E}/teams`, { token: BOOT, body: { name: "Y", members: ["y1"] } });
  });

  test("settings.get is public; unknown event is a declared 404", async () => {
    const s = await ok("GET", `${E}/settings`);
    assert.equal(s.eventName, "HelloHacks 2027");
    const r = await call("GET", "/judging/nope/1999/settings");
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "EventNotFound");
  });

  test("codes: login resolves role; codes are hidden from non-admins; bootstrap is admin", async () => {
    const who = await ok("POST", `${E}/session/login`, { body: { code: judgeA.code.toLowerCase() } });
    assert.deepEqual(who, { role: "judge", id: judgeA.id, name: "Ada", eventName: "HelloHacks 2027" });
    const team = await ok("POST", `${E}/session/login`, { body: { code: teamX.code } });
    assert.equal(team.role, "team");
    assert.equal((await call("POST", `${E}/session/login`, { body: { code: "ZZZZ-ZZZZ" } })).status, 404);
    const asJudge = await ok("GET", `${E}/teams`, { token: judgeA.code });
    assert.equal(asJudge[0].code, undefined);
    const asAdmin = await ok("GET", `${E}/teams`, { token: BOOT });
    assert.ok(asAdmin[0].code);
    assert.equal((await ok("GET", `${E}/session`, { token: BOOT })).role, "judgingAdmin");
  });

  test("role gates: judge cannot create teams (403); team code cannot list judges", async () => {
    assert.equal((await call("POST", `${E}/teams`, { token: judgeA.code, body: { name: "Z", members: [] } })).status, 403);
    assert.equal((await call("GET", `${E}/judges`, { token: teamX.code })).status, 403);
    assert.equal((await call("GET", `${E}/teams`)).status, 401);
  });

  test("a team may edit only itself, only during submission, within the image cap", async () => {
    const r = await call("PUT", `${E}/teams/${teamX.id}`, { token: teamX.code, body: { name: "X!", members: ["x1"], github: "https://g" } });
    assert.equal(r.status, 200);
    assert.equal(r.body.github, "https://g");
    assert.equal((await call("PUT", `${E}/teams/${teamY.id}`, { token: teamX.code, body: { name: "hack", members: [] } })).status, 403);
    const tooMany = await call("PUT", `${E}/teams/${teamX.id}`, { token: teamX.code, body: { name: "X!", members: ["x1"], imageUrls: Array(11).fill("https://i") } });
    assert.equal(tooMany.body.error, "SubmissionsLocked");
  });

  test("judges see only their own reviews when allowJudgeSeeOthers is off", async () => {
    // phase is still submission here; flip to prelim with visibility off, submit as A, read as B.
    await ok("PUT", `${E}/settings`, { token: BOOT, body: { eventName: "HelloHacks 2027", phase: "prelim", perTeamJudges: 2, finalsTopN: 2, finalsTeamIds: [], finalsJudgeIds: [], showTeamFeedback: false, allowJudgeSeeOthers: false, anonymizeTeams: false, lockSubmissions: false, maxImages: 10 } });
    await ok("POST", `${E}/reviews`, { token: judgeA.code, body: { teamId: teamY.id, scores: { design: 1, impact: 1 } } });
    assert.equal((await ok("GET", `${E}/reviews`, { token: judgeB.code })).length, 0);
    assert.equal((await ok("GET", `${E}/reviews`, { token: judgeA.code })).length, 1);
    assert.equal((await call("GET", `${E}/reviews`, { token: judgeB.code, query: { judgeId: judgeA.id } })).status, 403);
    // and once submissions have closed, the team can no longer edit itself
    assert.equal((await call("PUT", `${E}/teams/${teamX.id}`, { token: teamX.code, body: { name: "late", members: [] } })).body.error, "SubmissionsLocked");
    await ok("DELETE", `${E}/reviews/prelim__${teamY.id}__${judgeA.id}`, { token: BOOT });
    await ok("PUT", `${E}/settings`, { token: BOOT, body: { eventName: "HelloHacks 2027", phase: "submission", perTeamJudges: 2, finalsTopN: 2, finalsTeamIds: [], finalsJudgeIds: [], showTeamFeedback: false, allowJudgeSeeOthers: true, anonymizeTeams: false, lockSubmissions: false, maxImages: 10 } });
  });

  test("autoAssign round-robins teams across non-admin judges", async () => {
    const buckets = await ok("POST", `${E}/judges/auto-assign`, { token: BOOT, body: {} });
    assert.deepEqual(Object.keys(buckets).sort(), [judgeA.id, judgeB.id].sort());
    assert.equal(buckets[judgeA.id].length, 2);
    const a = await ok("GET", `${E}/judges/${judgeA.id}`, { token: judgeA.code });
    assert.equal(a.assignedTeamIds.length, 2);
  });

  test("submit is refused while phase is setup, validated against the rubric, computes totals, and replaces on resubmit", async () => {
    assert.equal((await call("POST", `${E}/reviews`, { token: judgeA.code, body: { teamId: teamX.id, scores: { design: 5, impact: 4 } } })).body.error, "PhaseClosed");
    await ok("PUT", `${E}/settings`, { token: BOOT, body: { eventName: "HelloHacks 2027", phase: "prelim", perTeamJudges: 2, finalsTopN: 2, finalsTeamIds: [], finalsJudgeIds: [], showTeamFeedback: false, allowJudgeSeeOthers: true, anonymizeTeams: false, lockSubmissions: false, maxImages: 10 } });
    const bad = await call("POST", `${E}/reviews`, { token: judgeA.code, body: { teamId: teamX.id, scores: { design: 5 } } });
    assert.equal(bad.body.error, "InvalidScores");
    assert.equal((await call("POST", `${E}/reviews`, { token: judgeA.code, body: { teamId: teamX.id, scores: { design: 9, impact: 4 } } })).body.error, "InvalidScores");
    const r1 = await ok("POST", `${E}/reviews`, { token: judgeA.code, body: { teamId: teamX.id, scores: { design: 5, impact: 4 }, feedback: "nice" } });
    assert.equal(r1.total, 9);
    assert.equal(r1.weightedTotal, 13);
    assert.equal(r1.id, `prelim__${teamX.id}__${judgeA.id}`);
    const r2 = await ok("POST", `${E}/reviews`, { token: judgeA.code, body: { teamId: teamX.id, scores: { design: 3, impact: 3 } } });
    assert.equal(r2.id, r1.id);
    const all = await ok("GET", `${E}/reviews`, { token: judgeA.code });
    assert.equal(all.length, 1);
    assert.equal(all[0].total, 6);
  });

  test("teams see their own reviews only when results are public", async () => {
    assert.equal((await call("GET", `${E}/reviews`, { token: teamX.code, query: { teamId: teamX.id } })).status, 403);
    await ok("PUT", `${E}/settings`, { token: BOOT, body: { eventName: "HelloHacks 2027", phase: "prelim", perTeamJudges: 2, finalsTopN: 2, finalsTeamIds: [], finalsJudgeIds: [], showTeamFeedback: true, allowJudgeSeeOthers: true, anonymizeTeams: false, lockSubmissions: false, maxImages: 10 } });
    assert.equal((await ok("GET", `${E}/reviews`, { token: teamX.code, query: { teamId: teamX.id } })).length, 1);
    assert.equal((await call("GET", `${E}/reviews`, { token: teamX.code, query: { teamId: teamY.id } })).status, 403);
    const unfiltered = await ok("GET", `${E}/reviews`, { token: teamX.code });
    assert.ok(unfiltered.every((r: any) => r.teamId === teamX.id), "a team asking for everything gets only its own rows");
  });

  test("finals: only finals judges may score finalist teams", async () => {
    await ok("PUT", `${E}/settings`, { token: BOOT, body: { eventName: "HelloHacks 2027", phase: "finals", perTeamJudges: 2, finalsTopN: 1, finalsTeamIds: [teamX.id], finalsJudgeIds: [judgeB.id], showTeamFeedback: true, allowJudgeSeeOthers: true, anonymizeTeams: false, lockSubmissions: false, maxImages: 10 } });
    assert.equal((await call("POST", `${E}/reviews`, { token: judgeA.code, body: { teamId: teamX.id, scores: { design: 1, impact: 1 } } })).body.error, "PhaseClosed");
    assert.equal((await call("POST", `${E}/reviews`, { token: judgeB.code, body: { teamId: teamY.id, scores: { design: 1, impact: 1 } } })).body.error, "PhaseClosed");
    const f = await ok("POST", `${E}/reviews`, { token: judgeB.code, body: { teamId: teamX.id, scores: { design: 5, impact: 5 } } });
    assert.equal(f.round, "finals");
    assert.equal((await ok("GET", `${E}/reviews`, { token: BOOT, query: { round: "finals" } })).length, 1);
  });

  test("deleting a team removes its reviews and its code", async () => {
    await ok("DELETE", `${E}/teams/${teamX.id}`, { token: BOOT });
    assert.equal((await call("POST", `${E}/session/login`, { body: { code: teamX.code } })).status, 404);
    assert.equal((await ok("GET", `${E}/reviews`, { token: BOOT })).length, 0);
    assert.equal((await call("GET", `${E}/teams/${teamX.id}`, { token: BOOT })).body.error, "TeamNotFound");
  });

  test("links are public to read, admin to write, ordered", async () => {
    await ok("POST", `${E}/links`, { token: BOOT, body: { label: "Rules", url: "https://r" } });
    const l2 = await ok("POST", `${E}/links`, { token: BOOT, body: { label: "Discord", url: "https://d", order: 0 } });
    const links = await ok("GET", `${E}/links`);
    assert.deepEqual(links.map((l: any) => l.label), ["Discord", "Rules"]);
    assert.equal((await call("POST", `${E}/links`, { token: judgeA.code, body: { label: "x", url: "y" } })).status, 403);
    await ok("DELETE", `${E}/links/${l2.id}`, { token: BOOT });
  });

  test("every declared action is implemented (no 501s)", async () => {
    const { routes } = await import("@ubc-biztech/sdk/server/judging");
    const impl = new JudgingImpl(store, { bootstrapCode: BOOT }) as unknown as Record<string, unknown>;
    const missing = routes.filter((r) => typeof impl[r.method] !== "function").map((r) => r.key);
    assert.deepEqual(missing, []);
  });
});
