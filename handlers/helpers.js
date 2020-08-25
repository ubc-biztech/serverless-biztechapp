const AWS = require("aws-sdk");

module.exports = {
  isEmpty: function (obj) {
    return Object.keys(obj).length === 0;
  },

  createResponse: function (statusCode, body) {
    const response = {
      statusCode,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify(body)
    };
    return response;
  },

  notFoundResponse: function(type = null) {
    return this.createResponse(404, {
      message: type ? `${type} could not be found. Make sure you have provided the correct id.`: 'No entries found.'
    });
  },

  duplicateResponse: function(prop, data) {
    const response = this.createResponse(409, {
      message: `A database entry with the same '${prop}' already exists!`,
      data: data
    });
    console.log("DUPLICATE ERROR", response);
    return response;
  },

  inputError: function(message, data) {
    const response = this.createResponse(406, {
        message: message,
        data: data
      })
    console.log("INPUT ERROR", response);
    return response;
  },

  /**
   * Check if the object passed matches the criteria
   * @param {*} payload - the object 
   * @param {*} check  - object containing the criteria for each property keyed by the property name
   * The object criteria accepts the following properties:
   * {
   *    required: <boolean>,
   *    type: <string>
   * }
   */
  checkPayloadProps: function(payload, check = {}) {
    try {

      const criteria = Object.entries(check);

      criteria.forEach(([key, crit]) => {

        // check if property exists
        if(crit.required && !payload[key]) {
          throw `'${key}' is missing from the request body`;
        }
        // check for the property's type
        if(crit.type && payload[key] && typeof payload[key] !== crit.type) {
          throw `'${key}' in the request body is invalid, expected type '${crit.type}' but got '${typeof payload[key]}'`;
        }

      })
    } catch(errMsg) {

      throw this.inputError(errMsg, payload);

    }
  },

  /**
   *
   * @param {Array} batch - List of batches in form of [{Key: value}]
   * @param {String} tableName - Name of table to call batchGet
   */
  batchGet: function (batch, tableName) {
    const docClient = new AWS.DynamoDB.DocumentClient();

    const batchRequestParams = {
      RequestItems: {
        [tableName]: {
          Keys: batch
        }
      }
    };

    console.log("BatchRequestParams", batchRequestParams);

    return docClient.batchGet(batchRequestParams).promise();
  },

  createUpdateExpression: function (obj) {
    let updateExpression = "set ";
    let expressionAttributeValues = {};

    // TODO: Add a filter for valid object keys
    // loop through keys and create updateExpression string and
    // expressionAttributeValues object
    for (var key in obj) {
      // TODO: Add a filter for valid object keys
      if (obj.hasOwnProperty(key)) {
        if (key != "id" && key != "createdAt") {
          updateExpression += key + "= :" + key + ",";
          expressionAttributeValues[":" + key] = obj[key];
        }
      }
    }
    const timestamp = new Date().getTime();
    updateExpression += "updatedAt = :updatedAt";
    expressionAttributeValues[":updatedAt"] = timestamp;

    return {
      updateExpression,
      expressionAttributeValues
    };
  },

  /**
   *
   * @param {*} id - String or Integer item ID
   * @param {Object} obj - object containing key value paris
   * @param {String} table - name of table, ie 'biztechUsers'
   */
  updateDB: async function (id, obj, table) {
    const docClient = new AWS.DynamoDB.DocumentClient();
    var updateExpression = "set ";
    var expressionAttributeValues = {};

    // TODO: Add a filter for valid object keys
    // loop through keys and create updateExpression string and
    // expressionAttributeValues object
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (key != "id") {
          updateExpression += key + "= :" + key + ",";
          expressionAttributeValues[":" + key] = obj[key];
        }
      }
    }

    const timestamp = new Date().getTime();
    updateExpression += "updatedAt = :updatedAt";
    expressionAttributeValues[":updatedAt"] = timestamp;

    var params = {
      Key: { id },
      TableName: table + process.env.ENVIRONMENT,
      ExpressionAttributeValues: expressionAttributeValues,
      UpdateExpression: updateExpression,
      ReturnValues: "UPDATED_NEW",
      ConditionExpression: "attribute_exists(id)"
    };

    // call dynamoDb
    return await docClient
      .update(params)
      .promise()
      .then(result => {
        const response = this.createResponse(200, "Update succeeded.")
        return response;
      })
      .catch(error => {
        console.error(error);
        const response = this.createResponse(502, error)
        return response;
      });
  },

  /**
   * Takes an event ID and returns an object containing
   * registeredCount, checkedInCount and waitlistCount
   * @param {String} eventID
   * @return {registeredCount checkedInCount waitlistCount}
   */
  getEventCounts: async function (eventID) {
    const docClient = new AWS.DynamoDB.DocumentClient();
    const params = {
      TableName: "biztechRegistration" + process.env.ENVIRONMENT,
      FilterExpression: "eventID = :query",
      ExpressionAttributeValues: {
        ":query": eventID
      }
    };
    return await docClient
      .scan(params)
      .promise()
      .then(result => {
        let counts = {
          registeredCount: 0,
          checkedInCount: 0,
          waitlistCount: 0
        };

        result.Items.forEach(item => {
          switch (item.registrationStatus) {
            case "registered":
              counts.registeredCount++;
              break;
            case "checkedIn":
              counts.checkedInCount++;
              break;
            case "waitlist":
              counts.waitlistCount++;
              break;
          }
        });

        return counts;
      })
      .catch(error => {
        console.log(error);
        return null;
      });
  }
};
