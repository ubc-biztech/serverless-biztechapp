import teamHelpers from './helpers';
import helpers from '../../lib/handlerHelpers';
import { TEAMS_TABLE } from '../../constants/tables';
import db from '../../lib/db.js';

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

export const makeTeam = async (event, ctx, callback) => {

  try {

    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      team_name: { required: true, type: 'string' },
      eventID: { required: true, type: 'string' },
      year: { required: true, type: 'number' },
      memberIDs: { required: true, type: 'object' }, // 'object' means array in this case
    });

    await teamHelpers.makeTeam(data.team_name, data.eventID, data.year, data.memberIDs).then(res => {

      if (res) {

        const response_success = helpers.createResponse(200,
          {
            'message': 'Successfully created new team.',
            'response': res
          });

        callback(null, response_success);
        return response_success;

      }

    }).catch(err => {

      const response_fail = helpers.createResponse(403, {
        message: 'Could not create team.',
        'response': err
      });

      callback(null, response_fail);
      return response_fail;

    });

  } catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

export const getTeamFromUserID = async (event, ctx, callback) => {

  /*
    Returns the team object of the team that the user is on from the user's ID.

    Requires: user_id, eventID, year
   */

  const data = JSON.parse(event.body);

  helpers.checkPayloadProps(data, {
    user_id: { required: true, type: 'string' },
    eventID: { required: true, type: 'string' },
    year: { required: true, type: 'number' },
  });

  await teamHelpers._getTeamFromUserRegistration(data.user_id, data.eventID, data.year).then(res => {

    if (res) {

      const response_success = helpers.createResponse(200,
        {
          'message': 'Successfully retrieved team.',
          'response': res
        });

      callback(null, response_success);
      return response_success;

    }

  }).catch(err => {

    const response_fail = helpers.createResponse(403, {
      message: 'Could not retrieve team.',
      'response': err
    });

    callback(null, response_fail);
    return response_fail;

  });

};

export const get = async (event, ctx, callback) => {

  if (!event.pathParameters || !event.pathParameters.eventID || !event.pathParameters.year) throw helpers.missingPathParamResponse('event', 'year');
  const { eventID, year } = event.pathParameters;

  try {

    const eventIDYear = eventID + ';' + year;
    const filterExpression = {
      FilterExpression: '#eventIDyear = :query',
      ExpressionAttributeNames: {
        '#eventIDyear': 'eventID;year'
      },
      ExpressionAttributeValues: {
        ':query': eventIDYear
      }
    };

    const qrs = await db.scan(TEAMS_TABLE, filterExpression);
    const response = helpers.createResponse(200, qrs);
    callback(null, response);
    return response;

  } catch (err) {

    console.log(err);
    callback(null, err);
    return null;

  }

};

// STUBS or unused functions below

export const changeTeam = async (event, ctx, callback) => {

};

export const addMember = async (event, ctx, callback) => {

};

export const changeTeamName = async (event, ctx, callback) => {

  /*
    Changes the team name of the team with the given user_id.
   */
  try {

    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      user_id: { required: true, type: 'string' },
      eventID: { required: true, type: 'string' },
      year: { required: true, type: 'number' },
      team_name: { required: true, type: 'string' },
    });

    await teamHelpers.changeTeamName(data.user_id, data.eventID, data.year, data.team_name).then(res => {

      if (res) {

        const response_success = helpers.createResponse(200,
          {
            'message': 'Successfully changed team name.',
            'response': res
          });

        callback(null, response_success);
        return response_success;

      }

    }).catch(err => {

      const response_fail = helpers.createResponse(403, {
        message: 'Could not change team name.',
        'response': err
      });

      callback(null, response_fail);
      return response_fail;

    });

  } catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

export const viewPoints = async (event, ctx, callback) => {

};

export const changePoints = async (event, ctx, callback) => {

};

export const addQRScan = async (event, ctx, callback) => {

  /*
    !!!! DEPRECATED: use the QR microservice for client facing calls.

    Adds a QR code to the scannedQRs array of the team.
    If points are passed in, it will also add the points to the team's points.

    Requires: user_id, qr_code_id, eventID, year
   */

  try {

    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      user_id: { required: true, type: 'string' },
      qr_code_id: { required: true, type: 'string' },
      eventID: { required: true, type: 'string' },
      year: { required: true, type: 'number' },
      points: { required: false, type: 'number' },
    });

    const points = data.points ? data.points : 0;

    await teamHelpers.addQRScan(data.user_id, data.qr_code_id, data.eventID, data.year, points).then(res => {

      if (res) {

        const response_success = helpers.createResponse(200,
          {
            'message': 'Successfully added QR code to scannedQRs array of team.',
            'response': res
          });

        callback(null, response_success);
        return response_success;

      }

    }).catch(err => {

      const response_fail = helpers.createResponse(403, {
        message: 'Could not add QR code to scannedQRs array of team.',
        'response': err
      });

      callback(null, response_fail);
      return response_fail;

    });

  } catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

export const checkQRScanned = async (event, ctx, callback) => {

  /*
    !!!! DEPRECATED: use the QR microservice for client facing calls.

    Checks if a QR code has been scanned by a team.

    Requires: user_id, qr_code_id, eventID, year
   */

  try {

    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      user_id: { required: true, type: 'string' },
      qr_code_id: { required: true, type: 'string' },
      eventID: { required: true, type: 'string' },
      year: { required: true, type: 'number' },
    });

    await teamHelpers.checkQRScanned(data.user_id, data.qr_code_id, data.eventID, data.year).then(bool => {

      const response_success = helpers.createResponse(200,
        {
          'message': 'Attached boolean for check if QR code has been scanned for that user\'s team; refer to "response" field.',
          'response': bool
        });

      callback(null, response_success);
      return response_success;

    }).catch(err => {

      const response_fail = helpers.createResponse(403, {
        message: 'Could not check if QR code has been scanned.',
        'response': err
      });

      callback(null, response_fail);
      return response_fail;

    });

  } catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};

export const addTransaction = async (event, ctx, callback) => {

};

export const getTransactions = async (event, ctx, callback) => {

};

export const addInventory = async (event, ctx, callback) => {

};

export const getTeamInventory = async (event, ctx, callback) => {

};
