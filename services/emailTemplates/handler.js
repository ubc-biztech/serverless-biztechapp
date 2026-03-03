import client from "../../lib/sesV2Client.js";
import helpers from "../../lib/handlerHelpers.js";
import {
  GetEmailTemplateCommand,
  CreateEmailTemplateCommand,
  UpdateEmailTemplateCommand,
  DeleteEmailTemplateCommand,
  ListEmailTemplatesCommand
} from "@aws-sdk/client-sesv2";

export const getEmailTemplate = async (event, ctx, callback) => {
  try {
    const templateName = event.pathParameters?.templateName;

    if (!templateName) {
      return helpers.missingPathParamResponse("template", "templateName");
    }

    const command = new GetEmailTemplateCommand({ TemplateName: templateName });
    const response = await client.send(command);

    return helpers.createResponse(200, response);
  } catch (error) {
    console.error("Error getting email template:", error);
    return helpers.createResponse(500, {
      message: "Error getting email template",
      error: error.message
    });
  }
};

export const createEmailTemplate = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      templateName: {
        required: true,
        type: "string"
      },
      subject: {
        required: true,
        type: "string"
      },
      html: {
        required: true,
        type: "string"
      },
      text: {
        required: true,
        type: "string"
      },
    });

    const command = new CreateEmailTemplateCommand({
      TemplateName: data.templateName,
      Subject: data.subject,
      Html: data.html,
      TextPart: data.text,
    });
    const response = await client.send(command);

    return helpers.createResponse(201, {
      message: "Email template created",
      response
    });
  } catch (error) {
    console.error("Error creating email template:", error);
    return helpers.createResponse(500, {
      message: "Error creating email template",
      error: error.message
    });
  }
};

export const updateEmailTemplate = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
      templateName: {
        required: true,
        type: "string"
      },
      subject: {
        required: true,
        type: "string"
      },
      html: {
        required: true,
        type: "string"
      },
      text: {
        required: true,
        type: "string"
      },
    });

    const command = new UpdateEmailTemplateCommand({
      TemplateName: data.templateName,
      Subject: data.subject,
      Html: data.html,
      TextPart: data.text,
    });
    const response = await client.send(command);

    return helpers.createResponse(200, {
      message: "Email template updated",
      response
    });
  } catch (error) {
    console.error("Error updating email template:", error);
    return helpers.createResponse(500, {
      message: "Error updating email template",
      error: error.message
    });
  }
};

export const deleteEmailTemplate = async (event, ctx, callback) => {
  try {
    const templateName = event.pathParameters?.templateName;

    if (!templateName) {
      return helpers.missingPathParamResponse("template", "templateName");
    }

    const command = new DeleteEmailTemplateCommand({ TemplateName: templateName });
    const response = await client.send(command);

    return helpers.createResponse(200, {
      message: "Email template deleted",
      response
    });
  } catch (error) {
    console.error("Error deleting email template:", error);
    return helpers.createResponse(500, {
      message: "Error deleting email template",
      error: error.message
    });
  }
};

export const listEmailTemplates = async (event, ctx, callback) => {
  try {
    const command = new ListEmailTemplatesCommand({});
    const response = await client.send(command);

    return helpers.createResponse(200, response);
  } catch (error) {
    console.error("Error listing email templates:", error);
    return helpers.createResponse(500, {
      message: "Error listing email templates",
      error: error.message,
    });
  }
};
