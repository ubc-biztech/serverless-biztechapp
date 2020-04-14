'use strict';
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const helpers = require('./helpers');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_KEY);


module.exports.create = async (event, ctx, callback) => {

  // TODO: merge Jacques PR for checking required fields
  const data = JSON.parse(event.body);

  // Check that parameters are valid
  if (!data.hasOwnProperty('id')) {
    callback(null, helpers.inputError('Registration student ID not specified.', data));
    return;
  } else if (!data.hasOwnProperty('eventID')) {
    callback(null, helpers.inputError('Registration event ID not specified.', data));
    return;
  } else if (!data.hasOwnProperty('registrationStatus')) {
    const response = {
      statusCode: 406,
      body: JSON.stringify({
        message: 'Status not specified.',
        data: data
      }, null, 2),
    };
    callback(null, response);
    return;
  }
  const id = parseInt(data.id, 10);
  const eventID = data.eventID;
  let eventName = "";
  let registrationStatus = data.registrationStatus;

  // Check if the event is full
  if (registrationStatus === 'registered') {

    const eventParams = {
      Key: { id: eventID },
      TableName: 'biztechEvents' + process.env.ENVIRONMENT
    }

    await docClient.get(eventParams).promise()
      .then(async (event) => {
        const counts = await helpers.getEventCounts(eventID);
        eventName = event.Item.ename;

        if (counts.registeredCount >= event.Item.capac) {
          registrationStatus = 'waitlist'
        }
      })
  }

  //confirmation email 
  const userParams = {
    Key: { id: id },
    TableName: 'biztechUsers' + process.env.ENVIRONMENT
  }
  await docClient.get(userParams).promise()
    .then(async (user) => {
      console.log(user);
      const email = "derekc150@gmail.com";
      //const email = await user.Item.email;
      const userName = await user.Item.fname;
      if (eventName != undefined) {
        let htmlTemplate = `
          <!DOCTYPE html>
          <html>
          <body>

          <div name="container" style="width:100%; background-color: #C0C0C0">
            <div name="innerDiv" style="width: 50%; background-color: #FFFFFF; margin: 0 auto">
              <div name="header" style="display: inline-block; padding-top:20px; padding-bottom: 20px; width: 100%;height: 110px; background-color: #DCDCDC">
                <img src="https://i.imgur.com/F40JOUo.png" style="width:87px; height:115px; vertical-align:middle; padding-left:30px">
                <div style="display: inline-block">
                 <div style="display: inline-block; margin-left: 20px">
                      <h1 style="display: inline-block; color: #565656; font-family: arial; margin-right: 5px">UBC</h3>
                      <h1 style="display: inline-block; color: #7AD040; font-family: arial">BIZTECH</h3>
                 </div>
             </div>
          </div>
          <div name="body" style="width: 100%; margin-right:40px">
            <div>
                <p style="display: inline-block; margin-right:5px; margin-left: 20px">Hi</p><p style="display: inline-block">${userName}</p>
                <br>
                <p style="display: inline-block; margin-right:3px; margin-left: 20px">You have been </p> <p style="display: inline-block; margin-right: 3px">${registrationStatus}</p><p style="display: inline-block; margin-right: 4px">for UBC BizTech's </p><p style="display: inline-block; margin-right: 4px">${eventName}</p><p style="display: inline-block">event.</p>
                <br>
                <p style="margin-left: 20px">We look forward to hosting you!</p>
                <p></p>
            </div>            
        </div>
        <div name="footer" style="display: inline-block; padding-bottom: 10px; width: 100%;height: 60px; background-color: #A9A9A9">
          <div style="padding-left:20px">
            <p style="font-size:12px;display: inline-block;">info@ubcbiztech.com,</p>
            <p style="font-size:12px;display: inline-block;">
            <span>Vancouver, British Columbia V6T 1Z2</span>
            </p>
          </div>
          <p style="font-size:12px; padding:0; margin:0">
          <a href="{{{unsubscribe}}}" target="_blank" style="font-family:sans-serif;text-decoration:none; margin-left:20px">
            Unsubscribe
          </a>
          -
          <a href="{{{unsubscribe_preferences}}}" target="_blank" class="Unsubscribe--unsubscribePreferences" style="font-family:sans-serif;text-decoration:none;">
            Unsubscribe Preferences
          </a>
          </p>
          </div>
        </div>
    </div>
</div>

          </body>
          </html>
        `
        const msg = {
          to: email,
          from: 'info@ubcbiztech.com',
          subject: 'BizTech ' + eventName + ' Receipt',
          html: htmlTemplate,
        }
        if (msg) {
          await sgMail.send(msg);
        }
      }
    })


  const updateObject = { registrationStatus };
  console.log(updateObject)

  const {
    updateExpression,
    expressionAttributeValues
  } = helpers.createUpdateExpression(updateObject)

  // Because biztechRegistration table has a sort key we cannot use updateDB()
  var params = {
    Key: {
      id,
      eventID
    },
    TableName: 'biztechRegistration' + process.env.ENVIRONMENT,
    ExpressionAttributeValues: expressionAttributeValues,
    UpdateExpression: updateExpression,
    ReturnValues: "UPDATED_NEW"
  };

  // call dynamoDb
  await docClient.update(params).promise()
    .then(result => {
      const response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({
          message: 'Update succeeded',
          registrationStatus
        })
      };
      callback(null, response)
    })
    .catch(error => {
      console.error(error);
      const response = {
        statusCode: 500,
        body: error
      };
      callback(null, response)
    });
};

// Return list of entries with the matching id
module.exports.queryStudent = async (event, ctx, callback) => {
  const queryString = event.queryStringParameters;
  if (queryString == null || !queryString.hasOwnProperty('id')) {
    callback(null, helpers.inputError('Student ID not specified.', queryString));
    return;
  }
  const id = parseInt(queryString.id, 10);

  const params = {
    TableName: 'biztechRegistration' + process.env.ENVIRONMENT,
    KeyConditionExpression: 'id = :query',
    ExpressionAttributeValues: {
      ':query': id
    }
  };

  await docClient.query(params).promise()
    .then(result => {
      console.log('Query success.');
      const data = result.Items;
      const response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({
          size: data.length,
          data: data
        }, null, 2)
      };
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Unable to query registration table.'));
      return;
    });
}

// Return list of entries with the matching eventID
module.exports.scanEvent = async (event, ctx, callback) => {
  const queryString = event.queryStringParameters;
  if (queryString == null || !queryString.hasOwnProperty('eventID')) {
    callback(null, helpers.inputError('Event ID not specified.', queryString));
    return;
  }
  const eventID = queryString.eventID;

  const params = {
    TableName: 'biztechRegistration' + process.env.ENVIRONMENT,
    FilterExpression: 'eventID = :query',
    ExpressionAttributeValues: {
      ':query': eventID
    }
  };

  await docClient.scan(params).promise()
    .then(result => {
      console.log('Scan success.');
      const data = result.Items;
      const response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({
          size: data.length,
          data: data
        }, null, 2)
      };
      callback(null, response);
    })
    .catch(error => {
      console.error(error);
      callback(new Error('Unable to scan registration table.'));
      return;
    });
}
