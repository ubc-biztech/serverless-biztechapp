import db from "../../lib/db.js";
import handlerHelpers from "../../lib/handlerHelpers.js";
import { InteractionResponseType, InteractionType } from "discord-interactions";
import { DiscordRequest, verifyRequestSignature,applicationCommandRouter } from "./helpersDiscord.js";
import {
  MEMBERS2026_TABLE
} from "../../constants/tables.js";
import { assignUserRoles, removeUserRoles, backfillUserRoles } from "./helpersDiscord.js";


export const interactions = (event, ctx, callback) => {
  const body = JSON.parse(event.body);

  // reject if request is not valid
  if (!verifyRequestSignature(event)) {
    console.error("Invalid request signature");
    return callback(null, {
      statusCode: 401,
      body: JSON.stringify({
        error: "Invalid request signature"
      })
    });
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

  const {
    type, data
  } = body;

  // ping-pong interaction for verification
  if (type === InteractionType.PING) {
    console.log("Received PING interaction");
    return callback(null, {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.PONG
      })
    });
  }

  // application command interactions ie: slash commands
  if (type === InteractionType.APPLICATION_COMMAND) {
    console.log("Received APPLICATION_COMMAND interaction");
    const response = applicationCommandRouter(data.name, body);
    return callback(null, response);
  }
};

export const webhook = (event, ctx, callback) => {
  //stub
};

export const mapDiscordAccountToMembership = async (event, ctx, callback) => {
  const data = JSON.parse(event.body);

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

  const { email, discordId } = data;

  if (!email || !discordId) {
    return callback(null,
      handlerHelpers.createResponse(400, {
        message: "Missing email or discordId",
      })
    );
  }

  try {
    console.log(`Attempting to map Discord ID ${discordId} to email ${email}`);
    const exists = await db.getOne(email, MEMBERS2026_TABLE);

    if (!exists) {
      return callback(null,
        handlerHelpers.createResponse(404, {
          message: "Membership not found",
        })
      );
    }

    // guard to prevent overwriting existing ids, should require manual unlinking if necessary
    if (exists.discordId) {
      return callback(null,
        handlerHelpers.createResponse(409, {
          message: "Discord account has already been linked to this membership",
        })
      );
    }

    // update with new field
    await db.updateDB(email, { discordId }, MEMBERS2026_TABLE);

    // Assign initial roles based on membership tier
    try {
      const membershipTier = exists.membershipTier || 'basic';
      await assignUserRoles(email, membershipTier);
      console.log(`Successfully assigned ${membershipTier} role to ${email}`);
    } catch (roleError) {
      console.warn(`Failed to assign roles to ${email}:`, roleError.message);
      // Don't fail the mapping if role assignment fails
    }

    return callback(null,
      handlerHelpers.createResponse(200, {
        message: "Successfully mapped Discord account to membership",
      })
    );
  } catch (err) {
    console.error(db.dynamoErrorResponse(err));
    callback(
      null,
      handlerHelpers.createResponse(500, {
        message: "Internal server error"
      })
    );
  }
};


export const assignRoles = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);
    
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
      return callback(null, handlerHelpers.createResponse(400, {
        message: "Either membershipTier or eventID is required"
      }));
    }

    const result = await assignUserRoles(userID, membershipTier, eventID);
    
    callback(null, handlerHelpers.createResponse(200, {
      message: "Roles assigned successfully",
      result
    }));
    
  } catch (error) {
    console.error("Role assignment failed:", error);
    callback(null, handlerHelpers.createResponse(500, {
      message: "Failed to assign roles",
      error: error.message
    }));
  }
};

export const removeRoles = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);
    
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
      return callback(null, handlerHelpers.createResponse(400, {
        message: "Either membershipTier or eventID is required"
      }));
    }

    const result = await removeUserRoles(userID, membershipTier, eventID);
    
    callback(null, handlerHelpers.createResponse(200, {
      message: "Roles removed successfully", 
      result
    }));
    
  } catch (error) {
    console.error("Role removal failed:", error);
    callback(null, handlerHelpers.createResponse(500, {
      message: "Failed to remove roles",
      error: error.message
    }));
  }
};


export const backfillRoles = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.userID) {
      throw handlerHelpers.missingPathParamResponse("user", "userID");
    }

    const { userID } = event.pathParameters;
    const result = await backfillUserRoles(userID);
    
    callback(null, handlerHelpers.createResponse(200, {
      message: "User roles backfilled successfully",
      result
    }));
    
  } catch (error) {
    console.error("Backfill failed:", error);
    callback(null, error);
  }
};

