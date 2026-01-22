import { QUESTS_TABLE } from "../../constants/tables";
import db from "../../lib/db";
import { QUESTS, QUEST_DEFS, QUEST_TYPES } from "./constants";
import { applyQuestEvent, parseEvents } from "./helper.js";
import handlerHelpers from "../../lib/handlerHelpers";
import helpers from "../../lib/handlerHelpers";

// go through callback and context 
export const updateQuest = async (event, ctx, callback) => {
	try {
		if (!event.pathParameters || !event.pathParameters.event_id || !event.pathParameters.year) {
			console.log(event.pathParameters)
			return helpers.createResponse(400, { message: "missing path parameters" })
		}

		const { event_id, year } = event.pathParameters;

		const userID = event.requestContext.authorizer.claims.email.toLowerCase();
		const body = JSON.parse(event.body); // make json first 
		try {
			helpers.checkPayloadProps(body, {
				type: {
					required: true
				},
				argument: {
					required: true
				}
			});
		} catch (error) {
			callback(null, error);
			return null;
		}
		const timestamp = Date.now();
		const questEvents = parseEvents(body); // convert json parsed body  to quest event for different cases 

		if (!questEvents) {
			callback(
				null,
				handlerHelpers.createResponse(400, { message: "Quest event argument not found" })
			);
			return null;
		}

		let userItem;
		try {
			userItem = await db.getOne(userID, QUESTS_TABLE, { "eventID#year": `${event_id}#${year}` });
		} catch (err) {
			console.error("Could not read user data:", err);
			callback(null, handlerHelpers.createResponse(500, { message: "DB read failed" }));
			return null;
		}

		const questsMap = userItem?.quests || {};
		// pull the quests by their event types (in case multiple quests need to be updated by one event)
		const eventsByType = questEvents.reduce((m, e) => {
			(m[e.eventType] ??= []).push(e);
			return m;
		}, {});

		const nextQuestsMap = Object.values(QUEST_DEFS).reduce((acc, def) => {
			const events = eventsByType[def.eventType];
			const current = acc[def.id];
			const now = timestamp;

			// Initialize quest if not exists
			if (!current) {
				const initialized = {
					progress: 0,
					target: def.target ?? null,
					startedAt: now,
					completedAt: null,
					description: def.description,
				};

				// UNIQUE_SET needs items array
				if (def.type === QUEST_TYPES.UNIQUE_SET) {
					initialized.items = [];
				}

				if (!events?.length) {
					return { ...acc, [def.id]: initialized };
				}
			}

			if (!events?.length) return acc;

			// Apply events to the quest
			const updated = events.reduce(
				(state, e) => applyQuestEvent(def, state, e, timestamp),
				current
			);

			return { ...acc, [def.id]: updated };
		}, questsMap);

		try {
			await db.put(
				{ "eventID#year": `${event_id}#${year}`, ...(userItem || { id: userID }), quests: nextQuestsMap },
				QUESTS_TABLE,
				!userItem
			);
		} catch (err) {
			console.error("Error updating quest progress:", err);
			callback(null, handlerHelpers.createResponse(500, { message: "Internal server error" }));
			return null;
		}

		callback(
			null,
			handlerHelpers.createResponse(200, {
				message: "Quest progress updated",
				quests: nextQuestsMap,
			})
		);

		return null;

	} catch (err) {
		console.error("Unhandled error in handleQuestEvent:", err);
		callback(null, handlerHelpers.createResponse(500, { message: "Internal server error" }));
		return null;
	}
};

export const getQuest = async (event, ctx, callback) => {
	try {
		if (!event.pathParameters || !event.pathParameters.event_id || !event.pathParameters.year) {
			return helpers.createResponse(400, { message: "missing path parameters" });
		}

		const { event_id, year } = event.pathParameters;
		const userID = event.requestContext.authorizer.claims.email.toLowerCase();

		const userItem = await db.getOne(userID, QUESTS_TABLE, { "eventID#year": `${event_id}#${year}` });

		if (!userItem) {
			callback(
				null,
				handlerHelpers.createResponse(200, {
					message: `quest for ${event_id} ${year}`,
					quests: {},
				})
			);
			return null;
		}

		callback(
			null,
			handlerHelpers.createResponse(200, {
				message: `quest for ${event_id} ${year}`,
				quests: userItem.quests || {},
			})
		);
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

export const getAllQuests = async (event, ctx, callback) => {
	try {
		const userID = event.requestContext.authorizer.claims.email.toLowerCase();

		const userItem = await db.getOne(userID, QUESTS_TABLE);
		const questsMap = userItem?.quests || {};

		const data = Object.values(QUESTS).map((q) => {
			const stored = questsMap[q.id];

			// don't reinitialize! just read either the base case or the null case)
			return {
				quest: q,

				progress: stored ?? {
					progress: 0,
					target: q.target ?? null,
					startedAt: null,
					completedAt: null,
					description: q.description,
				},
			};
		});

		callback(
			null,
			handlerHelpers.createResponse(200, {
				message: `all quests for ${userID}`,
				data,
			})
		);
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


