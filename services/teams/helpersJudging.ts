import { randomBytes } from "node:crypto";
import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers";
import { JUDGING_TABLE } from "../../constants/tables.js";
import { APIGatewayEvent, APIGatewayResponse, LambdaHandler } from "../../lib/types";
import { JudgingDocument, JudgingPrincipal } from "./types";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROLE_RANK = {
  team: 0,
  judge: 1
};

/**
 * Teams and judges sign in with a code minted by an organizer and send it in this header.
 * Organizers don't use codes: their routes go through protect(Access.ADMIN) (lib/auth.ts).
 */
export const JUDGING_CODE_HEADER = "x-judging-code";

export const JUDGING_PHASES = ["submission", "prelim", "finals", "closed"];

export const eventKeyOf = (event: APIGatewayEvent): string =>
  `${event.pathParameters?.eventID};${event.pathParameters?.year}`;

export const newCode = (): string => {
  const s = [...randomBytes(8)].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
};

export const getDocument = (eventKey: string): Promise<JudgingDocument | null> =>
  db.getOne(`JUDGING#${eventKey}`, JUDGING_TABLE) as Promise<JudgingDocument | null>;

export const putDocument = (eventKey: string, doc: JudgingDocument, createNew: boolean) =>
  db.put({
    id: `JUDGING#${eventKey}`,
    "eventID;year": eventKey,
    ...doc,
    updatedAt: new Date().toISOString()
  }, JUDGING_TABLE, createNew);

export const resolveCode = (doc: JudgingDocument | null, rawCode: string): JudgingPrincipal | null => {
  const code = rawCode.replace(/\s+/g, "").toUpperCase();
  const judge = doc?.judges.find((j) => j.code === code);
  if (judge) {
    return {
      role: "judge",
      id: judge.id,
      name: judge.name
    };
  }
  const team = doc?.teams.find((t) => t.code === code);
  return team ? {
    role: "team",
    id: team.id,
    name: team.name
  } : null;
};

/** The code from the X-Judging-Code header, or "" when there isn't one. */
export const judgingCodeOf = (event: APIGatewayEvent): string => {
  // API Gateway keeps header names as the client sent them, so compare case-insensitively.
  const headers = event.headers || {};
  const name = Object.keys(headers).find((key) => key.toLowerCase() === JUDGING_CODE_HEADER);
  return name ? (headers[name] || "").trim() : "";
};

export const authorize = (event: APIGatewayEvent, doc: JudgingDocument | null, minRole: JudgingPrincipal["role"]): JudgingPrincipal => {
  const code = judgingCodeOf(event);
  const principal = code ? resolveCode(doc, code) : null;
  if (!principal) {
    throw helpers.createResponse(401, { message: code ? "Code not recognized" : "Send your judging code in the X-Judging-Code header" });
  }
  if (ROLE_RANK[principal.role] < ROLE_RANK[minRole]) {
    throw helpers.createResponse(403, { message: `This requires the ${minRole} role` });
  }
  return principal;
};

export const handle = (fn: (event: APIGatewayEvent) => Promise<APIGatewayResponse>): LambdaHandler => async (event) => {
  try {
    return await fn(event);
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "statusCode" in err) {
      return err as APIGatewayResponse;
    }
    console.error(err);
    return helpers.createResponse(500, { message: "Internal server error" });
  }
};

export const redact = (doc: JudgingDocument, role: JudgingPrincipal["role"] | "admin" | null) => {
  if (role === null) {
    return {
      settings: {
        eventName: doc.settings.eventName,
        phase: doc.settings.phase
      },
      links: doc.links
    };
  }
  const stripCodes = <T extends { code?: string }>(rows: T[]) => rows.map(({ code, ...row }) => (role === "admin" ? {
    ...row,
    code
  } : row));
  const { updatedAt, settings, rubric, links, judges, teams } = doc;
  return {
    updatedAt,
    settings,
    rubric,
    links,
    judges: stripCodes(judges),
    teams: stripCodes(teams)
  };
};

export const toReview = (row: Record<string, any>) => {
  const [teamId, round] = String(row["teamID;round"]).split(";");
  return {
    id: `${round}__${teamId}__${row.id}`,
    round,
    teamId,
    judgeId: row.id,
    judgeName: row.judgeName,
    scores: row.scores || {},
    feedback: row.feedback || "",
    total: row.total || 0,
    weightedTotal: row.weightedTotal || 0,
    completedAt: row.createdAt
  };
};
