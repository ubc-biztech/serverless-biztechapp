const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

module.exports = {    
    isEmpty: function(obj) {
        return Object.keys(obj).length === 0;
    },

    inputError: function(message, data) {
        const response = {
            statusCode: 406,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Credentials': true,
            },
            body: JSON.stringify({
               message: message,
               data: data
            }, null, 2),
          };
        console.log('INPUT ERROR', response)
        return response;
    },

    /**
     * 
     * @param {*} id - String or Integer item ID
     * @param {Object} obj - object containing key value paris
     * @param {String} table - name of table, ie 'biztechUsers'
     */
    updateDB: async function(id, obj, table) {        
        var updateExpression = 'set ';
        var expressionAttributeValues = {};

        // TODO: Add a filter for valid object keys
        // loop through keys and create updateExpression string and
        // expressionAttributeValues object
        for (var key in obj){
            if(obj.hasOwnProperty(key)) {
                if (key != 'id'){
                    updateExpression += key + '\= :' + key + ',';
                    expressionAttributeValues[':' + key] = obj[key];
                }
            }
        }

        const timestamp = new Date().getTime();
        updateExpression += "updatedAt = :updatedAt";
        expressionAttributeValues[':updatedAt'] = timestamp;

        var params = {
            Key: { id },
            TableName: table + process.env.ENVIRONMENT,
            ExpressionAttributeValues: expressionAttributeValues,
            UpdateExpression: updateExpression,
            ReturnValues:"UPDATED_NEW"
        };

        // call dynamoDb
        return await docClient.update(params).promise()
        .then(result => {
            const response = {
                statusCode: 200,
                headers: {
                  'Access-Control-Allow-Origin': '*',
                  'Access-Control-Allow-Credentials': true,
                },
                body: JSON.stringify('Update succeeded.')
            };
            return response;
        })
        .catch(error => {
            console.error(error);
            const response = {
            statusCode: 500,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Credentials': true,
            },
            body: error
            };
            return response;
        });
    }
}