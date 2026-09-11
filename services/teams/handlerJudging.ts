import { randomUUID } from "node:crypto";
import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers";
import { FEEDBACK_TABLE } from "../../constants/tables.js";
import { JudgingDocument } from "./types";
import {
  JUDGING_PHASES,
  authorize,
  bearerCode,
  eventKeyOf,
  getDocument,
  handle,
  newCode,
  putDocument,
  redact,
  toReview
} from "./helpersJudging";

/** GET /judging/{eventID}/{year} */
export const judgingGet = handle(async (event) => {
  const eventKey = eventKeyOf(event);
  const doc = await getDocument(eventKey);
  const me = bearerCode(event) ? authorize(event, doc, "team") : null;
  if (!doc) {
    return helpers.notFoundResponse("judging", eventKey);
  }
  return helpers.createResponse(200, me ? {
    me,
    ...redact(doc, me.role)
  } : redact(doc, null));
});

/** PUT /judging/{eventID}/{year} */
export const judgingPut = handle(async (event) => {
  const eventKey = eventKeyOf(event);
  const existing = await getDocument(eventKey);
  authorize(event, existing, "admin");
  const data = JSON.parse(event.body || "{}");
  helpers.checkPayloadProps(data, {
    settings: { required: true, type: "object" },
    links: { required: true, type: "object" },
    judges: { required: true, type: "object" },
    teams: { required: true, type: "object" }
  });
  if (!JUDGING_PHASES.includes(data.settings.phase)) {
    return helpers.inputError(`settings.phase must be one of ${JUDGING_PHASES.join(", ")}`);
  }
  const criteria: Array<{ id: string }> = data.rubric?.criteria || [];
  if (new Set(criteria.map((c) => c.id)).size !== criteria.length) {
    return helpers.inputError("rubric criteria ids must be unique");
  }
  const withCodes = <T extends { id?: string; code?: string }>(rows: T[]) => rows.map((row) => ({
    ...row,
    id: row.id || randomUUID(),
    code: row.code || newCode()
  }));
  const doc: JudgingDocument = {
    settings: data.settings,
    rubric: data.rubric || null,
    links: data.links,
    judges: withCodes(data.judges),
    teams: withCodes(data.teams),
    updatedAt: ""
  };
  await putDocument(eventKey, doc, !existing);
  return helpers.createResponse(200, redact(doc, "admin"));
});

/** PUT /judging/{eventID}/{year}/teams/{id} */
export const judgingPutTeam = handle(async (event) => {
  const eventKey = eventKeyOf(event);
  const doc = await getDocument(eventKey);
  const auth = authorize(event, doc, "team");
  const id = event.pathParameters?.id as string;
  const team = doc?.teams.find((t) => t.id === id);
  if (!doc || !team) {
    return helpers.notFoundResponse("team", id);
  }
  if (auth.role !== "admin" && auth.id !== id) {
    return helpers.createResponse(403, { message: "Only the team itself or an organizer may edit a team" });
  }
  if (auth.role !== "admin" && (doc.settings.phase !== "submission" || doc.settings.lockSubmissions)) {
    return helpers.createResponse(409, { message: "Submissions are closed" });
  }
  const data = JSON.parse(event.body || "{}");
  helpers.checkPayloadProps(data, {
    name: { required: true, type: "string" },
    members: { required: true, type: "object" }
  });
  const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls : [];
  if (imageUrls.length > doc.settings.maxImages) {
    return helpers.createResponse(409, { message: `At most ${doc.settings.maxImages} images` });
  }
  Object.assign(team, {
    name: data.name,
    members: data.members,
    description: data.description,
    github: data.github,
    devpost: data.devpost,
    imageUrls
  });
  await putDocument(eventKey, doc, false);
  return helpers.createResponse(200, {
    ...team,
    code: undefined
  });
});

/** GET /judging/{eventID}/{year}/reviews?round=&teamId=&judgeId= */
export const judgingGetReviews = handle(async (event) => {
  const eventKey = eventKeyOf(event);
  const doc = await getDocument(eventKey);
  const auth = authorize(event, doc, "team");
  if (auth.role === "team" && !doc?.settings.showTeamFeedback) {
    return helpers.createResponse(403, { message: "Results are not public yet" });
  }
  const ownOnly = auth.role === "team" || (auth.role === "judge" && doc?.settings.allowJudgeSeeOthers === false);
  const query = event.queryStringParameters || {};
  const rows = await db.scan(FEEDBACK_TABLE, {
    FilterExpression: "#ey = :ey",
    ExpressionAttributeNames: { "#ey": "eventID;year" },
    ExpressionAttributeValues: { ":ey": eventKey }
  });
  const reviews = rows.map(toReview)
    .filter((r) => !ownOnly || (auth.role === "team" ? r.teamId === auth.id : r.judgeId === auth.id))
    .filter((r) => (!query.round || r.round === query.round) && (!query.teamId || r.teamId === query.teamId) && (!query.judgeId || r.judgeId === query.judgeId))
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  return helpers.createResponse(200, reviews);
});

/** PUT /judging/{eventID}/{year}/reviews/{teamId} */
export const judgingPutReview = handle(async (event) => {
  const eventKey = eventKeyOf(event);
  const doc = await getDocument(eventKey);
  const auth = authorize(event, doc, "judge");
  const data = JSON.parse(event.body || "{}");
  helpers.checkPayloadProps(data, { scores: { required: true, type: "object" } });
  const teamId = event.pathParameters?.teamId as string;
  const phase = doc?.settings.phase;
  if (!doc || !doc.rubric || (phase !== "prelim" && phase !== "finals")) {
    return helpers.createResponse(409, { message: `Judging is not open (phase is "${phase || "unset"}")` });
  }
  const team = doc.teams.find((t) => t.id === teamId);
  if (!team) {
    return helpers.notFoundResponse("team", teamId);
  }
  if (phase === "finals" && (!doc.settings.finalsTeamIds.includes(team.id) || (auth.role !== "admin" && !doc.settings.finalsJudgeIds.includes(auth.id)))) {
    return helpers.createResponse(409, { message: "Not a finals team, or you are not a finals judge" });
  }
  const { criteria, scaleMax } = doc.rubric;
  const scores = data.scores as Record<string, number>;
  for (const c of criteria) {
    const max = c.maxScore || scaleMax;
    if (typeof scores[c.id] !== "number" || scores[c.id] < 0 || scores[c.id] > max) {
      return helpers.inputError(`"${c.label}" needs a score between 0 and ${max}`);
    }
  }
  if (Object.keys(scores).some((key) => !criteria.some((c) => c.id === key))) {
    return helpers.inputError("scores has a key that is not a rubric criterion");
  }
  const sortKey = { "teamID;round": `${team.id};${phase}` };
  const existing = await db.getOne(auth.id, FEEDBACK_TABLE, sortKey);
  const row = {
    id: auth.id,
    ...sortKey,
    teamID: team.id,
    "eventID;year": eventKey,
    judgeName: auth.name,
    teamName: team.name,
    scores,
    feedback: typeof data.feedback === "string" ? data.feedback : "",
    total: criteria.reduce((sum, c) => sum + scores[c.id], 0),
    weightedTotal: criteria.reduce((sum, c) => sum + scores[c.id] * c.weight, 0),
    createdAt: new Date().toISOString()
  };
  await db.put(row, FEEDBACK_TABLE, !existing);
  return helpers.createResponse(200, toReview(row));
});
