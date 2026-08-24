import { v4 as uuidv4 } from "uuid";
import type { EventCounts } from "../../lib/types";
import registrationHelpers from "../registrations/helpers";
import type {
  RegistrationQuestion,
  RegistrationQuestionWithId,
} from "./types";

export interface EventsHelpers {
  /** Delegates to registrations/helpers — counts by registration status. */
  getEventCounts(eventID: string, year: number): Promise<EventCounts>;
  /** Ensures every question has a stable questionId (existing IDs kept). */
  addIdsToRegistrationQuestions(
    registrationQuestions: RegistrationQuestion[],
  ): RegistrationQuestionWithId[];
}

function addIdsToRegistrationQuestions(
  registrationQuestions: RegistrationQuestion[],
): RegistrationQuestionWithId[] {
  return registrationQuestions.map((question) => ({
    ...question,
    questionId: question.questionId ?? uuidv4(),
  }));
}

const eventHelpers: EventsHelpers = {
  getEventCounts: registrationHelpers.getEventCounts,
  addIdsToRegistrationQuestions,
};

export default eventHelpers;
