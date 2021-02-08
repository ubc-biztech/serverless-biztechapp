import AWS from 'aws-sdk';
import { RESERVED_WORDS } from '../constants/dynamodb';

export default {
  // DATABASE HELPER FUNCTIONS
  dynamoErrorResponse: function (err) {

    const body = {
      code: err.code,
      time: err.time,
      requestId: err.requestId,
      statusCode: err.statusCode,
      retryable: err.retryable,
      retryDelay: err.retryDelay
    };

    const response = {
      statusCode: err.statusCode || 502,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      // helps stringify Error objects as well
      body: (body && body.stack && body.message)
        ? JSON.stringify(body, Object.getOwnPropertyNames(body))
        : JSON.stringify(body)
    };

    console.error('DYNAMO DB ERROR', err);
    return response;

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

  // DATABASE INTERACTIONS

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

    if (table !== 'biztechMemberships2021') {
      table = table + process.env.ENIRONMENT;
    }

    try {

      // construct the param object
      const params = {
        TableName: table,
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
