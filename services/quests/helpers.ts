import { QUEST_IDS, QUEST_DEFS, QUEST_TYPES, QUEST_EVENT_TYPES } from "./constants";

/**
 * BUG (pre-existing, preserved): this module is a stale duplicate of `helper.ts`
 * and is not imported anywhere — `handler.ts` uses `./helper`. It also reads
 * constants that do not exist in `./constants` (QUEST_TYPES.UNIQUE_SET,
 * QUEST_IDS.UNIQUE_COMPANIES_TALKED_TO, QUEST_EVENT_TYPES.COMPANY_TALK,
 * QUEST_IDS.RECOMMENDED_CONNECTIONS, QUEST_EVENT_TYPES.RECOMMENDED_CONNECTION),
 * so those reads evaluate to `undefined` at runtime. The `Record<string, string>`
 * casts below exist only to preserve that behaviour verbatim under TypeScript.
 */

export interface QuestDef {
  id: string;
  type: string;
  target?: number;
  description: string;
  eventType: string;
  valueKey?: string;
}

export interface StoredQuest {
  progress: number;
  target: number | null;
  startedAt: number;
  completedAt: number | null;
  description: string;
  items?: string[];
}

export interface QuestEvent {
  questId: string;
  questType: string;
  eventType: string;
  eventParam: Record<string, unknown>;
  count?: number;
}

/**
 * shape of initialized quest 
 * def is the defined quest object from QUEST_DEFS
 */

export function initStoredQuest(def: QuestDef, now: number): StoredQuest {
  const base: StoredQuest = {
    progress: 0,
    target: def.target !== undefined ? def.target : null,
    startedAt: now,
    completedAt: null,
    description: def.description,
  };

  // UNIQUE_SET needs a backing list to avoid double-counting
  if (def.type === (QUEST_TYPES as Record<string, string>).UNIQUE_SET) {
    return {
      ...base,
      items: []
    };
  }

  return base;
}

export function parseEvents(body: Record<string, unknown>): QuestEvent[] | null {
  switch (body.type) {
  case "company":
    return [{
      questId: (QUEST_IDS as Record<string, string>).UNIQUE_COMPANIES_TALKED_TO,
      questType: (QUEST_TYPES as Record<string, string>).UNIQUE_SET,
      eventType: (QUEST_EVENT_TYPES as Record<string, string>).COMPANY_TALK,
      eventParam: { company: body.argument },
    }];

  case "connection": {
    const isRecommended = !!(body.argument && (body.argument as { recommended?: unknown }).recommended);

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
    }, ...(isRecommended ? [{
      questId: (QUEST_IDS as Record<string, string>).RECOMMENDED_CONNECTIONS,
      questType: QUEST_TYPES.COUNTER,
      eventType: (QUEST_EVENT_TYPES as Record<string, string>).RECOMMENDED_CONNECTION,
      eventParam: {},
      count: 1,
    }] : [])];
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

  // IF COUNTER QUEST 
  if (def.type === QUEST_TYPES.COUNTER) {
    const increment = event.count || 1;
    const next = Math.min(state.progress + increment, typeof state.target === "number" ? state.target : Infinity);
    const completed = typeof state.target === "number" && next >= state.target;

    return {
      ...state,
      progress: next,
      completedAt: completed ? (state.completedAt || now) : null,
    };
  }

  const raw = event.eventParam && event.eventParam[def.valueKey as string];
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

export function getQuestDef(questId: string): QuestDef | null {
  return QUEST_DEFS[questId] || null;
}
