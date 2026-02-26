import {
  SESV2Client,
  GetEmailTemplateCommand,
  CreateEmailTemplateCommand,
  UpdateEmailTemplateCommand,
  DeleteEmailTemplateCommand
} from "@aws-sdk/client-sesv2";

const client = new SESV2Client({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  region: "us-west-2",
});

export async function getEmailTemplate(templateName) {
  try {
    const command = new GetEmailTemplateCommand({ TemplateName: templateName });
    const response = await client.send(command);
    return response;
  } catch (error) {
    console.error("Error getting email template:", error);
    throw error;
  }
}

export async function createEmailTemplate({ templateName, subject, html, text }) {
  try {
    const command = new CreateEmailTemplateCommand({
      TemplateName: templateName,
      Subject: subject,
      Html: html,
      TextPart: text,
    });
    const response = await client.send(command);
    return response;
  } catch (error) {
    console.error("Error creating email template:", error);
    throw error;
  }
}

export async function updateEmailTemplate({ templateName, subject, html, text }) {
  try {
    const command = new UpdateEmailTemplateCommand({
      TemplateName: templateName,
      Subject: subject,
      Html: html,
      TextPart: text,
    });
    const response = await client.send(command);
    return response;
  } catch (error) {
    console.error("Error updating email template:", error);
    throw error;
  }
}

export async function deleteEmailTemplate(templateName) {
  try {
    const command = new DeleteEmailTemplateCommand({ TemplateName: templateName });
    const response = await client.send(command);
    return response;
  } catch (error) {
    console.error("Error deleting email template:", error);
    throw error;
  }
}
