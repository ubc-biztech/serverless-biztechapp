/**
 * Quest Types
 */
const QUEST_TYPES = {
    // different quest types definitions for how progress is tracked per quest
  COUNTER: "COUNTER",       // simple count-based quests
  UNIQUE_SET: "UNIQUE_SET", // track unique values for companies for the company talk 
};

/**
 * Update the quest progress 
 */
const QUEST_EVENT_TYPES = {
  RECOMMENDED_CONNECTION: "RECOMMENDED_CONNECTION",
  NEW_CONNECTION: "NEW_CONNECTION", // update for each of the new connections made (target for each set) 
  COMPANY_TALK: "COMPANY_TALK", // unique companies    
};



/**
 * Quest IDs (single source of truth) 
 */
const QUEST_IDS = {
  RECOMMENDED_CONNECTIONS: "recommended_connections",
  NEW_CONNECTIONS_5: "new_connections_5",
  NEW_CONNECTIONS_10: "new_connections_10",
  NEW_CONNECTIONS_20: "new_connections_20",
  UNIQUE_COMPANIES_TALKED_TO: "unique_companies_talked_to",
};


/*
 */
const QUESTS = {
  [QUEST_IDS.RECOMMENDED_CONNECTIONS]: {
    id: QUEST_IDS.RECOMMENDED_CONNECTIONS,
    name: "Recommended Connections",
    type: QUEST_TYPES.COUNTER,
    params: {
      // target: verify the target value to update for progress for each quest type 
      eventType: QUEST_EVENT_TYPES.RECOMMENDED_CONNECTION,
    },
  },

  [QUEST_IDS.NEW_CONNECTIONS_5]: {
    id: QUEST_IDS.NEW_CONNECTIONS_5,
    name: "New Connections Made (5)",
    type: QUEST_TYPES.COUNTER,
    params: {
      target: 5,
      eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
    },
  },

  [QUEST_IDS.NEW_CONNECTIONS_10]: {
    id: QUEST_IDS.NEW_CONNECTIONS_10,
    name: "New Connections Made (10)",
    type: QUEST_TYPES.COUNTER,
    params: {
      target: 10,
      eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
    },
  },

  [QUEST_IDS.NEW_CONNECTIONS_20]: {
    id: QUEST_IDS.NEW_CONNECTIONS_20,
    name: "New Connections Made (20)",
    type: QUEST_TYPES.COUNTER,
    params: {
      target: 20,
      eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
    },
  },

  [QUEST_IDS.UNIQUE_COMPANIES_TALKED_TO]: {
    id: QUEST_IDS.UNIQUE_COMPANIES_TALKED_TO,
    name: "Companies You Talked To",
    type: QUEST_TYPES.UNIQUE_SET,
    params: {
      eventType: QUEST_EVENT_TYPES.COMPANY_TALK,
      valueKey: "company",
    },
  },
};

/**
 * Initialize a progress api for the quest (the initial target value)
 */
function initProgress(quest, now) {
    // target type based on quest and type

  if (quest.type === QUEST_TYPES.COUNTER) {
    return {
      status: "NOT_STARTED",
      count: 0,
      target: quest.params.target,
      updatedAt: now,
    };
  }

  else if (quest.type === QUEST_TYPES.UNIQUE_SET) {
    return {
      status: "NOT_STARTED",
      items: [],
      count: 0,
      target: quest.params.target,
      updatedAt: now,
    };
  }

  return {
    status: "NOT_STARTED",
    items: [],
    count: 0,
    target: quest.params.target,
    updatedAt: now,
  };
}

/**
 * Apply an event to quest progress 
 */
function applyQuestEvent({ quest, current, event, now }) {
  const state = current || initProgress(quest, now);
  if (quest.params.eventType !== event.eventType) {
    return state;
  }

  if (quest.type === QUEST_TYPES.COUNTER) {
    const nextCount = state.count + 1;
    const completed = nextCount >= quest.params.target;

    return {
      status: completed ? "COMPLETED" : "IN_PROGRESS",
      count: nextCount,
      target: quest.params.target,
      updatedAt: now,
    };
  }

  const value = event.eventPayload && event.eventPayload[quest.params.valueKey];
  if (typeof value !== "string") return state;

  const normalized = value.trim().toLowerCase();
  const exists = state.items.some(
    (v) => v.toLowerCase() === normalized
  );

  const nextItems = exists ? state.items : [...state.items, value.trim()];
  const nextCount = nextItems.length;

  const target = quest.params.target;
  const completed =
    typeof target === "number" ? nextCount >= target : false;

  return {
    status: completed ? "COMPLETED" : "IN_PROGRESS",
    items: nextItems,
    count: nextCount,
    target,
    updatedAt: now,
  };
}


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

