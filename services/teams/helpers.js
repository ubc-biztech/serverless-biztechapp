import {
  v4 as uuidv4
} from "uuid";
import {
  USER_REGISTRATIONS_TABLE, TEAMS_TABLE
} from "../../constants/tables";
import helpers from "../../lib/handlerHelpers.js";
import db from "../../lib/db.js";

/*
  Team Table Schema from DynamoDB:
    {
    "id": "string", [PARTITION KEY]
    "team_name": "string",
    "eventID;year": "string;number", [SORT KEY]
    "memberIDs": "string[]",
    "scannedQRs": "string[]",
    "points": "number",
    "pointsSpent": "number",
    "transactions": "string[]",
    "inventory": "string[]",
    "submission": "string",
    "metadata": object
 */

export default {
  async _getTeamFromUserRegistration(userID, eventID, year) {
    /*
        Returns the Team object of the team that the user is on.
    */

    const eventID_year = eventID + ";" + year;

    return await db
      .getOne(userID, USER_REGISTRATIONS_TABLE, {
        "eventID;year": eventID_year
      })
      .then((res) => {
        if (res) {
          return res.teamID;
        } else {
          return null;
        }
      })
      .then((teamID) => {
        if (teamID) {
          return db.getOne(teamID, TEAMS_TABLE, {
            "eventID;year": eventID_year
          });
        } else {
          return null;
        }
      });
  },
  async _putTeam(team, createNew) {
    /*
        Puts a team in the Teams table according to the Table Schema.
        Partition key is teamID, sort key is eventID;year
   */
    return await db.put(team, TEAMS_TABLE, createNew);
  },

  async makeTeam(team_name, eventID, year, memberIDs) {
    /*
      Creates a team in the Teams table according to the Table Schema.
     */

    const eventID_year = eventID + ";" + year;

    // First, check if ALL members are registered for the event with eventID;year. Iterate through memberIDs.
    for (let i = 0; i < memberIDs.length; i++) {
      const memberID = memberIDs[i];

      // get user's registration
      await db
        .getOne(memberID, USER_REGISTRATIONS_TABLE, {
          "eventID;year": eventID_year
        })
        .then((res) => {
          if (!res) {
            throw helpers.inputError(
              "User " +
                memberID +
                " is not registered for event " +
                eventID_year,
              403
            );
          }
        });
    }

    const params = {
      id: uuidv4(),
      teamName: team_name,
      "eventID;year": eventID + ";" + year,
      memberIDs: memberIDs,
      scannedQRs: [],
      points: 0,
      pointsSpent: 0,
      transactions: [],
      inventory: [],
      submission: "",
      metadata: {
      }
    };

    try {
      // Create the new team=
      await db.put(params, TEAMS_TABLE, true);

      // Update all members' teamIDs in the User Registrations table
      for (let i = 0; i < memberIDs.length; i++) {
        const memberID = memberIDs[i];

        // Get the user's registration
        const res = await db.getOne(memberID, USER_REGISTRATIONS_TABLE, {
          "eventID;year": eventID_year,
        });

        if (res.teamID) {
          // If user is already on a team, remove them from that team on the Teams table
          const team = await this._getTeamFromUserRegistration(
            memberID,
            eventID,
            year
          );
          team.memberIDs = team.memberIDs.filter((id) => id !== memberID);
          await this._putTeam(team, false);
        }

        res.teamID = params.id;

        let conditionExpression = "attribute_exists(id) and attribute_exists(#eventIDYear)";
        const {
          updateExpression,
          expressionAttributeValues,
          expressionAttributeNames
        } = db.createUpdateExpression(res);

        let updateParams = {
          Key: {
            id: res.id,
            ["eventID;year"]: eventID + ";" + year
          },
          TableName:
            USER_REGISTRATIONS_TABLE +
            (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
          ExpressionAttributeValues: expressionAttributeValues,
          ExpressionAttributeNames: {
            ...expressionAttributeNames,
            "#eventIDYear": "eventID;year"
          },
          UpdateExpression: updateExpression,
          ReturnValues: "UPDATED_NEW",
          ConditionExpression: conditionExpression
        };

        await db.updateDBCustom(updateParams);
      }

      // Return the newly created team
      return params;
    } catch (error) {
      console.log(error);
      throw new Error(error);
    }
  },
  async checkQRScanned(user_id, qr_code_id, eventID, year) {
    /*
        Checks if a user's team has already scanned a QR code. Return true if they have, false if they haven't.
        This method might not make sense in the far future, but it's here so that the QR microservice can quickly check :')
        PLEASE REVISIT
   */

    // get user's team using helper function _getTeamFromUserRegistration
    return await this._getTeamFromUserRegistration(user_id, eventID, year)
      .then((team) => {
        // check if qr_code_id is in scannedQRs
        return team.scannedQRs.includes(qr_code_id);
      })
      .catch((err) => {
        console.log(err);
        throw new Error(err);
      });
  },
  async addQRScan(user_id, qr_code_id, eventID, year, points) {
    /*
        Adds a QR code to the scannedQRs array of a user's team.
   */

    // get user's team using helper function _getTeamFromUserRegistration
    return await this._getTeamFromUserRegistration(user_id, eventID, year).then(
      (team) => {
        // add qr_code_id to scannedQRs
        team.scannedQRs.push(qr_code_id);

        // if points is non-zero, add points to team.
        if (points !== 0) {
          team.points += points;
        }

        // if points are negative, add absolute points to team's pointsSpent.
        if (points < 0) {
          team.pointsSpent += points * -1;
        }

        // put team in Teams table
        return new Promise((resolve, reject) => {
          this._putTeam(team, false)
            .then((res) => {
              resolve(res);
            })
            .catch((err) => {
              reject(err);
            });
        });
      }
    );
  },
  async changeTeamName(user_id, eventID, year, team_name) {
    /*
        Changes a team's name in the Teams table
   */

    return await this._getTeamFromUserRegistration(user_id, eventID, year).then(
      (team) => {
        team.teamName = team_name;

        return new Promise((resolve, reject) => {
          this._putTeam(team, false)
            .then((res) => {
              resolve(res);
            })
            .catch((err) => {
              reject(err);
            });
        });
      }
    );
  }
};
