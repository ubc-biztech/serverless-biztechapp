import db from "../../lib/db.js";
import handlerHelpers from "../../lib/handlerHelpers.js";
import { 
  InteractionResponseType, 
  InteractionType 
} from "discord-interactions";
import { 
  DiscordRequest, 
  verifyRequestSignature, 
  applicationCommandRouter 
} from "./helpersDiscord.js";
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

  const { email, discordID: discordId } = data;

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
    await db.updateDB(email, {
      discordId
    }, MEMBERS2026_TABLE);

    // assign verfied role based on membership tier
    // TODO: Assign event-specific roles
    try {
      await assignUserRoles(email, 'verified');
      console.log(`Successfully assigned ${membershipTier} role to ${email}`);
    } catch (roleError) {
      console.warn(`Failed to assign roles to ${email}:`, roleError.message);
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