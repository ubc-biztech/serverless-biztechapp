/**
 * Quest IDs (keys used inside item.quests[questId] where item is the nest)
 */
export const QUEST_IDS = {
  NEW_CONNECTIONS_5: "new_connections_5",
  NEW_CONNECTIONS_10: "new_connections_10",
  NEW_CONNECTIONS_20: "new_connections_20",
};

/**
 * Quest Types (controls how progress increments)
 */
export const QUEST_TYPES = {
  COUNTER: "COUNTER",
};

/**
 * Event types accepted by progress endpoint
 */
export const QUEST_EVENT_TYPES = {
  NEW_CONNECTION: "NEW_CONNECTION",
};

export const QUEST_DEFS = {
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
};


