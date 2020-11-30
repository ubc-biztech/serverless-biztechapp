const AWS = require('aws-sdk');
const { RESERVED_WORDS } = require('../constants/dynamodb');

module.exports = {
  createResponse: function (statusCode, body) {

    const response = {
      statusCode,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      // helps stringify Error objects as well
      body: (body && body.stack && body.message)
        ? JSON.stringify(body, Object.getOwnPropertyNames(body))
        : JSON.stringify(body)
    };
    return response;

  },

  missingIdQueryResponse: function (type) {

    return this.createResponse(400, {
      message: `A(n) ${type} id was not provided. Check query params`
    });

  },

  missingPathParamResponse: function (type, paramName) {

    return this.createResponse(400, {
      message: `A(n) ${paramName} path parameter was not provided for this ${type}. Check path params`
    });

  },

  notFoundResponse: function(type = null, id = null, secondaryKey = null) {

    let message;

    if(type && id) {

      message = secondaryKey ?
        `${type} with id '${id}' and secondaryKey '${secondaryKey}' could not be found. Make sure you have provided them correctly.`:
        `${type} with id '${id}' could not be found. Make sure you have provided the correct id.`;

    } else {

      message = 'No entries found';

    }

    return this.createResponse(404, { message });

  },

  duplicateResponse: function(prop, data) {

    const response = this.createResponse(409, {
      message: `A database entry with the same '${prop}' already exists!`,
      data: data
    });
    console.error('DUPLICATE ERROR', response);
    return response;

  },

  dynamoErrorResponse: function (err) {

    const response = this.createResponse(err.statusCode || 502, {
      code: err.code,
      time: err.time,
      requestId: err.requestId,
      statusCode: err.statusCode,
      retryable: err.retryable,
      retryDelay: err.retryDelay
    });
    console.error('DYNAMO DB ERROR', err);
    return response;

  },

  inputError: function(message, data) {

    const response = this.createResponse(406, {
      message: message,
      data: data
    });
    console.error('INPUT ERROR', response);
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
        if(crit.required && !payload[key] && payload[key] !== false) {

          throw `'${key}' is missing from the request body`;

        }
        // check for the property's type
        if(crit.type && payload[key] && typeof payload[key] !== crit.type) {

          throw `'${key}' in the request body is invalid, expected type '${crit.type}' but got '${typeof payload[key]}'`;

        }

      });

    } catch(errMsg) {

      throw this.inputError(errMsg, payload);

    }

  },

  /**
   * Create one item and put into db
   * @param {Object} item - The item to put
   * @param {String} table - Name of table to create item in
   */
  create: async function(item, table) {

    const docClient = new AWS.DynamoDB.DocumentClient();

    try {

      // construct the param object
      const params = {
        Item: item,
        TableName: table + process.env.ENVIRONMENT,
        ConditionExpression: 'attribute_not_exists(id)'
      };

      // put into db
      const res = await docClient.put(params).promise();
      return res;

    }
    catch(err) {

      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;

    }

  },

  /**
   * Gets one item from db
   * @param {Number} id - The id of the item to get
   * @param {String} table - Name of the table
   */
  getOne: async function (id, table, extraKeys = {}) {

    const docClient = new AWS.DynamoDB.DocumentClient();

    try {

      // construct the param object
      const params = {
        Key: Object.keys(extraKeys).length===0 ? { id } : { id, ...extraKeys },
        TableName: table + process.env.ENVIRONMENT,
      };
      // get the item from db
      const item = await docClient.get(params).promise();
      return item.Item || null;

    }
    catch(err) {

      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;

    }

  },

  /**
   * Scans the rows in a DB table
   * @param {String} table - Name of the table to scan
   * @param {Object} filters - Extra scan params (filters, etc)
   */
  scan: async function (table, filters = {}) {

    const docClient = new AWS.DynamoDB.DocumentClient();

    try {

      // construct the param object
      const params = {
        TableName: table + process.env.ENVIRONMENT,
        ...filters
      };

      // scan the db
      const results = await docClient.scan(params).promise();
      return results.Items || [];

    }
    catch(err) {

      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;

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

    console.log('BatchRequestParams', batchRequestParams);

    return docClient.batchGet(batchRequestParams).promise();

  },

  /**
   * Deletes one item from db
   * @param {Number} id - The id of the item to delete
   * @param {String} table - Name of the table
   * @param {String} extraKeys - Optional extra keys
   */
  deleteOne: async function (id, table, extraKeys = {}) {

    const docClient = new AWS.DynamoDB.DocumentClient();

    try {

      // construct the param object
      const params = {
        Key: Object.keys(extraKeys).length===0 ? { id } : { id, ...extraKeys },
        TableName: table + process.env.ENVIRONMENT,
      };

      // delete the item from db
      const res = await docClient.delete(params).promise();

      return res;

    }
    catch(err) {

      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;

    }

  },

  createUpdateExpression: function (obj) {

    let val = 0;
    let updateExpression = 'set ';
    let expressionAttributeValues = {};
    let expressionAttributeNames = null;

    // TODO: Add a filter for valid object keys
    // loop through keys and create updateExpression string and
    // expressionAttributeValues object
    for (const key in obj) {

      if (obj.hasOwnProperty(key)) {

        // skip if "id" or "createdAt" or "year" or "eventID;year"
        if(key === 'id' || key === 'year' || key === 'eventID;year' || key === 'createdAt') continue;
        // use expressionAttributeNames if a reserved dynamodb word
        else if(RESERVED_WORDS.includes(key.toUpperCase())) {

          updateExpression += `#v${val} = :val${val},`;
          expressionAttributeValues[`:val${val}`] = obj[key];
          if(!expressionAttributeNames) expressionAttributeNames = {};
          expressionAttributeNames[`#v${val}`] = key;
          val++;

        }
        // else do the normal
        else {

          updateExpression += key + '= :' + key + ',';
          expressionAttributeValues[':' + key] = obj[key];

        }

      }

    }
    const timestamp = new Date().getTime();
    updateExpression += 'updatedAt = :updatedAt';
    expressionAttributeValues[':updatedAt'] = timestamp;

    return {
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    };

  },

  /**
   *
   * @param {*} id - String or Integer item ID
   * @param {Object} obj - object containing key value pairs
   * @param {String} table - name of table, ie 'biztechUsers'
   */
  updateDB: async function (id, obj, table) {

    const docClient = new AWS.DynamoDB.DocumentClient();

    try {

      // construct the update expressions
      const {
        updateExpression,
        expressionAttributeValues,
        expressionAttributeNames
      } = this.createUpdateExpression(obj);

      // construct the param object
      let params = {
        Key: { id },
        TableName: table + process.env.ENVIRONMENT,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: expressionAttributeNames,
        UpdateExpression: updateExpression,
        ReturnValues: 'UPDATED_NEW',
        ConditionExpression: 'attribute_exists(id)'
      };

      // do the magic
      const res = await docClient.update(params).promise();
      return res;

    }
    catch(err) {

      const errorResponse = this.dynamoErrorResponse(err);
      throw errorResponse;

    }

  }

};
