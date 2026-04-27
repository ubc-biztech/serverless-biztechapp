"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSNSNotification = sendSNSNotification;
const client_sns_1 = require("@aws-sdk/client-sns");
const snsClient = new client_sns_1.SNSClient({
    region: "us-west-2"
});
async function sendSNSNotification(message, topicArn = process.env.SNS_TOPIC_ARN) {
    const params = {
        Message: JSON.stringify(message),
        TopicArn: topicArn,
        MessageAttributes: {
            "Environment": {
                DataType: "String",
                StringValue: process.env.ENVIRONMENT || "DEV"
            }
        }
    };
    try {
        const command = new client_sns_1.PublishCommand(params);
        await snsClient.send(command);
        console.log("SNS notification sent successfully");
    }
    catch (error) {
        console.error("Error sending SNS notification:", error);
        throw error;
    }
}
