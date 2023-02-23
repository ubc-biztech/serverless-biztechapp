import teamHelpers from './helpers';
import helpers from '../../lib/handlerHelpers';

/*
  Team Table Schema from DynamoDB:
    {
    "team_id": "string",
    "team_name": "string",
    "eventID;year": "string;number",
    "memberIDs": "string[]",
    "scanned_qr_codes": "string[]",
    "points": "number",
    "points_spent": "number",
    "transactions": "string[]",
    "inventory": "string[]",
    "submission": "string",
    "metadata": object
 */

// Stubs below

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

export const changeTeam = async (event, ctx, callback) => {

};

export const addMember = async (event, ctx, callback) => {

};

export const changeTeamName = async (event, ctx, callback) => {

};

export const viewPoints = async (event, ctx, callback) => {

};

export const changePoints = async (event, ctx, callback) => {

};

export const addQRScan = async (event, ctx, callback) => {

  /*
    Adds a QR code to the scannedQRs array of the team.
    If points are passed in, it will also add the points to the team's points.

    DOES NOT CHANGE POINTS - do that through the changePoints function.
    DOES NOT CHECK IF QR CODE HAS ALREADY BEEN SCANNED - do that through the checkQRScanned function.

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
