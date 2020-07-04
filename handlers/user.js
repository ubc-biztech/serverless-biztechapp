"use strict";
const AWS = require("aws-sdk");
const helpers = require("./helpers");

module.exports.create = async (event, ctx, callback) => {
  const docClient = new AWS.DynamoDB.DocumentClient();

  const timestamp = new Date().getTime();
  const data = JSON.parse(event.body);

  if (!data.hasOwnProperty("id")) {
    callback(null, helpers.inputError("User ID not specified.", data));
  }

  const id = parseInt(data.id, 10);

  const email = data.email;

  let isBiztechAdmin = false;

  //assume the created user is biztech admin if using biztech email
  if (
    email.substring(email.indexOf("@") + 1, email.length) === "ubcbiztech.com"
  ) {
    isBiztechAdmin = true;
  }
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
      updatedAt: timestamp,
      admin: isBiztechAdmin,
    },
    TableName: "biztechUsers" + process.env.ENVIRONMENT,
    ConditionExpression: "attribute_not_exists(id)"
  };


  //check whether the favedEventsArray body param meets the requirements
  if (data.hasOwnProperty('favedEventsArray') && Array.isArray(data.favedEventsArray)) {
    let favedEventsArray = data.favedEventsArray;
    if (!favedEventsArray.length === 0) { 
      callback(null, helpers.inputError("the favedEventsArray is empty", data));
    }
    if (!favedEventsArray.every(eventID => (typeof eventID === "string"))) { 
      callback(null, helpers.inputError("the favedEventsArray contains non-string element(s)", data));
    }
    if (favedEventsArray.length !== new Set(favedEventsArray).size) { 
      callback(null, helpers.inputError("the favedEventsArray contains duplicate elements", data));
    }
    //if all conditions met, add favedEventsArray as a Set to userParams
    userParams.Item['favedEventsID'] = docClient.createSet(favedEventsArray);
  }

  if (data.hasOwnProperty("inviteCode")) {
    const inviteCodeParams = {
      Key: { id: data.inviteCode },
      TableName: "inviteCodes" + process.env.ENVIRONMENT
    };
    await docClient
      .get(inviteCodeParams)
      .promise()
      .then(async result => {
        if (result.Item == null) {
          const response = helpers.createResponse(
            404,
            "Invite code not found."
          );
          callback(null, response);
        } else {
          // invite code was found
          // add paid: true to user
          userParams.Item.paid = true;
          const deleteParams = {
            Key: { id: data.inviteCode },
            TableName: "inviteCodes" + process.env.ENVIRONMENT
          };
          await docClient.delete(deleteParams).promise();
        }
      })
      .catch(error => {
        console.error(error);
        const response = helpers.createResponse(502, error);
        callback(null, response);
      });
  }

  await docClient
    .put(userParams)
    .promise()
    .then(result => {
      const response = helpers.createResponse(201, {
        message: "Created!",
        params: userParams
      });
      callback(null, response);
    })
    .catch(error => {
      const response = helpers.createResponse(
        409,
        "User could not be created because id already exists"
      );
      callback(null, response);
    });
};

module.exports.get = async (event, ctx, callback) => {
  const docClient = new AWS.DynamoDB.DocumentClient();
  const id = parseInt(event.pathParameters.id, 10);

  const params = {
    Key: {
      id
    },
    TableName: "biztechUsers" + process.env.ENVIRONMENT
  };

  await docClient
    .get(params)
    .promise()
    .then(result => {
      if (result.Item == null) {
        const response = helpers.createResponse(404, "User not found.");
        callback(null, response);
      } else {
        const response = helpers.createResponse(200, result.Item);
        callback(null, response);
      }
    })
    .catch(error => {
      console.error(error);
      const response = helpers.createResponse(502, error);
      callback(null, response);
    });
};

