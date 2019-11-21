const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

module.exports = {    
    isEmpty: function(obj) {
        return Object.keys(obj).length === 0;
    },

    createUpdateExpression: function(obj) {
        let updateExpression = 'set ';
        let expressionAttributeValues = {};
        
        // loop through keys and create updateExpression string and
        // expressionAttributeValues object
        for (var key in obj){
            // TODO: Add a filter for valid object keys
            if(obj.hasOwnProperty(key)) {
                if (key != 'id' && key != 'createdAt'){
                    updateExpression += key + '\= :' + key + ',';
                    expressionAttributeValues[':' + key] = obj[key];
                }
            }
        }

        const timestamp = new Date().getTime();
        updateExpression += "updatedAt = :updatedAt";
        expressionAttributeValues[':updatedAt'] = timestamp;
    
        return {
            updateExpression,
            expressionAttributeValues
        }
    },

    /**
     * 
     * @param {*} id - String or Number item ID
     * @param {Object} obj - object containing key value paris
     * @param {String} table - name of table, ie 'biztechUsers'
     */
    updateDB: async function(id, obj, table) {

        const { updateExpression, expressionAttributeValues } = this.createUpdateExpression(obj)

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
                body: JSON.stringify('Update succeeded')
            };
            return response;
        })
        .catch(error => {
            console.error(error);
            const response = {
            statusCode: 500,
            body: error
            };
            return response;
        });
    },
    
    /**
     * Takes an event ID and returns an object containing
     * registeredCount, checkedInCount and waitlistCount
     * @param {String} eventID 
     * @return {registeredCount checkedInCount waitlistCount}
     */
    getEventCounts: async function(eventID) {
        const params = {
            TableName: 'biztechRegistration' + process.env.ENVIRONMENT,
            FilterExpression: 'eventID = :query',
            ExpressionAttributeValues: {
                ':query': eventID
            }
        }
        return await docClient.scan(params).promise()
            .then(result => {

                let counts = {
                    registeredCount: 0,
                    checkedInCount: 0,
                    waitlistCount: 0,
                }

                result.Items.forEach(item => {
                    switch(item.status){
                        case 'registered':
                            counts.registeredCount++
                            break
                        case 'checkedIn':
                            counts.checkedInCount++
                            break
                        case 'waitlist':
                            counts.waitlistCount++
                            break
                    }
                })

                return counts;
            })
            .catch(error => console.log(error))
    }

}