import AWS from "../../lib/aws";
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
          return new Promise((resolve, reject) => {
            const docClient = new AWS.DynamoDB.DocumentClient();

            // Partition key is teamID, sort key is eventID;year
            const params = {
              TableName:
                TEAMS_TABLE +
                (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
              Key: {
                id: teamID,
                "eventID;year": eventID_year
              }
            };

            docClient.get(params, (err, data) => {
              if (err) {
                reject(err);
              } else {
                resolve(data.Item);
              }
            });
          });
        } else {
          return null;
        }
      });
  },
  async _putTeam(team) {
    /*
        Puts a team in the Teams table according to the Table Schema.
        Partition key is teamID, sort key is eventID;year
   */

    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
      TableName:
        TEAMS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      Item: team
    };

    return await docClient
      .put(params)
      .promise()
      .then((_) => {
        return team;
      });
  },
  async makeTeam(team_name, eventID, year, memberIDs) {
    /*
      Creates a team in the Teams table according to the Table Schema.
     */

    const docClient = new AWS.DynamoDB.DocumentClient();
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
      TableName:
        TEAMS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      Item: {
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
      }
    };

    try {
      return await docClient
        .put(params)
        .promise()
        .then((res) => {
          // update all members' teamIDs in the User Registrations table
          for (let i = 0; i < memberIDs.length; i++) {
            const memberID = memberIDs[i];

            // get user's registration
            db.getOne(memberID, USER_REGISTRATIONS_TABLE, {
              "eventID;year": eventID_year
            })
              .then((res) => {
                if (res.teamID) {
                  // if user is already on a team, remove them from that team on the Teams table
                  this._getTeamFromUserRegistration(
                    memberID,
                    eventID,
                    year
                  ).then((team) => {
                    team.memberIDs = team.memberIDs.filter(
                      (id) => id !== memberID
                    );
                    this._putTeam(team);
                  });
                }

                // update user's registration
                res.teamID = params.Item.id;

                docClient
                  .put({
                    TableName:
                      USER_REGISTRATIONS_TABLE +
                      (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
                    Item: res
                  })
                  .promise()
                  .then((res) => {})
                  .catch((err) => {
                    console.log(err);
                    throw new Error(err);
                  });
              })
              .catch((err) => {
                console.log(err);
                throw new Error(err);
              });
          }

          // return newly created team
          return params.Item;
        })
        .catch((err) => {
          console.log(err);
          throw new Error(err);
        });
    } catch (err) {
      console.log(err);
      throw new Error(err);
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
          this._putTeam(team)
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
          this._putTeam(team)
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
