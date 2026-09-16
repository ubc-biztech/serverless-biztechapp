import { randomUUID } from "node:crypto";
import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers";
import { Access, protect } from "../../lib/auth";
import { APIGatewayEvent } from "../../lib/types";
import { FEEDBACK_TABLE, JUDGING_TABLE } from "../../constants/tables.js";
import { JudgingDocument } from "./types";
import {
  JUDGING_PHASES,
  authorize,
  eventKeyOf,
  getDocument,
  handle,
  judgingCodeOf,
  newCode,
  putDocument,
  redact,
  toReview
} from "./helpersJudging";

const PORTAL_ID = "JUDGING_PORTAL";
const validScope = (data: { eventID?: unknown; year?: unknown }) =>
  typeof data.eventID === "string" &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.eventID) &&
  data.eventID.length <= 80 &&
  Number.isInteger(data.year) &&
  Number(data.year) >= 2000 &&
  Number(data.year) <= 2100;

const readBody = (body: string | null) => {
  try {
    const data = JSON.parse(body || "{}");
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch {
    /* Report malformed input below. */
  }
  throw helpers.inputError("Send a JSON object.");
};

/** Public metadata only. db.scan follows every DynamoDB page. */
export const judgingListEvents = protect(
  Access.PUBLIC,
  handle(async () => {
    const [rows, config] = await Promise.all([
      db.scan(JUDGING_TABLE, {
        FilterExpression: "begins_with(#id, :prefix)",
        ProjectionExpression:
          "#id, #settings.#name, #settings.#phase, #settings.#image",
        ExpressionAttributeNames: {
          "#id": "id",
          "#settings": "settings",
          "#name": "eventName",
          "#phase": "phase",
          "#image": "imageUrl"
        },
        ExpressionAttributeValues: { ":prefix": "JUDGING#" }
      }),
      db.getOne(PORTAL_ID, JUDGING_TABLE)
    ]);
    const events = rows
      .flatMap((row) => {
        const match = /^JUDGING#(.+);(\d{4})$/.exec(String(row.id));
        const settings = row.settings as JudgingDocument["settings"] | undefined;
        if (
          !match ||
          !settings ||
          typeof settings.eventName !== "string" ||
          !JUDGING_PHASES.includes(settings.phase)
        )
          return [];
        const scope = { eventID: match[1], year: Number(match[2]) };
        if (!validScope(scope)) return [];
        return [
          {
            ...scope,
            eventName: settings.eventName,
            phase: settings.phase,
            ...(typeof settings.imageUrl === "string"
              ? { imageUrl: settings.imageUrl }
              : {})
          }
        ];
      })
      .sort((a, b) => b.year - a.year || a.eventName.localeCompare(b.eventName));
    const defaultEvent = events.find(
      (e) => e.eventID === config?.eventID && e.year === config?.year
    );
    return helpers.createResponse(200, {
      events,
      defaultEvent: defaultEvent
        ? { eventID: defaultEvent.eventID, year: defaultEvent.year }
        : null
    });
  })
);

/** Set the landing event without changing any event data. */
export const judgingSetDefault = protect(
  Access.ADMIN,
  handle(async (event) => {
    const data = readBody(event.body);
    if (!validScope(data))
      return helpers.inputError("Enter a valid event ID and year.");
    if (!(await getDocument(`${data.eventID};${data.year}`)))
      return helpers.notFoundResponse("judging", data.eventID);
    await db.updateDBCustom({
      TableName: JUDGING_TABLE + (process.env.ENVIRONMENT || ""),
      Key: { id: PORTAL_ID },
      UpdateExpression: "SET #eventID = :eventID, #year = :year",
      ExpressionAttributeNames: { "#eventID": "eventID", "#year": "year" },
      ExpressionAttributeValues: {
        ":eventID": data.eventID,
        ":year": data.year
      }
    });
    return helpers.createResponse(200, {
      eventID: data.eventID,
      year: data.year
    });
  })
);

/** Conditional create: choosing an existing ID cannot erase an event. */
export const judgingCreateEvent = protect(
  Access.ADMIN,
  handle(async (event) => {
    const data = readBody(event.body);
    if (
      !validScope(data) ||
      typeof data.eventName !== "string" ||
      !data.eventName.trim() ||
      data.eventName.trim().length > 120
    ) {
      return helpers.inputError(
        "Enter an event name (up to 120 characters), ID and year."
      );
    }
    const doc: JudgingDocument = {
      settings: {
        eventName: data.eventName.trim(),
        phase: "submission",
        finalsTeamIds: [],
        finalsJudgeIds: [],
        showTeamFeedback: false,
        allowJudgeSeeOthers: false,
        anonymizeTeams: false,
        lockSubmissions: false,
        maxImages: 10
      },
      rubric: null,
      links: [],
      judges: [],
      teams: [],
      updatedAt: new Date().toISOString()
    };
    try {
      await putDocument(`${data.eventID};${data.year}`, doc, true);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "ConditionalCheckFailedException"
      ) {
        return helpers.createResponse(409, {
          message:
            "An event with this ID and year already exists. Select it from Events."
        });
      }
      throw error;
    }
    return helpers.createResponse(201, redact(doc, "admin"));
  })
);

