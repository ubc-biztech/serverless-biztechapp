/**
 * Quest IDs (keys used inside item.quests[questId] where item is the nest)
 */
const QUEST_IDS = {
  NEW_CONNECTIONS_5: "new_connections_5",
  NEW_CONNECTIONS_10: "new_connections_10",
  NEW_CONNECTIONS_20: "new_connections_20",
  RECOMMENDED_CONNECTIONS: "recommended_connections",
  UNIQUE_COMPANIES_TALKED_TO: "unique_companies_talked_to",
};

/**
 * Quest Types (controls how progress increments)
 */
const QUEST_TYPES = {
  COUNTER: "COUNTER",
  UNIQUE_SET: "UNIQUE_SET", // to track the companies 
};

/**
 * Event types accepted by progress endpoint
 */
const QUEST_EVENT_TYPES = {
  NEW_CONNECTION: "NEW_CONNECTION",
  RECOMMENDED_CONNECTION: "RECOMMENDED_CONNECTION",
  COMPANY_TALK: "COMPANY_TALK",
};

/**
 */
const QUEST_DEFS = {
  [QUEST_IDS.NEW_CONNECTIONS_5]: {
    id: QUEST_IDS.NEW_CONNECTIONS_5,
    type: QUEST_TYPES.COUNTER,
    target: 5,
    description: "Make 5 new connections",
    eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
  },

  [QUEST_IDS.NEW_CONNECTIONS_10]: {
    id: QUEST_IDS.NEW_CONNECTIONS_10,
    type: QUEST_TYPES.COUNTER,
    target: 10,
    description: "Make 10 new connections",
    eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
  },

  [QUEST_IDS.NEW_CONNECTIONS_20]: {
    id: QUEST_IDS.NEW_CONNECTIONS_20,
    type: QUEST_TYPES.COUNTER,
    target: 20,
    description: "Make 20 new connections",
    eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
  },

  [QUEST_IDS.RECOMMENDED_CONNECTIONS]: {
    id: QUEST_IDS.RECOMMENDED_CONNECTIONS,
    type: QUEST_TYPES.COUNTER,
    target: 3, // what is the number of recommended connections 
    description: "Connect with 3 recommended people",
    eventType: QUEST_EVENT_TYPES.RECOMMENDED_CONNECTION,
  },

  [QUEST_IDS.UNIQUE_COMPANIES_TALKED_TO]: {
    id: QUEST_IDS.UNIQUE_COMPANIES_TALKED_TO,
    type: QUEST_TYPES.UNIQUE_SET,
    //` what is the target 
    target: null,
    description: "Talk to unique companies",
    eventType: QUEST_EVENT_TYPES.COMPANY_TALK,
    valueKey: "company", 
  },
};

module.exports = {
  QUEST_IDS,
  QUEST_TYPES,
  QUEST_EVENT_TYPES,
  QUEST_DEFS,
  getQuestDef,
  initStoredQuest,
  applyQuestEvent,
};

/*

quests: (example) {
  // key = quest id
  new_connections_5: {
    status: "IN_PROGRESS",
    count: 3,
    target: 5,
    updatedAt: 1736880000000 // time data type 
  },

  unique_companies_talked_to: {
    status: "IN_PROGRESS",
    items: ["Microsoft", "Google"],
    count: 2,
    target: 10,
    updatedAt: 1736880000000
  }
}

Why this matches your code

In getAllQuests you already do:

const questsMap = userItem?.quests || {};

for each quest definition q:

questsMap[q.id] gives you the saved progress

otherwise you call initProgress(q)

So the “single source of truth” is:

Quest definitions = your QUESTS constants

Quest progress = DynamoDB quests[questId]




ALLOCATION SUMMARY FOR THE QUESTS SERVICE

serverless.yml

 PK: user_email

 SK: eventID_year

 Add eventID if you want GSI

 PATCH + GET routes exist

 IAM has UpdateItem/GetItem/PutItem

constants.js

 QUESTS dict exists

 QUEST_TYPES exists

 applyQuestEvent exists

 initProgress exists

handler.js

 derive user_email from token

 derive eventID_year from path params

 read current item

 call applyQuestEvent

 write quests.<questId>

*/

