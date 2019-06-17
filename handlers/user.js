'use strict';

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

module.exports.create = async (event, ctx, callback) => {

  const timestamp = new Date().getTime();

  // var studentID = parseInt(event.studentID, 10);

  var obj = JSON.parse(event.body);
  // var obj = event;
  // console.log(event);
  // console.log(obj);
  console.log(obj.studentID);

  var params = {
      Item: {
          studentID: obj.studentID,
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
      TableName: 'usersTable'
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
