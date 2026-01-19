import { QUESTS_TABLE } from "../../constants/tables";
import db from "../../lib/db";
import { QUEST_IDS, QUEST_TYPES, QUEST_EVENT_TYPES, QUESTS} from "./constants";
import {applyQuestEvent} from "./helper.js";
import handlerHelpers from "../../lib/handlerHelpers";
import helpers from "../../lib/handlerHelpers";

// go through callback and context 
export const handleQuestEvent = async (event, ctx, callback) => {

try {

  const userID = event.requestContext.authorizer.claims.email.toLowerCase();
  const body = JSON.parse(event.body); // make json first 
  try {
  helpers.checkPayloadProps(body, {
  eventType: {
    required: true
  },
  eventParam: {
    required: true
  }
  });
  } catch (error) {
  callback(null, error);
  return null;
  }
  const timestamp = Date.now();
  const questEvents = parseEvents(body); // convert json parsed body  to quest event for different cases 

  if (!questEvents) {
    callback(
      null,
      handlerHelpers.createResponse(400, { message: "Quest event argument not found" })
    );
    return null;
  }

  let userItem;
  try {
    userItem = await db.getOne(userID, QUESTS_TABLE);
  } catch (err) {
    console.error("Could not read user data:", err);
    callback(null, handlerHelpers.createResponse(500, { message: "DB read failed" }));
    return null;
  }

  
  // replace the for loop with a map operation! 
  // add try catch for db operations

  const questsMap = userItem?.quests || {};
  // pull the quests map from the userItem 

  // pull the quests by their event types (in case multiple quests need to be updated by one event)
  const eventsByType = questEvents.reduce((m, e) => {
    (m[e.eventType] ??= []).push(e);
    return m;
  }, {});

  const nextQuestsMap = Object.values(QUEST_DEFS).reduce((acc, def) => {
    const events = eventsByType[def.eventType];
    if (!events?.length) return acc;

    const current = acc[def.id];

    // changed applyQuestEvent to cap progress at target for counter quests
    const updated = events.reduce( // no need for update check)
      (state, e) => applyQuestEvent(def, state, e, timestamp),
      current
    );

      return { ...acc, [def.id]: updated };
    }, questsMap);
  


    try {
      await db.put(
        userID,
        { ...(userItem || { id: userID }), quests: nextQuestsMap },
        QUESTS_TABLE
      );
    } catch (err) {
      console.error("Error updating quest progress:", err);
      callback(null, handlerHelpers.createResponse(500, { message: "DB write failed" }));
      return null;
    }

    callback(
      null,
      handlerHelpers.createResponse(200, {
        message: "Quest progress updated",
        quests: nextQuestsMap,
      })
    );

    return null;

  } catch (err) {
    console.error("Unhandled error in handleQuestEvent:", err);
    callback(null, handlerHelpers.createResponse(500, { message: "Internal server error" }));
    return null;
  }
};

export const getQuest = async (event, ctx, callback) => {
  try {
    if (
      !event.pathParameters ||
			!event.pathParameters.id ||
			typeof event.pathParameters.id !== "string"
    )
    throw helpers.missingIdQueryResponse("profile ID in request path"); // double check from teh helpers

  const questID = event.pathParameters.id;
  const userID = event.requestContext.authorizer.claims.email.toLowerCase();
  const memberData = await db.getOne(userID, QUESTS_TABLE);

  if (!memberData || !memberData.quests || !memberData.quests[questID]) {
    return helpers.notFoundResponse("quest", questID);
  }

  if (!memberData)
    return helpers.createResponse(200, {
      message: `No profile associated with ${userID}`,
      connected: false
    });

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Get quest endpoint" }),
  };


  } catch (err) {
    console.error(err);
    callback(
      null,
      handlerHelpers.createResponse(500, {
        message: "Internal server error",
      })
    );
  }

  return null;
}


function parseEvents(body) {
  switch (body.type) {
    case "company":
      return [{
        questId: QUEST_IDS.UNIQUE_COMPANIES_TALKED_TO,
        questType: QUEST_TYPES.UNIQUE_SET,
        eventType: QUEST_EVENT_TYPES.COMPANY_TALK,
        eventParam: { company: body.argument }, 
      }];

    case "connection": {
      // flag for the recommended connection to tell whether to count it or not
      const isRecommended = !!body.argument?.recommended;

      // regardless of recommendation, counts toward the connection 5 / 10 / 20 quests
      const events = [
        {
          questId: QUEST_IDS.NEW_CONNECTIONS_5,
          questType: QUEST_TYPES.COUNTER,
          eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
          eventParam: {},
        },
        {
          questId: QUEST_IDS.NEW_CONNECTIONS_10,
          questType: QUEST_TYPES.COUNTER,
          eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
          eventParam: {},
        },
        {
          questId: QUEST_IDS.NEW_CONNECTIONS_20,
          questType: QUEST_TYPES.COUNTER,
          eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
          eventParam: {},
        },
      ];

      if (isRecommended) {
        events.push({
          questId: QUEST_IDS.RECOMMENDED_CONNECTIONS,
          questType: QUEST_TYPES.COUNTER,
          eventType: QUEST_EVENT_TYPES.RECOMMENDED_CONNECTION,
          eventParam: {},
        });
      }

      return events;
    }

    default:
      return null;
  }
}


export const getAllQuests = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();

    const userItem = await db.getOne(userID, QUESTS_TABLE);
    const questsMap = userItem?.quests || {};

    const data = Object.values(QUESTS).map((q) => {
      const stored = questsMap[q.id];

      // don't reinitialize! just read either the base case or the null case)
      return {
        quest: q,

        progress: stored ?? { 
          progress: 0,
          target: q.target ?? null,
          startedAt: null,
          completedAt: null,
          description: q.description,
        },
      };
    });

    callback(
      null,
      handlerHelpers.createResponse(200, {
        message: `all quests for ${userID}`,
        data,
      })
    );
  } catch (err) {
    console.error(err);
    callback(
      null,
      handlerHelpers.createResponse(500, {
        message: "Internal server error",
      })
    );
  }

  return null;
};

