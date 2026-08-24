import { QUEST_IDS, QUEST_DEFS, QUEST_TYPES, QUEST_EVENT_TYPES } from "./constants";

export interface QuestDef {
  id: string;
  type: string;
  target?: number;
  description: string;
  eventType: string;
}

export interface StoredQuest {
  progress: number;
  target: number | null;
  startedAt: number;
  completedAt: number | null;
  description: string;
}

export interface QuestEvent {
  questId: string;
  questType: string;
  eventType: string;
  eventParam: Record<string, unknown>;
  count: number;
}

/**
 * shape of initialized quest
 * def is the defined quest object from QUEST_DEFS
 */

export function initStoredQuest(def: QuestDef, now: number): StoredQuest {
  return {
    progress: 0,
    target: def.target !== undefined ? def.target : null,
    startedAt: now,
    completedAt: null,
    description: def.description,
  };
}

export function parseEvents(body: Record<string, unknown>): QuestEvent[] | null {
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
export function applyQuestEvent(
  def: QuestDef,
  currentStored: StoredQuest | Record<string, unknown> | undefined,
  event: QuestEvent,
  now: number,
): StoredQuest {
  const state = (currentStored || initStoredQuest(def, now)) as StoredQuest; // initialize the stored quest if not already
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

export function getQuestDef(questId: string): QuestDef | null {
  return QUEST_DEFS[questId] || null;
}
