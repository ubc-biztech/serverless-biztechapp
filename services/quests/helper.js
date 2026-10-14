import { QUEST_IDS, QUEST_DEFS, QUEST_TYPES, QUEST_EVENT_TYPES } from "./constants.js";
/**
 * shape of initialized quest
 * def is the defined quest object from QUEST_DEFS
 */

export function initStoredQuest(def, now) {
  return {
    progress: 0,
    target: def.target !== undefined ? def.target : null,
    startedAt: now,
    completedAt: null,
    description: def.description,
  };
}

export function parseEvents(body) {
  switch (body.type) {
  case "connection": {
    return [{
      questId: QUEST_IDS.NEW_CONNECTIONS_5,
      questType: QUEST_TYPES.COUNTER,
      eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
      eventParam: {},
      count: 1,
    }, {
      questId: QUEST_IDS.NEW_CONNECTIONS_10,
      questType: QUEST_TYPES.COUNTER,
      eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
      eventParam: {},
      count: 1,
    }, {
      questId: QUEST_IDS.NEW_CONNECTIONS_20,
      questType: QUEST_TYPES.COUNTER,
      eventType: QUEST_EVENT_TYPES.NEW_CONNECTION,
      eventParam: {},
      count: 1,
    }];
  }

  default:
    return null;
  }
}
/**
 * Apply an event to the stored quest object and return updated stored object.
 */
export function applyQuestEvent(def, currentStored, event, now) {
  const state = currentStored || initStoredQuest(def, now); // initialize the stored quest if not already
  if (event.eventType !== def.eventType) return state;

  // if the state of the event is completed
  if (state.completedAt) return state;

  // COUNTER QUEST
  const increment = event.count || 1;
  const next = Math.min(state.progress + increment, typeof state.target === "number" ? state.target : Infinity);
  const completed = typeof state.target === "number" && next >= state.target;

  return {
    ...state,
    progress: next,
    completedAt: completed ? (state.completedAt || now) : null,
  };
}

export function getQuestDef(questId) {
  return QUEST_DEFS[questId] || null;
}