/** GET /judging/{eventID}/{year} — public view, or a team's/judge's view with X-Judging-Code */
export const judgingGet = handle(async (event) => {
  const eventKey = eventKeyOf(event);
  const doc = await getDocument(eventKey);
  const me = judgingCodeOf(event) ? authorize(event, doc, "team") : null;
  if (!doc) {
    return helpers.notFoundResponse("judging", eventKey);
  }
  return helpers.createResponse(200, me ? {
    me,
    ...redact(doc, me.role)
  } : redact(doc, null));
});

/** GET /judging/{eventID}/{year}/admin — organizer view, including every code */
export const judgingGetAdmin = protect(Access.ADMIN, handle(async (event) => {
  const eventKey = eventKeyOf(event);
  const doc = await getDocument(eventKey);
  if (!doc) {
    return helpers.notFoundResponse("judging", eventKey);
  }
  return helpers.createResponse(200, redact(doc, "admin"));
}));

/** PUT /judging/{eventID}/{year} — organizer only */
export const judgingPut = protect(Access.ADMIN, handle(async (event) => {
  const eventKey = eventKeyOf(event);
  const existing = await getDocument(eventKey);
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
  if (data.settings.imageUrl !== undefined && (typeof data.settings.imageUrl !== "string" ||
      (data.settings.imageUrl && !/^https:\/\//i.test(data.settings.imageUrl)))) {
    return helpers.inputError("Event image must be an HTTPS URL.");
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
}));

/** PUT /judging/{eventID}/{year}/teams/{id} — the team itself; organizers edit teams through PUT /judging/{eventID}/{year} */
export const judgingPutTeam = handle(async (event) => {
  const eventKey = eventKeyOf(event);
  const doc = await getDocument(eventKey);
  const auth = authorize(event, doc, "team");
  const id = event.pathParameters?.id as string;
  const team = doc?.teams.find((t) => t.id === id);
  if (!doc || !team) {
    return helpers.notFoundResponse("team", id);
  }
  if (auth.id !== id) {
    return helpers.createResponse(403, { message: "Only the team itself may edit its submission" });
  }
  if (doc.settings.phase !== "submission" || doc.settings.lockSubmissions) {
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

const listReviews = async (event: APIGatewayEvent, ownerFilter: (review: ReturnType<typeof toReview>) => boolean) => {
  const query = event.queryStringParameters || {};
  const rows = await db.scan(FEEDBACK_TABLE, {
    FilterExpression: "#ey = :ey",
    ExpressionAttributeNames: { "#ey": "eventID;year" },
    ExpressionAttributeValues: { ":ey": eventKeyOf(event) }
  });
  return rows.map(toReview)
    .filter(ownerFilter)
    .filter((r) => (!query.round || r.round === query.round) && (!query.teamId || r.teamId === query.teamId) && (!query.judgeId || r.judgeId === query.judgeId))
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
};

/** GET /judging/{eventID}/{year}/reviews?round=&teamId=&judgeId= — a team's or judge's reviews */
export const judgingGetReviews = handle(async (event) => {
  const doc = await getDocument(eventKeyOf(event));
  const auth = authorize(event, doc, "team");
  if (auth.role === "team" && !doc?.settings.showTeamFeedback) {
    return helpers.createResponse(403, { message: "Results are not public yet" });
  }
  const ownOnly = auth.role === "team" || doc?.settings.allowJudgeSeeOthers === false;
  const reviews = await listReviews(event, (r) => !ownOnly || (auth.role === "team" ? r.teamId === auth.id : r.judgeId === auth.id));
  return helpers.createResponse(200, reviews);
});

/** GET /judging/{eventID}/{year}/admin/reviews?round=&teamId=&judgeId= — every review, organizer only */
export const judgingGetAdminReviews = protect(Access.ADMIN, handle(async (event) => {
  return helpers.createResponse(200, await listReviews(event, () => true));
}));

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
  if (phase === "finals" && (!doc.settings.finalsTeamIds.includes(team.id) || !doc.settings.finalsJudgeIds.includes(auth.id))) {
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
