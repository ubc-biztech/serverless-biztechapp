import { QUESTS_TABLE } from "../../constants/tables";
import db from "../../lib/db";
import { QUEST_IDS, QUEST_TYPES, QUEST_EVENT_TYPES, QUESTS, applyQuestEvent } from "./constants";
import handlerHelpers from "../../lib/handlerHelpers";
import helpers from "../../lib/handlerHelpers";

// Handler functions will be implemented here
export const updateQuest = async (event, ctx, callback) => {
  // TODO: Implement quest progress update logic
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Update quest endpoint" }),
  };

  // APPLY QUEST EVENT HERE for the incrementation of the target based on the quest id 
  // smoke testing 
  applyQuestEvent({
    questId: body.questId,
    questType: body.questType,
    eventType: body.eventType,
    eventPayload: body.eventParam
  });

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


function toQuestEvent(body) {
  switch (body.type) {
    case "company":
      return {
        questId: QUEST_IDS.UNIQUE_COMPANIES_TALKED_TO,
        questType: QUEST_TYPES.UNIQUE_SET,
        eventType: QUEST_EVENT_TYPES.COMPANY_TALK,
        eventPayload: { company: body.argument },
      };

    case "connection": {
      // flag for the recommended connection to tell whether to count it or not
      const isRecommended = !!body.argument?.recommended;

      // regardless of recommendation, counts toward the connection (5/10/20)
      const events = [
        {
          questId: QUEST_IDS.NEW_CONNECTIONS_5,
          questType: QUEST_TYPES.COUNTER,
          eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
          eventPayload: {},
        },
        {
          questId: QUEST_IDS.NEW_CONNECTIONS_10,
          questType: QUEST_TYPES.COUNTER,
          eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
          eventPayload: {},
        },
        {
          questId: QUEST_IDS.NEW_CONNECTIONS_20,
          questType: QUEST_TYPES.COUNTER,
          eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
          eventPayload: {},
        },
      ];

      if (isRecommended) {
        events.push({
          questId: QUEST_IDS.RECOMMENDED_CONNECTIONS,
          questType: QUEST_TYPES.COUNTER,
          eventType: QUEST_EVENT_TYPES.RECOMMENDED_CONNECTION,
          eventPayload: {},
        });
      }

      return events;
    }

    default:
      return null;
  }
}


export const getAllQuest = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    const timestamp = new Date().getTime();

    // Fetch user quest progress item from DB
    const userItem = await db.getOne(userID, QUESTS_TABLE);
    const questsMap = userItem?.quests || {};

    // Build quiz map for the user 
    const data = Object.values(QUESTS).map((q) => ({
      quest: q,
      progress: questsMap[q.id] || initProgress(q, timestamp),
    }));

    const response = handlerHelpers.createResponse(200, {
      message: `all quests for ${userID}`,
      data,
    });

    callback(null, response);
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

/*
Example quest 
questID should be in a dict mapped to the progress object

{
  "questId": "unique_companies_talked_to",
  "questType": "UNIQUE_SET",
  "eventType": "COMPANY_TALK",
  "eventParam": { "company": "Microsoft" }
}

{
  "questId": "new_connections_5",
  "questType": "COUNTER",
  "eventType": "NEW_CONNECTION",
  "eventParam": {}
}

{
  "recommended_connections" : {
  
  }
}


NOTES: DICT FOR THE PROGRESS OBJECT AND THE KEY IS THE QUEST ID, THE VALUE WILL BE THE STATE TO UPDATE iN THE PROGRESS OBJECT 
- COUNTER OR UNIQUE_SET


USE THE HANDLERHELPERS AND UPDATE
UPDATE THE SCHEMA VIA THE YML. USING USER ID 


is connection based on the interactions and what is referenced there?


*/