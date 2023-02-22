import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { USER_REGISTRATIONS_TABLE, TEAMS_TABLE } from '../../constants/tables';
import helpers from '../../lib/handlerHelpers.js';
import db from '../../lib/db.js';

/*
  Team Table Schema from DynamoDB:
    {
    "id": "string",
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

export default {
  async makeTeam(team_name, eventID, year, memberIDs) {

    /*
      Creates a team in the Teams table according to the Table Schema.
     */

    const docClient = new AWS.DynamoDB.DocumentClient();
    const eventID_year = eventID + ';' + year;

    // First, check if ALL members are registered for the event with eventID;year. Iterate through memberIDs.
    for (let i = 0; i < memberIDs.length; i++) {

      const memberID = memberIDs[i];

      // get user's registration
      await db.getOne(memberID, USER_REGISTRATIONS_TABLE + process.env.ENVIRONMENT, {
        'eventID;year': eventID_year
      }).then(res => {

        if (!res) {

          throw helpers.inputError('User ' + memberID + ' is not registered for event ' + eventID_year, 403);

        }

      });

    }

    const params = {
      TableName: TEAMS_TABLE + process.env.ENVIRONMENT,
      Item: {
        id: uuidv4(),
        teamName: team_name,
        'eventID;year': eventID + ';' + year,
        memberIDs: { SS: memberIDs },
        scanned_qr_codes: { SS: [] },
        points: 0,
        points_spent: 0,
        transactions: { SS: [] },
        inventory: { SS: [] },
        submission: '',
        metadata: {}
      }
    };

    try {

      return await docClient.put(params).promise().then(res => {

        // update all members' teamIDs in the User Registrations table
        for (let i = 0; i < memberIDs.length; i++) {

          const memberID = memberIDs[i];

          // get user's registration
          db.getOne(memberID, USER_REGISTRATIONS_TABLE + process.env.ENVIRONMENT, {
            'eventID;year': eventID_year
          }).then(res => {

            // update user's registration
            res.teamID = params.Item.id;

            docClient.put({
              TableName: USER_REGISTRATIONS_TABLE + process.env.ENVIRONMENT,
              Item: res
            }).promise().then(res => {

            }).catch(err => {

              console.log(err);
              throw new Error(err);

            });

          }).catch(err => {

            console.log(err);
            throw new Error(err);

          });

        }

        // return newly created team
        return params.Item;

      }).catch(err => {

        console.log(err);
        throw new Error(err);

      });

    } catch (err) {

      console.log(err);
      throw new Error(err);

    }

  }
};
