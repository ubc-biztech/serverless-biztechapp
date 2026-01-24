import { QUESTS_TABLE, MEMBERS2026_TABLE, PROFILES_TABLE } from "../../constants/tables";
import db from "../../lib/db";
import { QUEST_DEFS } from "./constants";
import { applyQuestEvent, parseEvents, initStoredQuest } from "./helper.js";
import handlerHelpers from "../../lib/handlerHelpers";
import helpers from "../../lib/handlerHelpers";

/**
 * Look up a user's email from their profileId using the members table GSI
 * @param {string} profileId - The human-readable profile ID (e.g., "clever-fox-123")
 * @returns {string|null} - The user's email or null if not found
 */
async function getEmailFromProfileId(profileId) {
  try {
    const results = await db.query(MEMBERS2026_TABLE, "profile-query", {
      expression: "#profileID = :profileID",
      expressionNames: {
        "#profileID": "profileID"
      },
      expressionValues: {
        ":profileID": profileId
      }
    });

    if (results && results.length > 0) {
      // The 'id' field in the members table is the email
      return results[0].id;
    }
    return null;
  } catch (err) {
    console.error(`Error looking up email for profileId ${profileId}:`, err);
    return null;
  }
}

/**
 * Helper function to update quest progress for a specific user
 * Handles both new users (no quests yet) and existing users
 * Also handles race conditions when creating new quest records
 * IDEMPOTENT: For connection events, tracks connected profileIds to prevent double-counting
 * 
 * @param {string} userID - The user ID (email) to update quests for
 * @param {string} event_id - The event ID
 * @param {string} year - The event year
 * @param {Array} questEvents - Parsed quest events to apply
 * @param {number} timestamp - The timestamp for the update
 * @param {string|null} connectionProfileId - For connection events, the profileId being connected to (for idempotency)
 * @returns {Object} - { success: boolean, quests: Object, alreadyConnected?: boolean, error?: string }
 */
async function updateUserQuestProgress(userID, event_id, year, questEvents, timestamp, connectionProfileId = null) {
  const eventKey = `${event_id}#${year}`;

  let userItem;
  try {
    userItem = await db.getOne(userID, QUESTS_TABLE, { "eventID#year": eventKey });
  } catch (err) {
    console.error(`Could not read user data for ${userID}:`, err);
    return {
      success: false,
      error: "DB read failed"
    };
  }

  // Get existing connected profiles for idempotency check
  const connectedProfiles = (userItem && userItem.connectedProfiles) || [];

  // IDEMPOTENCY: If this is a connection event and we've already connected with this profile, skip
  if (connectionProfileId && connectedProfiles.includes(connectionProfileId.toLowerCase())) {
    console.log(`User ${userID} already connected with ${connectionProfileId}, skipping (idempotent)`);
    return {
      success: true,
      quests: (userItem && userItem.quests) || {},
      alreadyConnected: true
    };
  }

  const questsMap = (userItem && userItem.quests) || {};

  const nextQuestsMap = Object.values(QUEST_DEFS).reduce((acc, def) => {
    const event = questEvents.find(e => e.questId === def.id);
    const current = acc[def.id];
    const now = timestamp;

    if (!current) {
      const initialized = initStoredQuest(def, now);
      if (!event) {
        return {
          ...acc,
          [def.id]: initialized
        };
      }
    }

    if (!event) return acc;

    const updated = applyQuestEvent(def, current, event, now);

    return {
      ...acc,
      [def.id]: updated
    };
  }, questsMap);

  // Add new connection to the list if this is a connection event
  const nextConnectedProfiles = connectionProfileId
    ? [...connectedProfiles, connectionProfileId.toLowerCase()]
    : connectedProfiles;

  const itemToWrite = {
    id: userID,
    "eventID#year": eventKey,
    quests: nextQuestsMap,
    connectedProfiles: nextConnectedProfiles
  };

  try {
    // Try to create new record if user doesn't exist, or update if they do
    await db.put(itemToWrite, QUESTS_TABLE, !userItem);
    return {
      success: true,
      quests: nextQuestsMap
    };
  } catch (err) {
    // Handle race condition: if we tried to create but it already exists,
    const isConditionalCheckFailed =
      err.code === "ConditionalCheckFailedException" ||
      (err.body && err.body.includes && err.body.includes("ConditionalCheckFailed"));

    if (isConditionalCheckFailed) {
      console.log(`Race condition detected for ${userID}, retrying...`);
      try {
        await db.put(itemToWrite, QUESTS_TABLE, !!userItem);
        return {
          success: true,
          quests: nextQuestsMap
        };
      } catch (retryErr) {
        console.error(`Retry failed for ${userID}:`, retryErr);
        return {
          success: false,
          error: "DB write failed after retry"
        };
      }
    }

    console.error(`Error updating quest progress for ${userID}:`, err);
    return {
      success: false,
      error: "DB write failed"
    };
  }
}

