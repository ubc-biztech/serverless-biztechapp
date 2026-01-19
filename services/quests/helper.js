import { QUEST_DEFS, QUEST_TYPES } from "./constants.js";
/**
 * shape of initialized quest 
 * def is the defined quest object from QUEST_DEFS
 */

function initStoredQuest(def, now) {
  const base = {
    progress: 0,
    target: def.target ?? null,
    startedAt: now,
    completedAt: null,
    description: def.description,
  };

  // UNIQUE_SET needs a backing list to avoid double-counting
  if (def.type === QUEST_TYPES.UNIQUE_SET) {
    return { ...base, items: [] };
  }

  return base;
}

/**
 
 */

/**
 * Apply an event to the stored quest object and return updated stored object.
 */
function applyQuestEvent(def, currentStored, event, now) {
  const state = currentStored || initStoredQuest(def, now); // initialize the stored quest if not already 
  if (event.eventType !== def.eventType) return state;

  // if the state of the event is completed 
  if (state.completedAt) return state;

  // IF COUNTER QUEST 
  if (def.type === QUEST_TYPES.COUNTER) {
    const next = Math.min(state.progress + 1, state.target ?? Infinity);
    const completed = typeof state.target === "number" && next >= state.target; // don't increment if past target

    return {
    ...state,
    progress: next,
    completedAt: completed ? (state.completedAt ?? now) : null,
    };
}


  // IF UNIQUE VALUE (COMPANY)
  const raw = event.eventParam && event.eventParam[def.valueKey];
  if (typeof raw !== "string" || !raw.trim()) return state;

  const value = raw.trim();
  const items = Array.isArray(state.items) ? state.items : [];

  const exists = items.some((x) => String(x).toLowerCase() === value.toLowerCase());
  const nextItems = exists ? items : [...items, value];
  const next = nextItems.length;

  const completed =
    typeof state.target === "number" ? next >= state.target : false;

  return {
    ...state,
    items: nextItems,
    progress: next,
    completedAt: completed ? now : null,
  };
}

function getQuestDef(questId) {
  return QUEST_DEFS[questId] || null;
}



