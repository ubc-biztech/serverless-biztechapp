import nacl from "tweetnacl";
import fetch from "node-fetch";
import { InteractionResponseType } from "discord-interactions";
import db from "../../lib/db";
import { MEMBERS2026_TABLE } from "../../constants/tables";
import {
  DISCORD_GUILD_ID,
  DISCORD_GUILD_ID_PROD,
  MEMBERSHIP_ROLES
} from "./constants.js";

export async function DiscordRequest(endpoint, options) {
  const url = "https://discord.com/api/v10/" + endpoint;
  if (options.body) options.body = JSON.stringify(options.body);
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bot ${
        process.env.ENVIRONMENT === "PROD"
          ? process.env.DISCORD_TOKEN_PROD
          : process.env.DISCORD_TOKEN
      }`,
      "Content-Type": "application/json; charset=UTF-8"
    },
    ...options
  });

  if (!res.ok) {
    const data = await res.json();
    console.log(res.status);
    throw new Error(JSON.stringify(data));
  }

  return res;
}

export function verifyRequestSignature(req) {
  let isValid = false;
  const signature =
    req.headers["x-signature-ed25519"] || req.headers["X-Signature-Ed25519"];
  const timestamp =
    req.headers["x-signature-timestamp"] ||
    req.headers["X-Signature-Timestamp"];
  const body = req.body;

  if (!signature || !timestamp) {
    console.error("Missing signature or timestamp in request headers");
    return false;
  }

  isValid = nacl.sign.detached.verify(
    Buffer.from(timestamp + body),
    Buffer.from(signature, "hex"),
    Buffer.from(
      process.env.ENVIRONMENT === "PROD"
        ? process.env.DISCORD_PUBLIC_KEY_PROD
        : process.env.DISCORD_PUBLIC_KEY,
      "hex"
    )
  );

  return isValid;
}

// Handles application commands and routes them to the appropriate handler
// * handlers should return a response object with statusCode and body
export function applicationCommandRouter(name, body) {
  const { member } = body;
  switch (name) {
    case "verify":
      return handleVerifyCommand(member);

    default:
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Unknown command: /${body.name}`,
            flags: 64
          }
        })
      };
  }
}

// handles /verify slash command
function handleVerifyCommand(member) {
  const discordUserId = member?.user?.id;

  console.log("User initiating verify:", discordUserId);

  const idpLoginUrl = `https://${
    process.env.ENVIRONMENT === "PROD" ? "" : "dev."
  }app.ubcbiztech.com/login?redirect=/discord/verify/${discordUserId}`;

  // guard against use outside of a server
  if (!discordUserId) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content:
            "❌ This command can only be used in the UBC Biztech server.",
          flags: 64
        }
      })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "🔐 Click below to verify your account.",
        flags: 64,
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: "Login with the UBC BizTech web app",
                url: idpLoginUrl
              }
            ]
          }
        ]
      }
    })
  };
}

export async function assignUserRoles(userID, membershipTier, eventID = null) {
  const user = await db.getOne(userID, MEMBERS2026_TABLE);
  if (!user) {
    throw new Error(`User ${userID} not found in database`);
  }

  if (!user.discordId) {
    throw new Error(`No Discord ID found for user ${userID}`);
  }

  if (!/^\d{17,19}$/.test(user.discordId)) {
    throw new Error(
      `Invalid Discord ID format: "${user.discordId}". Should be a numeric snowflake`
    );
  }

  const rolesToAdd = [];

  if (membershipTier && MEMBERSHIP_ROLES[membershipTier]) {
    rolesToAdd.push(...MEMBERSHIP_ROLES[membershipTier]);
  }

  // TODO: add event role logic here when needed

  if (rolesToAdd.length === 0) {
    throw new Error("No valid roles to assign");
  }

  const results = [];
  for (const roleID of rolesToAdd) {
    try {
      await DiscordRequest(
        `guilds/${DISCORD_GUILD_ID}/members/${user.discordId}/roles/${roleID}`,
        {
          method: "PUT"
        }
      );
      results.push({
        roleID,
        status: "assigned"
      });
    } catch (error) {
      console.error(
        `Failed to assign role ${roleID} to user ${userID}:`,
        error.message
      );
      results.push({
        roleID,
        status: "failed",
        error: error.message
      });
    }
  }

  return {
    userID,
    discordId: user.discordId,
    membershipTier,
    results
  };
}

export async function removeUserRoles(userID, membershipTier, eventID = null) {
  const user = await db.getOne(userID, MEMBERS2026_TABLE);
  if (!user) {
    throw new Error(`User ${userID} not found in database`);
  }

  if (!user.discordId) {
    throw new Error(`No Discord ID found for user ${userID}`);
  }

  const rolesToRemove = [];

  if (membershipTier && MEMBERSHIP_ROLES[membershipTier]) {
    rolesToRemove.push(MEMBERSHIP_ROLES[membershipTier]);
  }

  // TODO: Add event role logic here when needed

  if (rolesToRemove.length === 0) {
    throw new Error("No valid roles to remove");
  }

  const results = [];
  for (const roleID of rolesToRemove) {
    try {
      await DiscordRequest(
        `guilds/${
          process.env.ENVIRONMENT === "PROD"
            ? DISCORD_GUILD_ID_PROD
            : DISCORD_GUILD_ID
        }/members/${user.discordId}/roles/${roleID}`,
        {
          method: "DELETE"
        }
      );
      results.push({
        roleID,
        status: "removed"
      });
    } catch (error) {
      console.error(
        `Failed to remove role ${roleID} from user ${userID}:`,
        error.message
      );
      results.push({
        roleID,
        status: "failed",
        error: error.message
      });
    }
  }

  return {
    userID,
    discordId: user.discordId,
    membershipTier,
    results
  };
}

export async function backfillUserRoles(userID) {
  const user = await db.getOne(userID, MEMBERS2026_TABLE);
  if (!user) {
    throw new Error(`User ${userID} not found in database`);
  }

  if (!user.discordId) {
    throw new Error(`No Discord ID found for user ${userID}`);
  }

  // Get their current membership tier and assign appropriate role
  const membershipTier = user.membershipTier || "basic";
  return await assignUserRoles(userID, membershipTier);
}
