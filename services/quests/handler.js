import { QUESTS_TABLE } from "../../constants/tables";
import db from "../../lib/db";
import { QUEST_DEFS, QUEST_TYPES } from "./constants";
import { applyQuestEvent, parseEvents, initStoredQuest } from "./helper.js";
import handlerHelpers from "../../lib/handlerHelpers";
import helpers from "../../lib/handlerHelpers";

// go through callback and context 
export const updateQuest = async (event, ctx, callback) => {
	try {
		if (!event.pathParameters || !event.pathParameters.event_id || !event.pathParameters.year) {
			console.log(event.pathParameters);
			return helpers.createResponse(400, { message: "missing path parameters" });
		}

		const { event_id, year } = event.pathParameters;

		const userID = event.requestContext.authorizer.claims.email.toLowerCase();
		const body = JSON.parse(event.body);

		try {
			handlerHelpers.checkPayloadProps(body, {
				type: { required: true, type: "string" },
				argument: { required: true, type: "object" }
			});

			if (body.type !== "connection" && body.type !== "company") {
				return handlerHelpers.createResponse(400, { message: `Invalid type: '${body.type}'. Valid types: 'connection', 'company'` });
			}

			if (body.type === "company" && typeof body.argument !== "string") {
				return handlerHelpers.createResponse(400, { message: "For 'company' type, argument must be a company name string" });
			}
		} catch (err) {
			return err;
		}

		const timestamp = Date.now();
		const questEvents = parseEvents(body);

		if (!questEvents) {
			return handlerHelpers.createResponse(400, { message: "Failed to parse quest event" });
		}

		let userItem;
		try {
			userItem = await db.getOne(userID, QUESTS_TABLE, { "eventID#year": `${event_id}#${year}` });
		} catch (err) {
			console.error("Could not read user data:", err);
			return handlerHelpers.createResponse(500, { message: "DB read failed" });
		}

		const questsMap = userItem?.quests || {};

		const nextQuestsMap = Object.values(QUEST_DEFS).reduce((acc, def) => {
			const event = questEvents.find(e => e.questId === def.id);
			const current = acc[def.id];
			const now = timestamp;

			if (!current) {
				const initialized = initStoredQuest(def, now);
				if (!event) {
					return { ...acc, [def.id]: initialized };
				}
			}

			if (!event) return acc;

			const updated = applyQuestEvent(def, current, event, now);

			return { ...acc, [def.id]: updated };
		}, questsMap);

		try {
			await db.put(
				{
					"eventID#year": `${event_id}#${year}`,
					...(userItem || { id: userID }),
					quests: nextQuestsMap
				},
				QUESTS_TABLE,
				!userItem
			);
		} catch (err) {
			console.error("Error updating quest progress:", err);
			return handlerHelpers.createResponse(500, { message: "Internal server error" });
		}

		return handlerHelpers.createResponse(200, {
			quests: nextQuestsMap,
		});
	} catch (err) {
		console.error("Unhandled error in updateQuest:", err);
		return handlerHelpers.createResponse(500, { message: "Internal server error" });
	}
};

export const getQuest = async (event, ctx, callback) => {
	try {
		if (!event.pathParameters || !event.pathParameters.event_id || !event.pathParameters.year) {
			return handlerHelpers.createResponse(400, { message: "missing path parameters" });
		}

		const { event_id, year } = event.pathParameters;
		const userID = event.requestContext.authorizer.claims.email.toLowerCase();

		let userItem = await db.getOne(userID, QUESTS_TABLE, { "eventID#year": `${event_id}#${year}` });

		if (userItem) {
			return handlerHelpers.createResponse(200, {
				quests: userItem.quests || {},
			});
		}

		const newQuests = Object.entries(QUEST_DEFS).reduce((acc, [id, def]) => {
			acc[id] = initStoredQuest(def, Date.now());
			return acc;
		}, {});

		try {
			await db.put({
				id: userID,
				"eventID#year": `${event_id}#${year}`,
				quests: newQuests
			}, QUESTS_TABLE, true);

			return handlerHelpers.createResponse(200, { quests: newQuests });
		} catch (err) {
			if (err.code !== "ConditionalCheckFailedException") {
				console.error(err);
				return handlerHelpers.createResponse(500, { message: "Internal server error" });
			}
		}

		userItem = await db.getOne(userID, QUESTS_TABLE, { "eventID#year": `${event_id}#${year}` });
		return handlerHelpers.createResponse(200, { quests: userItem?.quests || {} });
	} catch (err) {
		console.error(err);
		return handlerHelpers.createResponse(500, {
			message: "Internal server error",
		});
	}
};

export const getQuestsByEvent = async (event, ctx, callback) => {
	try {
		if (!event.pathParameters || !event.pathParameters.event_id || !event.pathParameters.year) {
			return handlerHelpers.createResponse(400, { message: "missing path parameters" });
		}

		const userID = event.requestContext.authorizer.claims.email.toLowerCase();
		if (!userID.endsWith("@ubcbiztech.com")) {
			return handlerHelpers.createResponse(401, { message: "Unauthorized" });
		}

		const { event_id, year } = event.pathParameters;
		const eventKey = `${event_id}#${year}`;

		const items = await db.scan(QUESTS_TABLE, {
			FilterExpression: "#eventquery = :eventKey",
			ExpressionAttributeNames: {
				"#eventquery": "eventID#year"
			},
			ExpressionAttributeValues: {
				":eventKey": eventKey
			}
		}, "event-query");

		const quests = items.map(item => ({
			userId: item.id,
			quests: item.quests || {}
		}));

		return handlerHelpers.createResponse(200, {
			quests,
		});
	} catch (err) {
		console.error(err);
		return handlerHelpers.createResponse(500, {
			message: "Internal server error",
		});
	}
};


