import AWS from 'aws-sdk';
import { USER_REGISTRATIONS_TABLE } from '../../constants/tables';
import { isValidEmail } from '../../lib/utils.js';
import helpers from '../../lib/handlerHelpers.js';
import db from '../../lib/db.js';

export default {
  async checkValidQR(id) {

    /* Check if QR code is valid and has a point value

    Args:
        id (string): QR code ID

    Returns:
        int: point value of QR code or -1 if QR code is invalid

     */

    // TODO: this is a hardcoded placeholder for Blueprint 2023, but ideally these values are stored in the Events database
    //  or a similar database on DynamoDB.
    const validEvents = {
      'Fi32s-submit-panelist-questions': 10,
      '8GCn4-early-check-in': 20,
      'g4h8s-workshop-1': 15,
      'v01ds-workshop-2': 15,
      '287cs-workshop-3': 15,
      '7fj2s-win-workshop-game-1': 50,
      'f9s0d-win-workshop-game-2': 50,
      'bj9cd-win-workshop-game-3': 50,
      'yu3qo-photobooth': 15,
      '1as7v-social-media-post': 10,
      'g78vd-boothing-1': 5,
      '7gq35-boothing-2': 5,
      'vd241-boothing-3': 5,
      'xG4gh-boothing-4': 5,
      '5Sa02-boothing-5': 5,
      'cx3ad-boothing-6': 5,
      'Hhj85-boothing-7': 5,
      'p00ui-boothing-8': 5,
      'e41aa-boothing-9': 5,
      '2g322-boothing-10': 5,
      '3djms-boothing-11': 5,
      '4dg12-boothing-12': 5,
      '48fsd-lunch-activities': 10,
      'h52Yd-lunch-activities-1': 10,
      '2g322-lunch-activities-2': 10,
      '3dJm6-lunch-activities-3': 10,
      'Kgs4J-questions-during-panel': 10
    };

    // check if QR id is in the validEvents object
    if (validEvents[id]) {

      return validEvents[id];

    }

    return -1;

  },
  async qrScanPostHelper(data, email) {

    /* Checks if the QR code is valid and if so, sends control flow to process the redemption.

       Args:
           data: object containing eventID, year, email, and registrationStatus
           email: email of user

       Returns:
           result (object): object containing updated points and the points redeemed from the QR code, or error 403 if the QR code is invalid.

    */

    const { eventID, year, qrCodeID } = data;
    const eventIDAndYear = eventID + ';' + year;

    //Check if eventID exists and is string. Check if year exists and is number.
    if(typeof eventID !== 'string' || typeof year !== 'number' || isNaN(year) || !isValidEmail(email)) {

      throw helpers.inputError('Incorrect types for eventID and year in registration.updateHelper', data);

    }

    // Check if QR code is valid and/or already scanned from Transactions database.
    // In this case, checkValidQR gives -1 if the QR code is invalid, and 0+ if it is valid.
    // TODO: We are using async here because we anticipate using DynamoDB in the future within checkValidQR.
    return this.checkValidQR(qrCodeID).then(async points => {

      if (points === -1) {

        throw helpers.createResponse(403, {
          message: 'Invalid QR code - not scannable for this BizTech event!',
          data: data
        });

      } else {

        return await this.createRedemption(points, data, email, eventIDAndYear, qrCodeID);

      }

    });

  },
  async createRedemption(validQRPoints, data, email, eventIDAndYear, qrCodeID) {

    /* Processes a QR code redemption via DynamoDB — adds points to user's event registration (Registration table),
    adds the QR code key as being used (Registration table), then returns updated progress.

    Args:
      validQRPoints: number of points the QR code is worth
      data: object containing eventID, year, email, and registrationStatus
      email: email of user
      eventIDAndYear: string containing eventID and year separated by semicolon
      qrCodeID: string of QR code ID

    Returns:
      result (object): object containing updated points and the points redeemed from the QR code, or -1 if the QR code already used.

     */

    try {

      // query the user's registration for the event
      const docClient = new AWS.DynamoDB.DocumentClient();
      const params = {
        TableName: USER_REGISTRATIONS_TABLE + process.env.ENVIRONMENT,
        FilterExpression: '#eventIDYear = :query',
        ExpressionAttributeNames: {
          '#eventIDYear': 'eventID;year'
        },
        ExpressionAttributeValues: {
          ':query': eventIDAndYear
        }
      };
      return await docClient
        .scan(params)
        .promise()
        .then(result => {

          // find the user's registration
          const userRegistration = result.Items.find(item => item.id === email);

          // validate that user has not already scanned this QR code
          // Parse the user's scanned QR codes
          const scannedQRs = userRegistration.scannedQRs ? JSON.parse(userRegistration.scannedQRs) : [];
          // Check if the QR code has already been scanned
          const qrCodeAlreadyScanned = scannedQRs.includes(qrCodeID);

          if (qrCodeAlreadyScanned) {

            return {
              'current_points': userRegistration.points ? userRegistration.points : 0,
              'redeemed_points': -1
            };

          }

          // get their points if available and add validQRPoints
          if (userRegistration && userRegistration.points) {

            userRegistration.points = parseInt(userRegistration.points) + validQRPoints;

          }
          else {

            userRegistration.points = validQRPoints;

          }

          // update the user's registration with the new points and update the scanned QRs
          const updateParams = {
            TableName: USER_REGISTRATIONS_TABLE + process.env.ENVIRONMENT,
            Key: {
              id: email,
              'eventID;year': eventIDAndYear
            },
            UpdateExpression: 'set points = :points, scannedQRs = :scannedQRs',
            ExpressionAttributeValues: {
              ':points': userRegistration.points,
              ':scannedQRs': JSON.stringify(scannedQRs.concat(qrCodeID))
            },
            ReturnValues: 'UPDATED_NEW'
          };

          return docClient.update(updateParams).promise().then(() => {

            return {
              'current_points': userRegistration.points,
              'redeemed_points': validQRPoints
            };

          }).catch(error => {

            console.error(error);
            return {
              'current_points': userRegistration.points ? userRegistration.points : 0,
              'redeemed_points': -1
            };

          });

        })
        .catch(error => {

          console.error(error);
          return null;

        });

    } catch(err) {

      let errorResponse = db.dynamoErrorResponse(err);
      const errBody = JSON.parse(errorResponse.body);

      // customize the error messsage if it is caused by the 'ConditionExpression' check
      if(errBody.code === 'ConditionalCheckFailedException') {

        errorResponse.statusCode = 409;
        errBody.statusCode = 409;
        errBody.message = `Update error because the registration entry for user '${email}' and with eventID;year '${eventIDAndYear}' does not exist`;
        errorResponse.body = JSON.stringify(errBody);

      }
      throw errorResponse;

    }

  }
};