// go through callback and context
export const updateQuest = async (event, ctx, callback) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.event_id ||
      !event.pathParameters.year
    ) {
      console.log(event.pathParameters);
      return helpers.createResponse(400, {
        message: "missing path parameters"
      });
    }

    const { event_id, year } = event.pathParameters;

    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    const body = JSON.parse(event.body);

    try {
      handlerHelpers.checkPayloadProps(body, {
        type: {
          required: true,
          type: "string"
        },
        argument: {
          required: true,
          type: "object"
        }
      });

      if (body.type !== "connection" && body.type !== "company") {
        return handlerHelpers.createResponse(400, {
          message: `Invalid type: '${body.type}'. Valid types: 'connection', 'company'`
        });
      }

      if (body.type === "company" && typeof body.argument !== "string") {
        return handlerHelpers.createResponse(400, {
          message: "For 'company' type, argument must be a company name string"
        });
      }
    } catch (err) {
      return err;
    }

    const timestamp = Date.now();
    const questEvents = parseEvents(body);

    if (!questEvents) {
      return handlerHelpers.createResponse(400, {
        message: "Failed to parse quest event"
      });
    }

    // For connection events, we need the target profileId for idempotency
    const targetProfileId = body.argument && body.argument.profileId;
    const isConnectionEvent = body.type === "connection";

    // For User A, we track User B's profileId to make it idempotent
    const userAResult = await updateUserQuestProgress(
      userID,
      event_id,
      year,
      questEvents,
      timestamp,
      isConnectionEvent ? targetProfileId : null
    );

    if (!userAResult.success) {
      return handlerHelpers.createResponse(500, { message: userAResult.error || "Internal server error" });
    }

    // Handle bi-directional updates for connection events
    // When User A connects with User B, also update User B's quest progress
    const isBidirectional = !(body.argument && body.argument.bidirectional === false); // Default to true

    if (isConnectionEvent && isBidirectional && targetProfileId && !userAResult.alreadyConnected) {
      const userBEmail = await getEmailFromProfileId(targetProfileId);

      if (userBEmail) {
        const userBEmailLower = userBEmail.toLowerCase();

        if (userBEmailLower !== userID) {
          // Look up User A's profileId from their email to track on User B's side for idempotency
          let userAProfileId = null;
          try {
            const userAMember = await db.getOne(userID, MEMBERS2026_TABLE);
            userAProfileId = userAMember && userAMember.profileID;
          } catch (e) {
            console.warn(`Could not get profileId for ${userID}`);
          }

          const userBResult = await updateUserQuestProgress(
            userBEmailLower,
            event_id,
            year,
            questEvents,
            timestamp,
            userAProfileId // Track User A's profileId on User B's record
          );

          if (!userBResult.success) {
            console.error(`Failed to update bi-directional quest for ${targetProfileId} (${userBEmail}): ${userBResult.error}`);
          }
        }
      } else {
        console.warn(`Could not find email for profileId: ${targetProfileId}`);
      }
    }

    return handlerHelpers.createResponse(200, {
      quests: userAResult.quests,
      alreadyConnected: userAResult.alreadyConnected || false
    });
  } catch (err) {
    console.error("Unhandled error in updateQuest:", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error"
    });
  }
};

