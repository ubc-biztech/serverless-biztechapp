import docClient from "../../lib/docClient";
import {
  v4 as uuidv4
} from "uuid";
import {
  USER_REGISTRATIONS_TABLE
} from "../../constants/tables";

export default {
  /**
   * Takes a semicolon separated event ID and year and returns an object containing
   * registeredCount, checkedInCount and waitlistCount for that event
   * @param {String} eventIDAndYear
   * @return {registeredCount checkedInCount waitlistCount}
   */
  getEventCounts: async function (eventIDAndYear) {
    const params = {
      TableName: USER_REGISTRATIONS_TABLE + process.env.ENVIRONMENT,
      FilterExpression: "#eventIDYear = :query",
      ExpressionAttributeNames: {
        "#eventIDYear": "eventID;year"
      },
      ExpressionAttributeValues: {
        ":query": eventIDAndYear
      }
    };
    return await docClient
      .scan(params)
      .promise()
      .then((result) => {
        let counts = {
          registeredCount: 0,
          checkedInCount: 0,
          waitlistCount: 0
        };

        result.Items.forEach((item) => {
          if (!item.isPartner) {
            switch (item.registrationStatus) {
            case "registered":
              counts.registeredCount++;
              break;
            case "checkedIn":
              counts.checkedInCount++;
              break;
            case "waitlist":
              counts.waitlistCount++;
              break;
            }
          }
        });

        return counts;
      })
      .catch((error) => {
        console.error(error);
        return null;
      });
  },
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
