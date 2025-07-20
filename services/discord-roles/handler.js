import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: "us-west-2" });
const docClient = DynamoDBDocumentClient.from(client);

// Discord configuration
const DISCORD_CONFIG = {
  GUILD_ID: process.env.DISCORD_GUILD_ID || "your_guild_id",
  BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || "your_bot_token"
};

// Role mappings
const MEMBERSHIP_ROLES = {
  basic: process.env.BASIC_MEMBER_ROLE_ID || "basic_role_id",
  premium: process.env.PREMIUM_MEMBER_ROLE_ID || "premium_role_id",
  executive: process.env.EXECUTIVE_ROLE_ID || "executive_role_id"
};

// Copy the handlerHelpers functions we need locally to avoid import issues
const createResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  },
  body: JSON.stringify(body)
});

// Helper to make Discord API calls
const discordRequest = async (endpoint, options = {}) => {
  const url = `https://discord.com/api/v10/${endpoint}`;
  
  // Debug logging
  console.log("Discord config:", {
    hasToken: !!DISCORD_CONFIG.BOT_TOKEN,
    tokenLength: DISCORD_CONFIG.BOT_TOKEN.length,
    guildId: DISCORD_CONFIG.GUILD_ID
  });
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bot ${DISCORD_CONFIG.BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    ...options
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Discord API Error:", response.status, error);
    throw new Error(`Discord API error: ${response.status} ${error}`);
  }

  return response;
};

// Helper to get user from database
const getUser = async (userID) => {
  try {
    const params = {
        // TODO read this from constants/tables.js when we make the 2026 tables
      TableName: "biztechMembers2025", // hard coded for testing purposes
      Key: { id: userID }
    };
    
    const command = new GetCommand(params);
    const result = await docClient.send(command);
    return result.Item || null;
  } catch (error) {
    console.error("Database error:", error);
    return null;
  }
};

// Helper to assign/remove Discord roles
const updateDiscordRole = async (discordId, roleId, action) => {
  const endpoint = `guilds/${DISCORD_CONFIG.GUILD_ID}/members/${discordId}/roles/${roleId}`;
  const method = action === 'assign' ? 'PUT' : 'DELETE';
  
  await discordRequest(endpoint, { method });
  return { roleId, action };
};

export const batchRoles = async (event) => {
  try {
    const data = JSON.parse(event.body);
    
    // Basic validation
    if (!data.updates || !Array.isArray(data.updates)) {
      return createResponse(400, {
        message: "Invalid request body. Expected 'updates' array."
      });
    }

    const results = { successful: [], failed: [] };

    for (const update of data.updates) {
      const { userID, action, eventID, membershipTier } = update;
      
      if (!userID || !action) {
        results.failed.push({ userID, error: "Missing userID or action" });
        continue;
      }

      try {
        // Check if user exists in database
        const user = await getUser(userID);
        
        if (!user) {
          results.failed.push({ userID, error: "User not found in database" });
          continue;
        }

        if (!user.discordId) {
          results.failed.push({ userID, error: "No Discord ID found for user" });
          continue;
        }

        // Determine which role to assign/remove
        let roleId = null;
        if (membershipTier && MEMBERSHIP_ROLES[membershipTier]) {
          roleId = MEMBERSHIP_ROLES[membershipTier];
        }
        // Add event role logic here later if needed

        if (!roleId) {
          results.failed.push({ userID, error: "No valid role found for this request" });
          continue;
        }

        // Make Discord API call
        const roleResult = await updateDiscordRole(user.discordId, roleId, action);
        
        results.successful.push({ 
          userID, 
          action, 
          eventID, 
          membershipTier,
          discordId: user.discordId,
          roleModified: roleResult.roleId,
          status: `Role ${action}ed successfully` 
        });
        
      } catch (error) {
        results.failed.push({ userID, error: error.message });
      }
    }

    return createResponse(200, {
      message: "Batch role update completed",
      results
    });
    
  } catch (error) {
    console.error("Error:", error);
    return createResponse(500, {
      message: "Internal server error"
    });
  }
};

export const backfill = async (event) => {
  try {
    const { userID } = event.pathParameters;
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: "Backfill endpoint working",
        userID,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: "Internal server error"
      })
    };
  }
};