import { DiscordRequest } from "../bots/helpersDiscord";
import db from "../../lib/db";
import { MEMBERS2025_TABLE } from "../../constants/tables";

// Role mappings - configure these based on your Discord server
const MEMBERSHIP_ROLES = {
  basic: process.env.BASIC_MEMBER_ROLE_ID,
  premium: process.env.PREMIUM_MEMBER_ROLE_ID,
  executive: process.env.EXECUTIVE_ROLE_ID
};

const EVENT_ROLES = {
  // Add event-specific role mappings here
  // eventID: roleID
};

export const assignUserRoles = async (userID, eventID, membershipTier) => {
  const user = await db.getOne(userID, MEMBERS2025_TABLE);
  if (!user || !user.discordId) {
    throw new Error(`No Discord ID found for user ${userID}`);
  }

  const rolesToAdd = [];
  
  if (eventID && EVENT_ROLES[eventID]) {
    rolesToAdd.push(EVENT_ROLES[eventID]);
  }
  
  if (membershipTier && MEMBERSHIP_ROLES[membershipTier]) {
    rolesToAdd.push(MEMBERSHIP_ROLES[membershipTier]);
  }

  if (rolesToAdd.length === 0) {
    throw new Error("No valid roles to assign");
  }

  // Add roles via Discord API
  for (const roleID of rolesToAdd) {
    await DiscordRequest(`guilds/${process.env.DISCORD_GUILD_ID}/members/${user.discordId}/roles/${roleID}`, {
      method: "PUT"
    });
  }

  return { rolesAdded: rolesToAdd };
};

export const removeUserRoles = async (userID, eventID, membershipTier) => {
  const user = await db.getOne(userID, MEMBERS2025_TABLE);
  if (!user || !user.discordId) {
    throw new Error(`No Discord ID found for user ${userID}`);
  }

  const rolesToRemove = [];
  
  if (eventID && EVENT_ROLES[eventID]) {
    rolesToRemove.push(EVENT_ROLES[eventID]);
  }
  
  if (membershipTier && MEMBERSHIP_ROLES[membershipTier]) {
    rolesToRemove.push(MEMBERSHIP_ROLES[membershipTier]);
  }

  if (rolesToRemove.length === 0) {
    throw new Error("No valid roles to remove");
  }

  // Remove roles via Discord API
  for (const roleID of rolesToRemove) {
    await DiscordRequest(`guilds/${process.env.DISCORD_GUILD_ID}/members/${user.discordId}/roles/${roleID}`, {
      method: "DELETE"
    });
  }

  return { rolesRemoved: rolesToRemove };
};

export const backfillUserRoles = async (userID) => {
  const user = await db.getOne(userID, MEMBERS2025_TABLE);
  if (!user || !user.discordId) {
    throw new Error(`No Discord ID found for user ${userID}`);
  }

  const rolesToAdd = [];
  
  // Add membership role
  if (user.membershipTier && MEMBERSHIP_ROLES[user.membershipTier]) {
    rolesToAdd.push(MEMBERSHIP_ROLES[user.membershipTier]);
  }

  // Get user's event registrations and add event roles
  const registrations = await getUserEventRegistrations(userID);
  for (const eventID of registrations) {
    if (EVENT_ROLES[eventID]) {
      rolesToAdd.push(EVENT_ROLES[eventID]);
    }
  }

  // Add all roles
  for (const roleID of rolesToAdd) {
    try {
      await DiscordRequest(`guilds/${process.env.DISCORD_GUILD_ID}/members/${user.discordId}/roles/${roleID}`, {
        method: "PUT"
      });
    } catch (error) {
      console.warn(`Failed to add role ${roleID} to user ${userID}:`, error.message);
    }
  }

  return { rolesAssigned: rolesToAdd };
};

// Helper to get user's event registrations
const getUserEventRegistrations = async (userID) => {
  try {
    // Query user registrations table - adjust based on your schema
    const registrations = await db.query(
      "USER_REGISTRATIONS_TABLE", 
      null,
      {
        expression: "userID = :userID",
        expressionValues: { ":userID": userID }
      }
    );
    return registrations.map(reg => reg.eventID).filter(Boolean);
  } catch (error) {
    console.warn(`Failed to get registrations for user ${userID}:`, error.message);
    return [];
  }
};