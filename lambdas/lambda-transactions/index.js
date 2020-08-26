'use strict';
const AWS = require("aws-sdk");

const env = process.env.ENVIRONMENT || "";

const updateUserCredits = async (id, num, timestamp) => {

    const docClient = new AWS.DynamoDB.DocumentClient();

    try {
    
        // create the dynamodb update expressions
        const updateExpression = "ADD credits :credits SET updatedAt = :updatedAt";
        const expressionAttributeValues = {
            ":credits": num,
            ":updatedAt": timestamp,
        };
        // const expressionAttributeNames = {}

        // construct the params
        const params = {
            Key: { id: parseInt(id, 10) },
            TableName: "biztechUsers" + env,
            ExpressionAttributeValues: expressionAttributeValues,
            // ExpressionAttributeNames: expressionAttributeNames,
            UpdateExpression: updateExpression,
            ConditionExpression: "attribute_exists(id)"
        };

        // do the magic
        await docClient.update(params).promise();
        return id;

    }
    catch(err) {

        console.error(`Error updating user with id '${id}'`, err);

    }

}

exports.handler = async (event, context, callback) => {

    try {

        const creditsByUserId = {};

        // read the data passed on from dynamodb
        event.Records.forEach((record) => {

            console.log('Stream record: ', JSON.stringify(record, null, 2));

            // only read data that is inserted
            // TODO: Updates?
            if (record.eventName == 'INSERT') {

                if(!record.dynamodb || !record.dynamodb.NewImage) return null;

                const credits = record.dynamodb.NewImage.credits["N"];
                const userId = record.dynamodb.NewImage.userId["N"];

                if(!credits || !userId) return null;
                // Collect data if credits and userId are given
                else if(!creditsByUserId[userId]) creditsByUserId[userId] = parseInt(credits, 10);
                else creditsByUserId[userId] += parseInt(credits, 10);

            }
        });

        const timestamp = new Date().getTime();
        console.log({ creditsByUserId })

        // do the updating for each user found
        let successfullyUpdatedUserIds = await Promise.all(
            Object.entries(creditsByUserId).map(([id, num]) => 
                updateUserCredits(id, num, timestamp)
            )
        );

        successfullyUpdatedUserIds = successfullyUpdatedUserIds.length ? successfullyUpdatedUserIds.join(', ') : "None";
        callback(null, `Successfully processed ${event.Records.length} records. Updated users: ${successfullyUpdatedUserIds}.`);

    }
    catch(err) {

        console.error("Error:", err);
        throw err;

    }

};   