module.exports.update = async (event, ctx, callback) => {
  const docClient = new AWS.DynamoDB.DocumentClient();
  const data = JSON.parse(event.body);
  const id = parseInt(event.pathParameters.id, 10);

  var updateExpression = "set ";
  var expressionAttributeValues = {};

  for (var key in data) {
    if (data.hasOwnProperty(key)) {
      if (key != "id") {
        updateExpression += key + "= :" + key + ",";
        expressionAttributeValues[":" + key] = data[key];
      }
    }
  }

  const timestamp = new Date().getTime();
  updateExpression += "updatedAt = :updatedAt";
  expressionAttributeValues[":updatedAt"] = timestamp;

  const params = {
    Key: { id },
    TableName: "biztechUsers" + process.env.ENVIRONMENT,
    ExpressionAttributeValues: expressionAttributeValues,
    UpdateExpression: updateExpression,
    ConditionExpression: "attribute_exists(id)"
  };

  await docClient
    .update(params)
    .promise()
    .then(async result => {
      callback(null, helpers.createResponse(200, "Update succeeded."));
    })
    .catch(error => {
      console.error(error);
      callback(null, helpers.createResponse(404, "User not found."));
    });
};

/* 
  if successful, returns 200 and JSON with 2 fields: items and length
*/
module.exports.getAll = async (event, ctx, callback) => {
  const params = {
    TableName: "biztechUsers" + process.env.ENVIRONMENT
  };

  await docClient
    .scan(params)
    .promise()
    .then(async result => {
      if (result.Items == null) {
        const response = helpers.createResponse(404, "No users found.");
        callback(null, response);
      } else {
        const response = helpers.createResponse(200, {
          items: result.Items,
          length: result.ScannedCount
        });
        callback(null, response);
      }
    })
    .catch(async error => {
      console.error(error);
      const response = helpers.createResponse(502, error);
      callback(null, response);
    });
};

module.exports.favouriteEvent = async (event, ctx, callback) => {
  const docClient = new AWS.DynamoDB.DocumentClient();
  const data = JSON.parse(event.body);

  if (!data.hasOwnProperty("eventID")) {
    callback(null, helpers.inputError("event ID not specified.", data));
  }

  if (!data.hasOwnProperty("isFavourite")) {
    callback(
      null,
      helpers.inputError("favourite or unfavourite event not specified.", data)
    );
  }
  if (typeof data.isFavourite !== "boolean") {
    callback(
      null,
      helpers.inputError("isFavourite should be either true or false", data)
    );
  }
  let updateExpression = "";
  let conditionExpression = "";
  const isFavourite = data.isFavourite;
  if (isFavourite) {
    updateExpression = "add favedEventsID :eventsID";
    conditionExpression =
      "attribute_exists(id) and (not contains(favedEventsID, :eventID))"; // if eventID already exists, don't perform add operation
  } else {
    updateExpression = "delete favedEventsID :eventsID";
    conditionExpression =
      "attribute_exists(id) and contains(favedEventsID, :eventID)"; // if eventID does not exist, don't perform delete operation
  }
  const inputEventID = String(data.eventID);
  const id = parseInt(event.pathParameters.id, 10);
  let expressionAttributeValues;
  expressionAttributeValues = {
    ":eventsID": docClient.createSet([inputEventID]) //Set data type, for updateExpression
  }; 
  expressionAttributeValues[":eventID"] = inputEventID; //String data type, for conditionExpression

  const params = {
    Key: { id },
    TableName: "biztechUsers" + process.env.ENVIRONMENT,
    ExpressionAttributeValues: expressionAttributeValues,
    UpdateExpression: updateExpression,
    ConditionExpression: conditionExpression
  };

  await docClient
    .update(params)
    .promise()
    .then(async result => {
      let successMsg = "";
      (isFavourite)? successMsg = "Favourate" : successMsg = "Unfavourite";
      successMsg += (" event " + data.eventID + " succeed.");
      callback(null, helpers.createResponse(200, successMsg));
    })
    .catch(error => {
      let errMsg = "";
      if (error.message === "The conditional request failed") {
        (isFavourite)? errMsg = "Fail to favourite pre-existed event" : errMsg = "Fail to unfavourite non-existed event";
        errMsg += (" " + data.eventID + ", OR the user does not exist.")
      }else{
        errMsg = error.message;
      }
      callback(null, helpers.createResponse(error.statusCode, error));
    });
};
