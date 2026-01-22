/**
 * Quest IDs (keys used inside item.quests[questId] where item is the nest)
 */
export const QUEST_IDS = {
	NEW_CONNECTIONS_5: "new_connections_5",
	NEW_CONNECTIONS_10: "new_connections_10",
	NEW_CONNECTIONS_20: "new_connections_20",
	RECOMMENDED_CONNECTIONS: "recommended_connections",
	UNIQUE_COMPANIES_TALKED_TO: "unique_companies_talked_to",
};

/**
 * Quest Types (controls how progress increments)
 */
export const QUEST_TYPES = {
	COUNTER: "COUNTER",
	UNIQUE_SET: "UNIQUE_SET", // to track the companies 
};

/**
 * Event types accepted by progress endpoint
 */
export const QUEST_EVENT_TYPES = {
	NEW_CONNECTION: "NEW_CONNECTION",
	RECOMMENDED_CONNECTION: "RECOMMENDED_CONNECTION",
	COMPANY_TALK: "COMPANY_TALK",
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
		target: 6,
		description: "Talk to unique companies",
		eventType: QUEST_EVENT_TYPES.COMPANY_TALK,
		valueKey: "company",
	},
};


