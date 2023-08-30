import {
  v4 as uuidv4
} from "uuid";
import registrationHelpers from "../registrations/helpers";

import registrationHelpers from "../registrations/helpers";


export default {
  /**
   * Takes a semicolon separated event ID and year and returns an object containing
   * registeredCount, checkedInCount and waitlistCount for that event
   * @param {String} eventIDAndYear
   * @return {registeredCount checkedInCount waitlistCount}
   */
  getEventCounts: registrationHelpers.getEventCounts,
  /**
   * Inserts a unique uuid into each registrationQuestion, if it does not already exist
   * @param {Array} registrationQuestions
   * @returns a new Array, with a unique questionId in each question
   */
  addIdsToRegistrationQuestions: function (registrationQuestions) {
    return registrationQuestions.map((question) => {
      return {
        ...question,
        questionId: question.questionId || uuidv4()
      };
    });
  }
};
