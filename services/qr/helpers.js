import docClient from "../../lib/docClient";
import {
  EVENTS_TABLE,
  TEAMS_TABLE,
  USER_REGISTRATIONS_TABLE,
  QRS_TABLE
} from "../../constants/tables";
import { isValidEmail } from "../../lib/utils.js";
import helpers from "../../lib/handlerHelpers.js";
import db from "../../lib/db.js";

export default {
  async checkValidQR(id, eventIDAndYear) {
    /* Check if QR code is valid and has a DynamoDB entry.

    Args:
        id (string): QR code ID
        eventIDAndYear (string): eventID and year separated by semicolon

    Returns:
        int: null if QR doesn't exist, or entry in QRs table if it does

     */

    return await db
      .getOne(id, QRS_TABLE, {
        "eventID;year": eventIDAndYear
      })
      .then((res) => {
        return res;
      });
  },
  async qrScanPostHelper(data, email) {
    /* Checks if the QR code is valid and if so, sends control flow to process the redemption.

       Args:
           data: object containing eventID, year, email, and registrationStatus
           email: email of user

       Returns:
           result (object): object containing updated points and the points redeemed from the QR code, or error 403 if the QR code is invalid.

    */

    const { eventID, year, qrCodeID, negativePointsConfirmed } = data;
    const eventIDAndYear = eventID + ";" + year;

    //Check if eventID exists and is string. Check if year exists and is number.
    if (
      typeof eventID !== "string" ||
      typeof year !== "number" ||
      isNaN(year) ||
      !isValidEmail(email)
    ) {
      throw helpers.inputError(
        "Incorrect types for eventID and year in registration.updateHelper",
        data
      );
    }

    return this.checkValidQR(qrCodeID, eventIDAndYear).then(async (qr) => {
      if (qr === null) {
        throw helpers.createResponse(403, {
          message: "Invalid QR code - not scannable for this BizTech event!",
          data: data
        });
      } else if (negativePointsConfirmed === false && qr.points < 0) {
        throw helpers.createResponse(405, {
          message:
            "Please confirm with the user that they want to redeem a negative point QR code.",
          data: data,
          qr_points: qr.points
        });
      } else {
        return await this.createRedemption(
          qr,
          data,
          email,
          eventIDAndYear,
          qrCodeID,
          eventID,
          year
        );
      }
    });
  },
  async createRedemption(
    qr,
    data,
    email,
    eventIDAndYear,
    qrCodeID,
    eventID,
    year
  ) {
    /* Processes a QR code redemption via DynamoDB — adds points to user's event registration (Registration table),
    adds the QR code key as being used (Registration table), then returns updated progress.

    Args:
      qr: object containing QR code information
      data: object containing eventID, year, email, and registrationStatus
      email: email of user
      eventIDAndYear: string containing eventID and year separated by semicolon
      qrCodeID: string of QR code ID

    Returns:
      result (object): object containing updated points and the points redeemed from the QR code, or -1 if the QR code already used.

     */

    try {
      // query the user's registration for the event
      const params = {
        TableName:
          USER_REGISTRATIONS_TABLE +
          (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
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
        .then(async (result) => {
          // find the user's registration
          const userRegistration = result.Items.find(
            (item) => item.id === email
          );

          // find the user's team if they are on one
          const isEventsTeamEnabled = await this._isEventTeamsEnabled(
            eventIDAndYear
          );

          // validate that user has not already scanned this QR code
          // Parse the user's scanned QR codes
          const scannedQRs = userRegistration.scannedQRs
            ? JSON.parse(userRegistration.scannedQRs)
            : [];
          // Check if the QR code has already been scanned
          const qrCodeAlreadyScanned = scannedQRs.includes(qrCodeID);

          if (
            qrCodeAlreadyScanned &&
            !qr.isUnlimitedScans &&
            !isEventsTeamEnabled
          ) {
            return {
              errorMessage:
                "QR code already scanned by user and is not an unlimited scan QR code",
              current_points: userRegistration.points
                ? userRegistration.points
                : 0,
              redeemed_points: -1,
              redemption_type: "user"
            };
          }

          // get their points if available and add qr points
          if (userRegistration && userRegistration.points) {
            userRegistration.points =
              parseInt(userRegistration.points) + qr.points;
          } else {
            userRegistration.points = qr.points;
          }

          // update the user's registration with the new points and update the scanned QRs
          const updateParams = {
            TableName:
              USER_REGISTRATIONS_TABLE +
              (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
            Key: {
              id: email,
              "eventID;year": eventIDAndYear
            },
            UpdateExpression: "set points = :points, scannedQRs = :scannedQRs",
            ExpressionAttributeValues: {
              ":points": userRegistration.points,
              ":scannedQRs": JSON.stringify(scannedQRs.concat(qrCodeID))
            },
            ReturnValues: "UPDATED_NEW"
          };

          if (isEventsTeamEnabled) {
            return this._checkQRTeamScanned(
              email,
              qrCodeID,
              eventID,
              year
            ).then((res) => {
              const alreadyScanned = res.alreadyScanned;
              const team = res.team;
              if (alreadyScanned && !qr.isUnlimitedScans) {
                // Team QR code has already been scanned.
                return {
                  errorMessage:
                    "Team QR code already scanned and is not an unlimited scan QR code",
                  current_points: team.points,
                  redeemed_points: 0,
                  redemption_type: "team"
                };
              } else {
                // Check that team scan won't result in negative points
                // TODO: This is a temporary fix to prevent negative points for TEAMS ONLY. We should move this check much earlier in the process
                //  - will require a slight refactor to get a Team object from the start, remove the second call in the _checkQRTeamScanned function
                if (team.points + qr.points < 0) {
                  return {
                    errorMessage: "Team scan would result in negative points",
                    current_points: team.points,
                    redeemed_points: -1,
                    redemption_type: "team",
                    qr_points: qr.points
                  };
                }

                // Team QR code can be scanned.
                return this._addTeamQRScan(team, qrCodeID, qr.points).then(
                  (teamPoints) => {
                    // update the individual user's registration with the new points (for stats-keeping)
                    docClient
                      .update(updateParams)
                      .promise()
                      .catch((error) => {
                        console.error(error);
                      });

                    return {
                      current_points: teamPoints,
                      redeemed_points: qr.points,
                      redemption_type: "team"
                    };
                  }
                );
              }
            });
          } else {
            // if event teams are not enabled, just update the user's points

            return docClient
              .update(updateParams)
              .promise()
              .then(() => {
                return {
                  current_points: userRegistration.points,
                  redeemed_points: qr.points,
                  redemption_type: "user"
                };
              })
              .catch((error) => {
                console.error(error);
                return {
                  errorMessage: error,
                  current_points: userRegistration.points
                    ? userRegistration.points
                    : 0,
                  redeemed_points: -1,
                  redemption_type: "user"
                };
              });
          }
        })
        .catch((error) => {
          console.error(error);
          return null;
        });
    } catch (err) {
      let errorResponse = db.dynamoErrorResponse(err);
      const errBody = JSON.parse(errorResponse.body);

      // customize the error messsage if it is caused by the 'ConditionExpression' check
      if (errBody.code === "ConditionalCheckFailedException") {
        errorResponse.statusCode = 409;
        errBody.statusCode = 409;
        errBody.message = `Update error because the registration entry for user '${email}' and with eventID;year '${eventIDAndYear}' does not exist`;
        errorResponse.body = JSON.stringify(errBody);
      }
      throw errorResponse;
    }
  },
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
  async _checkQRTeamScanned(user_id, qr_code_id, eventID, year) {
    /*
        Checks if a user's team has already scanned a QR code. Return true if they have, false if they haven't.
   */

    // get user's team using helper function _getTeamFromUserRegistration
    return await this._getTeamFromUserRegistration(user_id, eventID, year)
      .then((team) => {
        if (team == null) {
          // produce error: user is not on a team
          throw new Error(
            "This event is set to use teams, but the user is not on a team."
          );
        }

        // check if qr_code_id is in scannedQRs
        return {
          alreadyScanned: team.scannedQRs.includes(qr_code_id),
          team: team
        };
      })
      .catch((err) => {
        console.log(err);
        throw new Error(err);
      });
  },
  _isEventTeamsEnabled: async function (eventID_year) {
    // TODO: undo this after InnoVent 2023! this is a temporary flag to enable teams for InnoVent 2023.
    // TODO 2; add a 'teamsEnabled' field to the events table so that the code below can check it as a flag
    if (eventID_year.toLowerCase() === "data-and-beyond;2023") {
      return true;
    }

    const eventName = eventID_year.split(";")[0];
    const year = parseInt(eventID_year.split(";")[1]);

    return await db
      .getOne(
        eventName,
        EVENTS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
        {
          year: year
        }
      )
      .then((res) => {
        if (res && res.hasOwnProperty("teamsEnabled")) {
          return res.teamsEnabled;
        } else {
          return false;
        }
      })
      .catch((err) => {
        console.log(err);
        throw new Error(err);
      });
  },
  async _addTeamQRScan(team, qr_code_id, points) {
    /*
        Adds a QR code to the scannedQRs array of a user's team.
   */

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
    return await this._putTeam(team)
      .then((_) => {
        return team.points;
      })
      .catch((err) => {
        console.log(err);
        throw new Error(err);
      });
  },
  async _putTeam(team) {
    /*
        Puts a team in the Teams table according to the Table Schema.
        Partition key is teamID, sort key is eventID;year
   */

    const params = {
      TableName:
        TEAMS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      Item: team
    };

    return await docClient
      .put(params)
      .promise()
      .then((team) => {
        return team;
      });
  }
};
