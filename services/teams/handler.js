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

export const viewTeam = async (event, ctx, callback) => {

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

};

export const checkQRScanned = async (event, ctx, callback) => {

};

export const addTransaction = async (event, ctx, callback) => {

};

export const getTransactions = async (event, ctx, callback) => {

};

export const addInventory = async (event, ctx, callback) => {

};

export const getTeamInventory = async (event, ctx, callback) => {

};
