import {
  SNSClient, PublishCommand, PublishCommandInput
} from "@aws-sdk/client-sns";

const snsClient = new SNSClient({
  region: "us-west-2"
});

export async function sendSNSNotification(message: unknown, topicArn: string | undefined = process.env.SNS_TOPIC_ARN): Promise<void> {
  const params: PublishCommandInput = {
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
    const command = new PublishCommand(params);
    await snsClient.send(command);
    console.log("SNS notification sent successfully");
  } catch (error) {
    console.error("Error sending SNS notification:", error);
    throw error;
  }
}