export const getQuest = async (event, ctx, callback) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.event_id ||
      !event.pathParameters.year
    ) {
      return handlerHelpers.createResponse(400, {
        message: "missing path parameters"
      });
    }

    const { event_id, year } = event.pathParameters;
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();

    let userItem = await db.getOne(userID, QUESTS_TABLE, {
      "eventID#year": `${event_id}#${year}`
    });

    if (userItem) {
      return handlerHelpers.createResponse(200, {
        quests: userItem.quests || {}
      });
    }

    const newQuests = Object.entries(QUEST_DEFS).reduce((acc, [id, def]) => {
      acc[id] = initStoredQuest(def, Date.now());
      return acc;
    }, {});

    try {
      await db.put(
        {
          "id": userID,
          "eventID#year": `${event_id}#${year}`,
          "quests": newQuests
        },
        QUESTS_TABLE,
        true
      );

      return handlerHelpers.createResponse(200, { quests: newQuests });
    } catch (err) {
      if (err.code !== "ConditionalCheckFailedException") {
        console.error(err);
        return handlerHelpers.createResponse(500, {
          message: "Internal server error"
        });
      }
    }

    userItem = await db.getOne(userID, QUESTS_TABLE, { "eventID#year": `${event_id}#${year}` });
    return handlerHelpers.createResponse(200, { quests: (userItem && userItem.quests) || {} });
  } catch (err) {
    console.error(err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error"
    });
  }
};

export const getQuestsByEvent = async (event, ctx, callback) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.event_id ||
      !event.pathParameters.year
    ) {
      return handlerHelpers.createResponse(400, {
        message: "missing path parameters"
      });
    }

    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    if (!userID.endsWith("@ubcbiztech.com")) {
      return handlerHelpers.createResponse(401, { message: "Unauthorized" });
    }

    const { event_id, year } = event.pathParameters;
    const eventKey = `${event_id}#${year}`;

    const items = await db.scan(
      QUESTS_TABLE,
      {
        FilterExpression: "#eventquery = :eventKey",
        ExpressionAttributeNames: {
          "#eventquery": "eventID#year"
        },
        ExpressionAttributeValues: {
          ":eventKey": eventKey
        }
      },
      "event-query"
    );

    const quests = items.map((item) => ({
      userId: item.id,
      quests: item.quests || {}
    }));

    return handlerHelpers.createResponse(200, {
      quests
    });
  } catch (err) {
    console.error(err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error"
    });
  }
};

function looksLikeEmail(s) {
  return typeof s === "string" && s.includes("@") && s.includes(".");
}

async function resolveEmailFromProfileId(profileId) {
  try {
    const results = await db.query(MEMBERS2026_TABLE, "profileID-index", {
      expression: "profileID = :pid",
      expressionValues: {
        ":pid": profileId
      }
    });

    if (results && results.length > 0 && results[0]?.id) {
      return String(results[0].id).toLowerCase();
    }
  } catch (e) {
    // ignore; fallback to scan
  }

  const items = await db.scan(MEMBERS2026_TABLE, {
    FilterExpression: "#pid = :pid",
    ExpressionAttributeNames: {
      "#pid": "profileID"
    },
    ExpressionAttributeValues: {
      ":pid": profileId
    }
  });

  if (items && items.length > 0 && items[0]?.id) {
    return String(items[0].id).toLowerCase();
  }

  return null;
}

export const getQuestKiosk = async (event, ctx, callback) => {
  try {
    const p = event.pathParameters || {};
    const event_id = p.event_id;
    const year = p.year;
    const profileId = p.profileId;

    if (!event_id || !year || !profileId) {
      return handlerHelpers.createResponse(400, {
        message: "missing path parameters"
      });
    }

    const eventKey = `${event_id}#${year}`;

    const email = await resolveEmailFromProfileId(profileId);

    if (email) {
      const byEmail = await db.getOne(email, QUESTS_TABLE, {
        "eventID#year": eventKey
      });
      if (byEmail?.quests) {
        return handlerHelpers.createResponse(200, {
          quests: byEmail.quests || {},
          resolvedUser: "email",
          resolvedEmail: email
        });
      }
    }

    const byProfileId = await db.getOne(profileId, QUESTS_TABLE, {
      "eventID#year": eventKey
    });
    if (byProfileId?.quests) {
      return handlerHelpers.createResponse(200, {
        quests: byProfileId.quests || {},
        resolvedUser: "profileId"
      });
    }

    const newQuests = Object.entries(QUEST_DEFS).reduce((acc, [id, def]) => {
      acc[id] = initStoredQuest(def, Date.now());
      return acc;
    }, {});

    await db.put(
      {
        "id": email || profileId,
        "eventID#year": eventKey,
        "quests": newQuests
      },
      QUESTS_TABLE,
      true
    );

    return handlerHelpers.createResponse(200, {
      quests: newQuests,
      resolvedUser: email ? "initialized-email" : "initialized-profileId"
    });
  } catch (err) {
    console.error("getQuestKiosk error:", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error"
    });
  }
};
