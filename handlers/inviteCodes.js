'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const helpers = require('./helpers');
const crypto = require('crypto');
const email = require('../utils/email')

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