'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const helpers = require('./helpers');
const crypto = require('crypto');
const email = require('../utils/email')

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);

  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('User ID not specified.', data));
  }
  const id = parseInt(data.id, 10);

  const userParams = {
      Item: {
          id,
          fname: data.fname,
          lname: data.lname,
          email: data.email,
          faculty: data.faculty,
          year: data.year,
          gender: data.gender,
          diet: data.diet,
          createdAt: timestamp,
          updatedAt: timestamp
      },
      TableName: 'biztechUsers' + process.env.ENVIRONMENT
  };

  if (data.hasOwnProperty('inviteCode')) {
    const inviteCodeParams = {
      Key: { id: data.inviteCode },
      TableName: 'inviteCodes' + process.env.ENVIRONMENT
    };
    await docClient.get(inviteCodeParams).promise()
      .then(async result => {
        if (result.Item == null){
          const response = helpers.createResponse(404, 'Invite code not found.');
          callback(null, response)
        } else { // invite code was found
          // add paid: true to user
          userParams.Item.paid = true;
          const deleteParams = {
            Key: { id: data.inviteCode },
            TableName: 'inviteCodes' + process.env.ENVIRONMENT
          }
          await docClient.delete(deleteParams).promise();
        }
      })
      .catch(error => {
        console.error(error);
        const response = helpers.createResponse(502, error);
        callback(null, response);
      });
  }

  await docClient.put(userParams).promise()

  return helpers.createResponse(200, {
    message: 'Created!',
    params: userParams
  })
};

module.exports.get = async (event, ctx, callback) => {
  const queryString = event.queryStringParameters;
  if (queryString == null || !queryString.hasOwnProperty('id')) {
    callback(null, helpers.inputError('User ID not specified.', queryString));
    return;
  }

  const id = parseInt(queryString.id, 10);

  const params = {
      Key: {
        id
      },
      TableName: 'biztechUsers' + process.env.ENVIRONMENT
  };

  await docClient.get(params).promise()
    .then(result => {
      if (result.Item == null){
        const response = helpers.createResponse(404, 'User not found.')
        callback(null, response)
      } else {
        const response = helpers.createResponse(200, result.Item)
        callback(null, response)
      }
    })
    .catch(error => {
      console.error(error);
      const response = helpers.createResponse(502, error)
      callback(null, response);
    });

};

module.exports.update = async (event, ctx, callback) => {

  const data = JSON.parse(event.body);
  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('User ID not specified.', data));
  }
  const id = parseInt(data.id, 10);

  const params = {
    Key: { id },
    TableName: 'biztechUsers' + process.env.ENVIRONMENT,
  };

  await docClient.get(params).promise()
    .then(async(result) => {
      if (!helpers.isEmpty(result))
        callback(null, await helpers.updateDB(id, data, 'biztechUsers'));
      else {
        const response = helpers.createResponse(404, 'User not found.')
        callback(null, response);
      }
    })
    .catch(error => {
      console.error(error);
      const response = helpers.createResponse(502, error)
      callback(null, response);
    })

};

module.exports.invite = async (event, ctx, callback) => {
  const data = JSON.parse(event.body);
  if (!data.hasOwnProperty('email')) {
    return helpers.inputError('Email not specified.', data);
  }

  const id = crypto.randomBytes(20).toString('hex')

  const params = {
    Item: {
      id,
      email: data.email
    },
    TableName: 'inviteCodes' + process.env.ENVIRONMENT
  }

  await docClient.put(params).promise()
    .then(success => {
        const msg = {
          to: data.email,
          templateId: "d-198cfc5057914538af105ef469f51217",
          dynamic_template_data: {
            url: 'https://app.ubcbiztech.com/invite/'+id // TODO: Fix url format based on frontend implementation
          }
        }
        return email.send(msg)
    })
    .then(success => {
      const response = helpers.createResponse(200, 'Invite code created & sent to ' + data.email)
      callback(null, response)
    })
    .catch(error => {
      console.error(error);
      const response = helpers.createResponse(502, error)
      callback(null, response);
    });
};