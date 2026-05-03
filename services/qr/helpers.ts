import {
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  EVENTS_TABLE,
  QR_SCANS_RECORD,
  QRS_TABLE,
  TEAMS_TABLE,
  USER_REGISTRATIONS_TABLE,
} from "../../constants/tables.js";
import docClient from "../../lib/docClient.js";
import db from "../../lib/db.js";
import helpers from "../../lib/handlerHelpers";
import { isValidEmail } from "../../lib/utils.js";
import WebSocket from "ws";

type QrScanBody = {
  eventID: string;
  year: number;
  qrCodeID: string;
  negativePointsConfirmed: boolean;
  email: string;
  admin?: boolean;
};

type TeamRecord = {
  id?: string;
  scannedQRs: string[];
  points: number;
  pointsSpent?: number;
  [key: string]: unknown;
};

type UserRegistrationRecord = {
  id?: string;
  points?: number | string;
  scannedQRs?: string;
  teamID?: string;
  [key: string]: unknown;
};

type QrRecord = {
  id: string;
  points: number;
  type?: string;
  isUnlimitedScans?: boolean;
  data?: unknown;
  [key: string]: unknown;
};

const registrationHelpers = {
  async checkValidQR(
    id: string,
    eventIDAndYear: string,
  ): Promise<QrRecord | null> {
    const res = await db.getOne(id, QRS_TABLE, {
      "eventID;year": eventIDAndYear,
    });
    return res as QrRecord | null;
  },

  async qrScanPostHelper(data: QrScanBody, email: string) {
    const { eventID, year, qrCodeID, negativePointsConfirmed } = data;
    const eventIDAndYear = `${eventID};${year}`;

    if (
      typeof eventID !== "string" ||
      typeof year !== "number" ||
      Number.isNaN(year) ||
      !isValidEmail(email)
    ) {
      throw helpers.inputError(
        "Incorrect types for eventID and year in registration.updateHelper",
        data,
      );
    }

    return this.checkValidQR(qrCodeID, eventIDAndYear).then(async (qr) => {
      if (qr === null) {
        throw helpers.createResponse(403, {
          message: "Invalid QR code - not scannable for this BizTech event!",
          data,
        });
      }
      if (negativePointsConfirmed === false && qr.points < 0) {
        throw helpers.createResponse(405, {
          message:
            "Please confirm with the user that they want to redeem a negative point QR code.",
          data,
          qr_points: qr.points,
        });
      }
      return this.createRedemption(
        qr,
        data,
        email,
        eventIDAndYear,
        qrCodeID,
        eventID,
        year,
      );
    });
  },

  async createRedemption(
    qr: QrRecord,
    data: QrScanBody,
    email: string,
    eventIDAndYear: string,
    qrCodeID: string,
    eventID: string,
    year: number,
  ) {
    try {
      const params = {
        FilterExpression: "#eventIDYear = :query",
        ExpressionAttributeNames: {
          "#eventIDYear": "eventID;year",
        },
        ExpressionAttributeValues: {
          ":query": eventIDAndYear,
        },
      };
      const result = (await db.scan(
        USER_REGISTRATIONS_TABLE,
        params,
      )) as UserRegistrationRecord[];

      try {
        const userRegistration = result.find((item) => item.id === email);

        if (
          qr.type === "Partner" &&
          (await this.checkIfAlreadyScannedPartnerQR(
            userRegistration as UserRegistrationRecord,
            eventIDAndYear,
          ))
        ) {
          return {
            current_points: userRegistration!.points,
            redeemed_points: 0,
            redemption_type: "user",
            qr_data: qr.data,
          };
        }

        const isEventsTeamEnabled =
          await this._isEventTeamsEnabled(eventIDAndYear);

        const scannedQRs: string[] = userRegistration!.scannedQRs
          ? JSON.parse(userRegistration!.scannedQRs as string)
          : [];
        const qrCodeAlreadyScanned = scannedQRs.includes(qrCodeID);

        if (
          qrCodeAlreadyScanned &&
          !qr.isUnlimitedScans &&
          !isEventsTeamEnabled
        ) {
          return {
            errorMessage:
              "QR code already scanned by user and is not an unlimited scan QR code",
            current_points: userRegistration!.points
              ? userRegistration!.points
              : 0,
            redeemed_points: -1,
            redemption_type: "user",
          };
        }

        if (userRegistration && userRegistration.points) {
          userRegistration.points =
            parseInt(String(userRegistration.points), 10) + qr.points;
        } else {
          userRegistration!.points = qr.points;
        }

        const updateParams = {
          TableName:
            USER_REGISTRATIONS_TABLE +
            (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
          Key: {
            id: email,
            "eventID;year": eventIDAndYear,
          },
          UpdateExpression: "set points = :points, scannedQRs = :scannedQRs",
          ExpressionAttributeValues: {
            ":points": userRegistration!.points,
            ":scannedQRs": JSON.stringify(scannedQRs.concat(qrCodeID)),
          },
          ReturnValues: "UPDATED_NEW" as const,
        };

        if (isEventsTeamEnabled) {
          return this._checkQRTeamScanned(email, qrCodeID, eventID, year).then(
            (res) => {
              const alreadyScanned = res.alreadyScanned;
              const team = res.team;
              if (alreadyScanned && !qr.isUnlimitedScans) {
                return {
                  errorMessage:
                    "Team QR code already scanned and is not an unlimited scan QR code",
                  current_points: team.points,
                  redeemed_points: 0,
                  redemption_type: "team",
                };
              }
              if (team.points + qr.points < 0) {
                return {
                  errorMessage: "Team scan would result in negative points",
                  current_points: team.points,
                  redeemed_points: -1,
                  redemption_type: "team",
                  qr_points: qr.points,
                };
              }

              return this._addTeamQRScan(team, qrCodeID, qr.points).then(
                (teamPoints) => {
                  docClient
                    .send(new UpdateCommand(updateParams))
                    .catch((error: unknown) => {
                      console.error(error);
                    });

                  return {
                    current_points: teamPoints,
                    redeemed_points: qr.points,
                    redemption_type: "team",
                  };
                },
              );
            },
          );
        }

        const resultPromise = docClient
          .send(new UpdateCommand(updateParams))
          .then(() => ({
            current_points: userRegistration!.points,
            redeemed_points: qr.points,
            redemption_type: "user",
            qr_data: qr.data,
          }))
          .catch((error: unknown) => {
            console.error(error);
            return {
              errorMessage: error,
              current_points: userRegistration!.points
                ? userRegistration!.points
                : 0,
              redeemed_points: -1,
              redemption_type: "user",
            };
          });
        try {
          console.log("socketing");
          const ws = new WebSocket(
            "wss://zx441lpsv8.execute-api.us-west-2.amazonaws.com/production/",
          );
          ws.onopen = () => {
            console.log("WebSocket connected");
            const message = {
              action: "sendmessage",
              message: "leaderboard",
            };
            ws.send(JSON.stringify(message));
            console.log(`sent ${message.message}`);
            ws.close();
          };
        } catch (e) {
          console.log("Error socketing", JSON.stringify(e));
        }
        return resultPromise;
      } catch (error: unknown) {
        console.error(error);
        return {
          errorMessage: error,
          current_points: 0,
          redeemed_points: -1,
          redemption_type: "user",
        };
      }
    } catch (err: unknown) {
      const errorResponse = db.dynamoErrorResponse(err);
      const errBody = JSON.parse(errorResponse.body as string);

      if (errBody.code === "ConditionalCheckFailedException") {
        errorResponse.statusCode = 409;
        errBody.statusCode = 409;
        errBody.message = `Update error because the registration entry for user '${email}' and with eventID;year '${eventIDAndYear}' does not exist`;
        errorResponse.body = JSON.stringify(errBody);
      }
      throw errorResponse;
    }
  },

  async _getTeamFromUserRegistration(
    userID: string,
    eventID: string,
    year: number,
  ): Promise<TeamRecord | null> {
    const eventID_year = `${eventID};${year}`;

    const res = (await db.getOne(userID, USER_REGISTRATIONS_TABLE, {
      "eventID;year": eventID_year,
    })) as UserRegistrationRecord | null;

    const teamID = res?.teamID;
    if (!teamID) {
      return null;
    }

    const params = {
      TableName:
        TEAMS_TABLE +
        (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      Key: {
        id: teamID,
        "eventID;year": eventID_year,
      },
    };

    const data = await docClient.send(new GetCommand(params));
    return (data.Item as TeamRecord) || null;
  },

  async _checkQRTeamScanned(
    user_id: string,
    qr_code_id: string,
    eventID: string,
    year: number,
  ): Promise<{ alreadyScanned: boolean; team: TeamRecord }> {
    return this._getTeamFromUserRegistration(user_id, eventID, year)
      .then((team) => {
        if (team === null) {
          throw new Error(
            "This event is set to use teams, but the user is not on a team.",
          );
        }

        return {
          alreadyScanned: team.scannedQRs.includes(qr_code_id),
          team,
        };
      })
      .catch((err: unknown) => {
        console.log(err);
        throw new Error(String(err));
      });
  },

  async _isEventTeamsEnabled(eventID_year: string): Promise<boolean> {
    if (eventID_year.toLowerCase() === "data-and-beyond;2023") {
      return true;
    }

    const eventName = eventID_year.split(";")[0];
    const y = parseInt(eventID_year.split(";")[1], 10);

    return db
      .getOne(eventName, EVENTS_TABLE, {
        year: y,
      })
      .then((res: Record<string, unknown> | null) => {
        if (res && Object.prototype.hasOwnProperty.call(res, "teamsEnabled")) {
          return Boolean(res.teamsEnabled);
        }
        return false;
      })
      .catch((err: unknown) => {
        console.log(err);
        throw new Error(String(err));
      });
  },

  async _addTeamQRScan(
    team: TeamRecord,
    qr_code_id: string,
    points: number,
  ): Promise<number> {
    team.scannedQRs.push(qr_code_id);

    if (points !== 0) {
      team.points += points;
    }

    if (points < 0) {
      team.pointsSpent = (team.pointsSpent || 0) + points * -1;
    }

    return this._putTeam(team)
      .then(() => team.points)
      .catch((err: unknown) => {
        console.log(err);
        throw new Error(String(err));
      });
  },

  async _putTeam(team: TeamRecord): Promise<unknown> {
    const params = {
      TableName:
        TEAMS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      Item: team as Record<string, unknown>,
    };

    return docClient.send(new PutCommand(params)).then(() => team);
  },

  async logQRScan(qrCodeID: string, userID: string): Promise<void> {
    const scanRecord = {
      timestamp: new Date().getTime().toString(),
      qrCodeID,
      userID,
    };
    await db.create(scanRecord, QR_SCANS_RECORD);
  },

  async checkIfAlreadyScannedPartnerQR(
    userRegistration: UserRegistrationRecord,
    eventIDAndYear: string,
  ): Promise<boolean> {
    if (!userRegistration.scannedQRs) {
      return false;
    }

    const scannedQRIDs = JSON.parse(userRegistration.scannedQRs as string);

    const params = {
      TableName:
        QRS_TABLE + (process.env.ENVIRONMENT ? process.env.ENVIRONMENT : ""),
      FilterExpression: "#eventIDYear = :query",
      ExpressionAttributeNames: {
        "#eventIDYear": "eventID;year",
      },
      ExpressionAttributeValues: {
        ":query": eventIDAndYear,
      },
    };

    const scanOut = await docClient.send(new ScanCommand(params));
    const allQRs = scanOut.Items;
    if (!allQRs) {
      return false;
    }
    const allQRIDs = (allQRs as QrRecord[])
      .filter((qr) => qr.type === "Partner")
      .map((qr) => qr.id);

    for (const s of scannedQRIDs) {
      if (allQRIDs.includes(s)) {
        return true;
      }
    }
    return false;
  },
};

export default registrationHelpers;
