'use strict';

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();

  var obj = JSON.parse(event.body);

  var studentID = parseInt(obj.studentID, 10);

  var params = {
      Item: {
          id: studentID,
          fname: obj.fname,
          lname: obj.lname,
          email: obj.email,
          faculty: obj.faculty,
          year: obj.year,
          gender: obj.gender,
          diet: obj.diet,
          createdAt: timestamp,
          updatedAt: timestamp
      },
      TableName: 'biztechUsers'
  };

  console.log(params)

  await docClient.put(params).promise()

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Created!',
      params: params
    }, null, 2),
  };

};
