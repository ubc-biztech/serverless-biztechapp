const AWS = require('aws-sdk');
import helpers from '../../lib/handlerHelpers';
import db from '../../lib/db';
import { isValidEmail } from '../../lib/utils';
const { MEMBERS2022_TABLE } = require('../../constants/tables');

const VERIFICATION_CODE = 'bizbot';

export const create = async (event, ctx, callback) => {

  const docClient = new AWS.DynamoDB.DocumentClient();

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);
  if (!isValidEmail(data.email)) {

    return helpers.inputError('Invalid email', data.email);

  }

  const memberParams = {
    Item: {
      id: data.email,
      pronouns: data.pronouns,
      major: data.major,
      prevMember: data.prev_member,
      international: data.international,
      topics: data.topics,
      heardFrom: data.heard_from,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    TableName: MEMBERS2022_TABLE + process.env.ENVIRONMENT,
    ConditionExpression: 'attribute_not_exists(id)',
  };

  if (data.hasOwnProperty('verificationCode')) {

    if (data.verificationCode !== VERIFICATION_CODE) {

      const response = helpers.createResponse(401, {
        message: 'Invalid verification code',
      });
      callback(null, response);

    }

  } else if (!data.hasOwnProperty('verificationCode')) {

    const response = helpers.createResponse(401, {
      message: 'Missing verification code',
    });
    callback(null, response);

  }

  await docClient
    .put(memberParams)
    .promise()
    .then(() => {

      const response = helpers.createResponse(201, {
        message: 'Created!',
        params: memberParams,
      });
      callback(null, response);

    })
    .catch((error) => {

      let response;
      if (error.code === 'ConditionalCheckFailedException') {

        response = helpers.createResponse(
          409,
          'Member could not be created because email already exists'
        );

      } else {

        response = helpers.createResponse(
          502,
          'Internal Server Error occurred'
        );

      }
      callback(null, response);

    });

};

export const getAll = async (event, ctx, callback) => {

  try {

    // scan the table
    const members = await db.scan(MEMBERS2022_TABLE);

    // re-organize the response
    let response = {};
    if (members !== null) response = helpers.createResponse(200, members);

    // return the response object
    callback(null, response);
    return null;

  } catch (err) {

    callback(null, err);
    return null;

  }

};
