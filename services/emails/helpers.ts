import helpers from "../../lib/handlerHelpers";
import type { APIGatewayEvent, PayloadSchema } from "../../lib/types";

const emailTemplateSchema = {
  templateName: {
    required: true,
    type: "string",
  },
  subject: {
    required: true,
    type: "string",
  },
  html: {
    required: true,
    type: "string",
  },
  text: {
    required: true,
    type: "string",
  },
} as const satisfies PayloadSchema;

export type EmailTemplatePayload = {
  templateName: string;
  subject: string;
  html: string;
  text: string;
};

const emailHelpers = {
  errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  },

  isUnauthorized(event: APIGatewayEvent): boolean {
    const email = event.requestContext.authorizer?.claims?.email?.toLowerCase() ?? "";
    return !email.endsWith("@ubcbiztech.com");
  },

  parseBody(event: APIGatewayEvent): EmailTemplatePayload {
    const payload = JSON.parse(event.body as string) as Record<string, unknown>;
    helpers.checkPayloadProps(payload, emailTemplateSchema);
    return payload as EmailTemplatePayload;
  },
};

export default emailHelpers;