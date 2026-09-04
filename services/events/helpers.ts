import { v4 as uuidv4 } from "uuid";
import type { EventCounts } from "../../lib/types";
import helpers from "../../lib/handlerHelpers";
import registrationHelpers from "../registrations/helpers.js";
import type {
  RegistrationQuestion,
  RegistrationQuestionWithId,
} from "./types";

export const QA_CATEGORIES = new Set<string>(["Career", "Tech", "Networking", "General", "Other"]);
export const MAX_BODY_LENGTH = 500;
export const MAX_ANSWER_LENGTH = 2000;

/** Emails that must never reach the public Q&A response. */
const PRIVATE_QA_FIELDS = ["authorId", "updatedBy", "pinnedBy"] as const;

export interface QaPatchFields {
  answer?: unknown;
  isHidden?: unknown;
  isPinned?: unknown;
  body?: string;
}

export interface QaUpdateExpression {
  UpdateExpression: string;
  ExpressionAttributeValues: Record<string, any>;
  ExpressionAttributeNames?: Record<string, string>;
}

export interface EventsHelpers {
  /** Delegates to registrations/helpers — counts by registration status. */
  getEventCounts(eventID: string, year: number): Promise<EventCounts>;
  /** Ensures every question has a stable questionId (existing IDs kept). */
  addIdsToRegistrationQuestions(
    registrationQuestions: RegistrationQuestion[],
  ): RegistrationQuestionWithId[];
  /** Validates path params for event routes. Returns id, year, eventIDYear or throws. */
  validateEventPath(pathParams: Record<string, any> | null): {
    id: string;
    year: number;
    eventIDYear: string;
  };
  /** Validates a body is a non-empty string within max length. Returns trimmed. */
  validateBody(body: unknown, maxLength?: number): string;
  /** Validates category is in allowed list. Returns category or default. */
  validateCategory(category?: string): string;
  /** Validates email is admin (@ubcbiztech.com). Throws on violation. */
  validateAdminEmail(email?: string): string;
  /** Asserts a Cognito email claim is present. Throws on violation. */
  requireAuthEmail(email?: string): string;
  /** Validates an answer is a non-empty string within max length. Returns trimmed. */
  validateAnswer(answer: unknown, maxLength?: number): string;
  /** Strips private emails and reduces answeredBy to a display name. */
  toPublicQuestion(question: Record<string, any>): Record<string, any>;
  /** Builds the DynamoDB SET expression for a Q&A patch. */
  buildQaUpdateExpression(args: {
    updates: QaPatchFields;
    email: string;
    now: string;
  }): QaUpdateExpression;
}

function addIdsToRegistrationQuestions(
  registrationQuestions: RegistrationQuestion[],
): RegistrationQuestionWithId[] {
  return registrationQuestions.map((question) => ({
    ...question,
    questionId: question.questionId ?? uuidv4(),
  }));
}

function validateEventPath(pathParams: Record<string, any> | null) {
  if (!pathParams || !pathParams.id) throw helpers.missingIdQueryResponse("event");
  const id = pathParams.id;
  if (!pathParams.year) throw helpers.missingPathParamResponse("event", "year");

  const year = parseInt(pathParams.year, 10);
  if (isNaN(year))
    throw helpers.inputError("Year path parameter must be a number", pathParams);

  return { id, year, eventIDYear: `${id};${year}` };
}

function validateBody(body: unknown, maxLength = MAX_BODY_LENGTH) {
  if (typeof body !== "string" || !body.trim()) {
    throw helpers.inputError("Question body is required and must be a non-empty string");
  }
  const trimmed = body.trim();
  if (trimmed.length > maxLength) {
    throw helpers.inputError(`Question body cannot exceed ${maxLength} characters`, {
      length: trimmed.length,
    });
  }
  return trimmed;
}

function validateCategory(category?: string) {
  if (category && !QA_CATEGORIES.has(category)) {
    throw helpers.inputError("Invalid category", { category });
  }
  return category || "General";
}

function validateAdminEmail(email?: string) {
  if (!email || !email.endsWith("@ubcbiztech.com")) {
    throw helpers.createResponse(403, { message: "Admin access required." });
  }
  return email;
}

function requireAuthEmail(email?: string) {
  if (!email) {
    throw helpers.createResponse(403, { message: "Authentication required." });
  }
  return email;
}

function validateAnswer(answer: unknown, maxLength = MAX_ANSWER_LENGTH) {
  if (typeof answer !== "string" || !answer.trim()) {
    throw helpers.inputError("Answer is required and must be a non-empty string");
  }
  const trimmed = answer.trim();
  if (trimmed.length > maxLength) {
    throw helpers.inputError(`Answer cannot exceed ${maxLength} characters`, {
      length: trimmed.length,
    });
  }
  return trimmed;
}

function toPublicQuestion(question: Record<string, any>): Record<string, any> {
  const publicQuestion = { ...question };
  for (const field of PRIVATE_QA_FIELDS) delete publicQuestion[field];

  // The UI credits whoever answered, so send the name but never the address.
  if (typeof publicQuestion.answeredBy === "string") {
    publicQuestion.answeredBy = publicQuestion.answeredBy.split("@")[0];
  }

  return publicQuestion;
}

function buildQaUpdateExpression({
  updates,
  email,
  now,
}: {
  updates: QaPatchFields;
  email: string;
  now: string;
}): QaUpdateExpression {
  const setParts = ["updatedAt = :updatedAt", "updatedBy = :updatedBy"];
  const exprValues: Record<string, any> = {
    ":updatedAt": now,
    ":updatedBy": email,
  };
  const exprNames: Record<string, string> = {};

  if (updates.answer !== undefined) {
    setParts.push("answer = :answer", "answeredBy = :answeredBy");
    exprValues[":answer"] = updates.answer;
    exprValues[":answeredBy"] = email;
  }

  if (updates.isHidden !== undefined) {
    setParts.push("isHidden = :isHidden");
    exprValues[":isHidden"] = Boolean(updates.isHidden);
  }

  if (updates.isPinned !== undefined) {
    setParts.push("isPinned = :isPinned");
    exprValues[":isPinned"] = Boolean(updates.isPinned);
    if (updates.isPinned) {
      setParts.push("pinnedBy = :pinnedBy", "pinnedAt = :pinnedAt");
      exprValues[":pinnedBy"] = email;
      exprValues[":pinnedAt"] = now;
    }
  }

  if (updates.body !== undefined) {
    setParts.push("#qbody = :body");
    exprValues[":body"] = updates.body;
    exprNames["#qbody"] = "body";
  }

  return {
    UpdateExpression: `SET ${setParts.join(", ")}`,
    ExpressionAttributeValues: exprValues,
    ...(Object.keys(exprNames).length > 0 && {
      ExpressionAttributeNames: exprNames,
    }),
  };
}

const eventHelpers: EventsHelpers = {
  getEventCounts: registrationHelpers.getEventCounts,
  addIdsToRegistrationQuestions,
  validateEventPath,
  validateBody,
  validateCategory,
  validateAdminEmail,
  requireAuthEmail,
  validateAnswer,
  toPublicQuestion,
  buildQaUpdateExpression,
};

export default eventHelpers;
