import {
  CreateEmailTemplateCommand,
  DeleteEmailTemplateCommand,
  GetEmailTemplateCommand,
  ListEmailTemplatesCommand,
  type ListEmailTemplatesCommandInput,
  type ListEmailTemplatesCommandOutput,
  UpdateEmailTemplateCommand,
  type EmailTemplateMetadata,
} from "@aws-sdk/client-sesv2";
import helpers from "../../lib/handlerHelpers";
import res from "../../lib/responseHelpers";
import { sesClient } from "../../lib/sesV2Client.js";
import type { APIGatewayEvent, LambdaCallback, LambdaContext } from "../../lib/types";
import emailHelpers from "./helpers";

export const getEmailTemplate = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (emailHelpers.isUnauthorized(event)) {
      return res.unauthorized("Unauthorized");
    }

    const templateName = event.pathParameters?.templateName;
    if (!templateName) {
      return helpers.missingPathParamResponse("template", "templateName");
    }

    const response = await sesClient.send(
      new GetEmailTemplateCommand({ TemplateName: templateName }),
    );

    return res.ok(response);
  } catch (error) {
    console.error("Error getting email template:", error);
    return res.error("Error getting email template", emailHelpers.errorMessage(error));
  }
};

export const createEmailTemplate = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (emailHelpers.isUnauthorized(event)) {
      return res.unauthorized("Unauthorized");
    }

    const data = emailHelpers.parseBody(event);
    const response = await sesClient.send(
      new CreateEmailTemplateCommand({
        TemplateName: data.templateName,
        TemplateContent: {
          Subject: data.subject,
          Html: data.html,
          Text: data.text,
        },
      }),
    );

    return res.created({
      message: "Email template created",
      response,
    });
  } catch (error) {
    console.error("Error creating email template:", error);
    return res.error("Error creating email template", emailHelpers.errorMessage(error));
  }
};

export const updateEmailTemplate = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (emailHelpers.isUnauthorized(event)) {
      return res.unauthorized("Unauthorized");
    }

    const data = emailHelpers.parseBody(event);
    const response = await sesClient.send(
      new UpdateEmailTemplateCommand({
        TemplateName: data.templateName,
        TemplateContent: {
          Subject: data.subject,
          Html: data.html,
          Text: data.text,
        },
      }),
    );

    return res.ok({
      message: "Email template updated",
      response,
    });
  } catch (error) {
    console.error("Error updating email template:", error);
    return res.error("Error updating email template", emailHelpers.errorMessage(error));
  }
};

export const deleteEmailTemplate = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (emailHelpers.isUnauthorized(event)) {
      return res.unauthorized("Unauthorized");
    }

    const templateName = event.pathParameters?.templateName;
    if (!templateName) {
      return helpers.missingPathParamResponse("template", "templateName");
    }

    const response = await sesClient.send(
      new DeleteEmailTemplateCommand({ TemplateName: templateName }),
    );

    return res.ok({
      message: "Email template deleted",
      response,
    });
  } catch (error) {
    console.error("Error deleting email template:", error);
    return res.error("Error deleting email template", emailHelpers.errorMessage(error));
  }
};

export const listEmailTemplates = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (emailHelpers.isUnauthorized(event)) {
      return res.unauthorized("Unauthorized");
    }

    const emailTemplates: EmailTemplateMetadata[] = [];
    const input: ListEmailTemplatesCommandInput = {};

    let response: ListEmailTemplatesCommandOutput = await sesClient.send(
      new ListEmailTemplatesCommand(input),
    );
    emailTemplates.push(...(response.TemplatesMetadata ?? []));
    input.NextToken = response.NextToken;

    while (input.NextToken) {
      response = await sesClient.send(new ListEmailTemplatesCommand(input));
      emailTemplates.push(...(response.TemplatesMetadata ?? []));
      input.NextToken = response.NextToken;
    }

    return res.ok({ emailTemplates });
  } catch (error) {
    console.error("Error listing email templates:", error);
    return res.error("Error listing email templates", emailHelpers.errorMessage(error));
  }
};
