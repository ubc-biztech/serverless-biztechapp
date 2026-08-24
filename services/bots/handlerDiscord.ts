import db from "../../lib/db";
import handlerHelpers from "../../lib/handlerHelpers";
import { InteractionResponseType, InteractionType } from "discord-interactions";
import {
  verifyRequestSignature,
  applicationCommandRouter
} from "./helpersDiscord";
import { MEMBERS_TABLE } from "../../constants/tables";
import {
  assignUserRoles,
  removeUserRoles,
  backfillUserRoles
} from "./helpersDiscord";
import type { APIGatewayEvent, LambdaCallback, LambdaContext } from "../../lib/types";

export const interactions = (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  const body = JSON.parse(event.body as string);

  // reject if request is not valid
  if (!verifyRequestSignature(event)) {
    console.error("Invalid request signature");
    return {
      statusCode: 401,
      body: JSON.stringify({
        error: "Invalid request signature"
      })
    };
  }

  handlerHelpers.checkPayloadProps(body, {
    id: {
      required: false
    },
    type: {
      required: true,
      type: "number"
    },
    data: {
      required: false
    }
  });

  const { type, data } = body;

  // ping-pong interaction for verification
  if (type === InteractionType.PING) {
    console.log("Received PING interaction");
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.PONG
      })
    };
  }

  // application command interactions ie: slash commands
  if (type === InteractionType.APPLICATION_COMMAND) {
    console.log("Received APPLICATION_COMMAND interaction");
    const response = applicationCommandRouter(data.name, body);
    return response;
  }
};

export const webhook = (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  //stub
};

export const mapDiscordAccountToMembership = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  const data = JSON.parse(event.body as string);

  handlerHelpers.checkPayloadProps(data, {
    email: {
      required: true,
      type: "string"
    },
    discordId: {
      required: true,
      type: "string"
    }
  });

  // `authorizer` and `claims` are optional on the event type; the original JS
  // throws a TypeError when they are absent, so assert rather than guard.
  const email = event.requestContext.authorizer!.claims!.email.toLowerCase();
  const { discordId } = data;

  if (!email || !discordId) {
    return handlerHelpers.createResponse(400, {
      message: "Missing email or discordId"
    });
  }

  try {
    console.log(`Attempting to map Discord ID ${discordId} to email ${email}`);
    const exists = await db.getOne(email, MEMBERS_TABLE);

    if (!exists) {
      return handlerHelpers.createResponse(404, {
        message: "Membership not found"
      });
    }

    // guard to prevent overwriting existing ids, should require manual unlinking if necessary
    if (exists.discordId) {
      return handlerHelpers.createResponse(409, {
        message: "Discord account has already been linked to this membership"
      });
    }

    // update with new field
    await db.updateDB(email, { discordId }, MEMBERS_TABLE);

    // assign verfied role based on membership tier
    try {
      await assignUserRoles(
        email,
        // BUG (pre-existing, preserved): `""` is always falsy, so this concatenates
        // `process.env.ENVIRONMENT` rather than an empty string.
        // @ts-expect-error TS2873 This kind of expression is always falsy.
        "verified" + ("" || process.env.ENVIRONMENT)
      );
      console.log(`Successfully verified ${email}`);
    } catch (roleError) {
      console.warn(`Failed to assign roles to ${email}:`, (roleError as { message?: unknown }).message);
    }

    return handlerHelpers.createResponse(200, {
      message: "Successfully mapped Discord account to membership"
    });
  } catch (err) {
    console.error(db.dynamoErrorResponse(err));
    return handlerHelpers.createResponse(500, {
      message: (err as { message?: unknown }).message || err
    });
  }
};

export const assignRoles = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  try {
    const data = JSON.parse(event.body as string);

    handlerHelpers.checkPayloadProps(data, {
      userID: {
        required: true,
        type: "string"
      },
      membershipTier: {
        required: false,
        type: "string"
      },
      eventID: {
        required: false,
        type: "string"
      }
    });

    const { userID, membershipTier, eventID } = data;

    if (!membershipTier && !eventID) {
      return handlerHelpers.createResponse(400, {
        message: "Either membershipTier or eventID is required"
      });
    }

    const result = await assignUserRoles(userID, membershipTier, eventID);

    return handlerHelpers.createResponse(200, {
      message: "Roles assigned successfully",
      result
    });
  } catch (error) {
    console.error("Role assignment failed:", error);
    return handlerHelpers.createResponse(500, {
      message: "Failed to assign roles",
      error: (error as { message?: unknown }).message
    });
  }
};

export const removeRoles = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  try {
    const data = JSON.parse(event.body as string);

    handlerHelpers.checkPayloadProps(data, {
      userID: {
        required: true,
        type: "string"
      },
      membershipTier: {
        required: false,
        type: "string"
      },
      eventID: {
        required: false,
        type: "string"
      }
    });

    const { userID, membershipTier, eventID } = data;

    if (!membershipTier && !eventID) {
      return handlerHelpers.createResponse(400, {
        message: "Either membershipTier or eventID is required"
      });
    }

    const result = await removeUserRoles(userID, membershipTier, eventID);

    return handlerHelpers.createResponse(200, {
      message: "Roles removed successfully",
      result
    });
  } catch (error) {
    console.error("Role removal failed:", error);
    return handlerHelpers.createResponse(500, {
      message: "Failed to remove roles",
      error: (error as { message?: unknown }).message
    });
  }
};

export const backfillRoles = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.userID) {
      throw handlerHelpers.missingPathParamResponse("user", "userID");
    }

    const { userID } = event.pathParameters;
    const result = await backfillUserRoles(userID);

    return handlerHelpers.createResponse(200, {
      message: "User roles backfilled successfully",
      result
    });
  } catch (error) {
    console.error("Backfill failed:", error);
    return handlerHelpers.createResponse(500, {
      message: (error as { message?: unknown }).message || error
    });
  }
};
