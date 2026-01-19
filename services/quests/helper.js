import { QUEST_IDS, QUEST_DEFS, QUEST_TYPES, QUEST_EVENT_TYPES } from "./constants.js";
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

export function parseEvents(body) {
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
/**
 * Apply an event to the stored quest object and return updated stored object.
 */
export function applyQuestEvent(def, currentStored, event, now) {
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

export function getQuestDef(questId) {
	return QUEST_DEFS[questId] || null;
}
