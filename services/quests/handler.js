import { QUESTS_TABLE } from "../../constants/tables";
import db from "../../lib/db";
import { QUEST_DEFS, QUEST_TYPES } from "./constants";
import { applyQuestEvent, parseEvents } from "./helper.js";
import handlerHelpers from "../../lib/handlerHelpers";
import helpers from "../../lib/handlerHelpers";

// go through callback and context 
export const updateQuest = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.event_id || !event.pathParameters.year) {
      console.log(event.pathParameters);
      return helpers.createResponse(400, { message: "missing path parameters" });
    }

    const { event_id, year } = event.pathParameters;

    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    const body = JSON.parse(event.body);

    // Validate input
    if (!body.type) {
      return handlerHelpers.createResponse(400, { message: "Missing required field: type. Valid types: 'connection', 'company'" });
    }
    if (!body.argument) {
      return handlerHelpers.createResponse(400, { message: "Missing required field: argument" });
    }
    if (body.type !== "connection" && body.type !== "company") {
      return handlerHelpers.createResponse(400, { message: `Invalid type: '${body.type}'. Valid types: 'connection', 'company'` });
    }
    if (body.type === "company" && typeof body.argument !== "string") {
      return handlerHelpers.createResponse(400, { message: "For 'company' type, argument must be a company name string" });
    }

    const timestamp = Date.now();
    const questEvents = parseEvents(body);

    if (!questEvents) {
      return handlerHelpers.createResponse(400, { message: "Failed to parse quest event" });
    }

    let userItem;
    try {
      userItem = await db.getOne(userID, QUESTS_TABLE, { "eventID#year": `${event_id}#${year}` });
    } catch (err) {
      console.error("Could not read user data:", err);
      return handlerHelpers.createResponse(500, { message: "DB read failed" });
    }

    const questsMap = userItem?.quests || {};
    const eventsByType = questEvents.reduce((m, e) => {
      (m[e.eventType] ??= []).push(e);
      return m;
    }, {});

    const nextQuestsMap = Object.values(QUEST_DEFS).reduce((acc, def) => {
      const events = eventsByType[def.eventType];
      const current = acc[def.id];
      const now = timestamp;

      if (!current) {
        const initialized = {
          progress: 0,
          target: def.target ?? null,
          startedAt: now,
          completedAt: null,
          description: def.description,
        };

        if (def.type === QUEST_TYPES.UNIQUE_SET) {
          initialized.items = [];
        }

        if (!events?.length) {
          return {
            ...acc,
            [def.id]: initialized
          };
        }
      }

      if (!events?.length) return acc;

      const updated = events.reduce(
        (state, e) => applyQuestEvent(def, state, e, now),
        current
      );

      return {
        ...acc,
        [def.id]: updated
      };
    }, questsMap);

    try {
      await db.put(
        {
          "eventID#year": `${event_id}#${year}`,
          ...(userItem || { id: userID }),
          quests: nextQuestsMap
        },
        QUESTS_TABLE,
        !userItem
      );
    } catch (err) {
      console.error("Error updating quest progress:", err);
      return handlerHelpers.createResponse(500, { message: "Internal server error" });
    }

    return handlerHelpers.createResponse(200, {
      quests: nextQuestsMap,
    });
  } catch (err) {
    console.error("Unhandled error in updateQuest:", err);
    return handlerHelpers.createResponse(500, { message: "Internal server error" });
  }
};

export const getQuest = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.event_id || !event.pathParameters.year) {
      return handlerHelpers.createResponse(400, { message: "missing path parameters" });
    }

    const { event_id, year } = event.pathParameters;
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();

    const userItem = await db.getOne(userID, QUESTS_TABLE, { "eventID#year": `${event_id}#${year}` });

    if (!userItem) {
      return handlerHelpers.createResponse(200, {
        quests: {},
      });
    }

    return handlerHelpers.createResponse(200, {
      quests: userItem.quests || {},
    });
  } catch (err) {
    console.error(err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error",
    });
  }
};

export const getQuestsByEvent = async (event, ctx, callback) => {
  try {
    if (!event.pathParameters || !event.pathParameters.event_id || !event.pathParameters.year) {
      return handlerHelpers.createResponse(400, { message: "missing path parameters" });
    }

    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    if (!userID.endsWith("@ubcbiztech.com")) {
      return handlerHelpers.createResponse(401, { message: "Unauthorized" });
    }

    const { event_id, year } = event.pathParameters;
    const eventKey = `${event_id}#${year}`;

    const items = await db.scan(QUESTS_TABLE, {
      FilterExpression: "#eventquery = :eventKey",
      ExpressionAttributeNames: {
        "#eventquery": "eventID#year"
      },
      ExpressionAttributeValues: {
        ":eventKey": eventKey
      }
    }, "event-query");

    const quests = items.map(item => ({
      userId: item.id,
      quests: item.quests || {}
    }));

    return handlerHelpers.createResponse(200, {
      quests,
    });
  } catch (err) {
    console.error(err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error",
    });
  }
};


