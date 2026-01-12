import {
	PutCommand,
	QueryCommand,
	DeleteCommand
} from "@aws-sdk/lib-dynamodb";
import {
	ApiGatewayManagementApi
} from "@aws-sdk/client-apigatewaymanagementapi";
import {
	PROFILES_TABLE,
	MEMBERS2026_TABLE
} from "../../constants/tables";
import db from "../../lib/db";
import handlerHelpers from "../../lib/handlerHelpers";
import docClient from "../../lib/docClient";
import {
	CURRENT_EVENT,
	EXEC,
	QUEST_WORKSHOP,
	WORKSHOP_TWO,
	WORKSHOP_TWO_PARTICIPANT,
	QUEST_WORKSHOP_TWO_PARTICIPANT
} from "./constants";
import {
	PROFILE_TYPES, TYPES
} from "../profiles/constants";
import {
	randomUUID
} from "crypto";

const WS_TABLE = `bizWallSockets${process.env.ENVIRONMENT || ""}`;
const LIVE_TABLE = `bizLiveConnections${process.env.ENVIRONMENT || ""}`;
const WS_ENDPOINT = process.env.WS_API_ENDPOINT;

export const handleConnection = async (userID, connProfileID, timestamp) => {
	let memberData = await db.getOne(userID, MEMBERS2026_TABLE);

	let userProfileID = memberData.profileID;

	if (userProfileID === connProfileID) {
		return handlerHelpers.createResponse(400, {
			message: "Cannot connect with yourself"
		});
	}

	let [q1, q2] = await Promise.all([
		db.getOneCustom({
			TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
			Key: {
				compositeID: `PROFILE#${userProfileID}`,
				type: TYPES.PROFILE
			}
		}),
		db.getOneCustom({
			TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
			Key: {
				compositeID: `PROFILE#${connProfileID}`,
				type: TYPES.PROFILE
			}
		})
	]);

	if (!q1 || !q2) {
		throw handlerHelpers.notFoundResponse(
			"Profile",
			q1 ? connProfileID : userID
		);
	}

	let userProfile = q1;
	let connProfile = q2;

	if (await isDuplicateRequest(userProfileID, connProfileID)) {
		return handlerHelpers.createResponse(200, {
			message: "Connection has already been made"
		});
	}

	let swap = false;
	if (userProfile.profileType === EXEC && connProfile.profileType === EXEC) {
		connProfile.type = PROFILE_TYPES.EXEC + PROFILE_TYPES.EXEC;
	} else if (userProfile.profileType === EXEC) {
		userProfile = [connProfile, (connProfile = userProfile)][0];
		userID = [connProfileID, (connProfileID = userID)][0];
		swap = true;
	}

	const userPut = {
		compositeID: `${TYPES.PROFILE}#${userProfileID}`,
		type: `${TYPES.CONNECTION}#${connProfileID}`,
		connectionID: connProfileID,
		connectionType: connProfile.profileType ?? PROFILE_TYPES.ATTENDEE, // connProfile is the target here, default to attendee
		createdAt: timestamp,
		fname: connProfile.fname,
		lname: connProfile.lname,
		pronouns: connProfile.pronouns,
		...(connProfile.major
			? {
				major: connProfile.major
			}
			: {
			}),
		...(connProfile.year
			? {
				year: connProfile.year
			}
			: {
			}),
		...(connProfile.company
			? {
				company: connProfile.company
			}
			: {
			}),
		...(connProfile.title
			? {
				title: connProfile.title
			}
			: {
			})
	};

	const connPut = {
		compositeID: `${TYPES.PROFILE}#${connProfileID}`,
		type: `${TYPES.CONNECTION}#${userProfileID}`,
		connectionID: userProfileID,
		connectionType: userProfile.profileType ?? PROFILE_TYPES.ATTENDEE, // userProfile is the target here, default to attendee
		createdAt: timestamp,
		fname: userProfile.fname,
		lname: userProfile.lname,
		pronouns: userProfile.pronouns,
		...(userProfile.major
			? {
				major: userProfile.major
			}
			: {
			}),
		...(userProfile.year
			? {
				year: userProfile.year
			}
			: {
			}),
		...(userProfile.company
			? {
				company: userProfile.company
			}
			: {
			}),
		...(userProfile.title
			? {
				title: userProfile.title
			}
			: {
			})
	};

	const promises = [];
	switch (connProfile.profileType) {
		// exec cases temporarily will be paused as we decide how to handle other interactions
		case PROFILE_TYPES.EXEC + PROFILE_TYPES.EXEC:
		// promises.push(
		//   incrementQuestProgress(userProfileID, QUEST_CONNECT_EXEC_H)
		// );

		case PROFILE_TYPES.EXEC:
		// promises.push(
		//   incrementQuestProgress(connProfileID, QUEST_CONNECT_EXEC_H)
		// );

		// case ATTENDEE:
		default:
			try {
				await db.putMultiple(
					[connPut, userPut],
					[PROFILES_TABLE, PROFILES_TABLE],
					true
				);
			} catch (error) {
				console.error(error);
				return handlerHelpers.createResponse(500, {
					message: "Internal server error"
				});
			}

			{
				const eventId = CURRENT_EVENT || "DEFAULT";

				const fromNode = {
					id: swap ? connProfileID : userProfileID,
					name: swap
						? `${connProfile.fname} ${connProfile.lname}`
						: `${userProfile.fname} ${userProfile.lname}`,
					avatar: swap
						? connProfile.profilePictureURL
						: userProfile.profilePictureURL,
					major: swap ? connProfile.major : userProfile.major,
					year: swap ? connProfile.year : userProfile.year
				};

				const toNode = {
					id: swap ? userProfileID : connProfileID,
					name: swap
						? `${userProfile.fname} ${userProfile.lname}`
						: `${connProfile.fname} ${connProfile.lname}`,
					avatar: swap
						? userProfile.profilePictureURL
						: connProfile.profilePictureURL,
					major: swap ? userProfile.major : connProfile.major,
					year: swap ? userProfile.year : connProfile.year
				};

				console.log("[WALL] new connection", {
					eventId,
					from: fromNode,
					to: toNode
				});

				try {
					const subs = await listConnectionsByEvent(eventId);

					const payload = {
						type: "connection",
						createdAt: Date.now(),
						from: fromNode,
						to: toNode
					};
					await Promise.all(
						subs.map((s) => postToConnection(s.connectionId, payload))
					);
				} catch (e) {
					console.error("broadcast error", e);
				}

				// Persist to live log (for initial hydration / replay)
				await logLiveConnection({
					eventId,
					from: fromNode,
					to: toNode
				});

				console.log("[WALL] logged live connection");

				try {
					const subs = await listConnectionsByEvent(eventId);
					const payload = {
						type: "edge",
						createdAt: Date.now(),
						from: fromNode,
						to: toNode
					};
					await Promise.all(
						subs.map((s) => postToConnection(s.connectionId, payload))
					);
				} catch (e) {
					console.error("broadcast error", e);
				}
			}
			// incrementQuestProgress(userProfile.id, QUEST_TOTAL_CONNECTIONS),
			// incrementQuestProgress(connProfile.id, QUEST_TOTAL_CONNECTIONS)
			break;
	}

	return handlerHelpers.createResponse(200, {
		message: `Connection created with ${swap ? userProfile.fname : connProfile.fname
			}`,
		name: `${swap
			? userProfile.fname + " " + userProfile.lname
			: connProfile.fname + " " + connProfile.lname
			}`
	});
};

const isDuplicateRequest = async (userID, connID) => {
	const result = await db.getOneCustom({
		TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
		Key: {
			compositeID: `PROFILE#${userID}`,
			type: `${TYPES.CONNECTION}#${connID}`
		}
	});
	return Boolean(result);
};

export async function saveSocketConnection({
	connectionId, eventId, userId
}) {
	console.log("[WS] saveSocketConnection", {
		connectionId,
		eventId,
		userId
	});
	const cmd = new PutCommand({
		TableName: WS_TABLE,
		Item: {
			connectionId,
			eventId,
			userId,
			connectedAt: Date.now()
		}
	});
	await docClient.send(cmd);
}

export async function removeSocketConnection({
	connectionId
}) {
	const cmd = new DeleteCommand({
		TableName: WS_TABLE,
		Key: {
			connectionId
		}
	});
	await docClient.send(cmd);
}

export async function listConnectionsByEvent(eventId) {
	console.log("[WS] listConnectionsByEvent ->", eventId);
	const cmd = new QueryCommand({
		TableName: WS_TABLE,
		IndexName: "byEvent",
		KeyConditionExpression: "eventId = :e",
		ExpressionAttributeValues: {
			":e": eventId
		}
	});
	const res = await docClient.send(cmd);
	console.log(
		"[WS] listConnectionsByEvent result count:",
		res?.Items?.length || 0
	);
	return res.Items || [];
}

export function wsClient() {
	// note: endpoint must include stage path
	return new ApiGatewayManagementApi({
		endpoint: WS_ENDPOINT
	});
}

export async function postToConnection(connectionId, payload) {
	const api = wsClient();
	try {
		console.log(
			"[WS] postToConnection ->",
			process.env.WS_API_ENDPOINT,
			connectionId,
			payload?.type
		);
		await api.postToConnection({
			ConnectionId: connectionId,
			Data: Buffer.from(JSON.stringify(payload))
		});
	} catch (err) {
		console.error("[WS] postToConnection error", err);
		if (err.statusCode === 410) {
			await removeSocketConnection({
				connectionId
			});
		}
	}
}

export async function logLiveConnection({
	eventId, from, to
}) {
	const createdAt = Date.now();
	const sk = `ts#${createdAt}#${randomUUID()}`;
	const cmd = new PutCommand({
		TableName: LIVE_TABLE,
		Item: {
			eventId,
			sk,
			createdAt,
			from,
			to
		}
	});
	await docClient.send(cmd);
}

export async function fetchRecentConnections({
	eventId,
	sinceMs = 60 * 60 * 1000
}) {
	const now = Date.now();
	const threshold = now - sinceMs;

	const cmd = new QueryCommand({
		TableName: LIVE_TABLE,
		IndexName: "recent",
		KeyConditionExpression: "eventId = :e AND createdAt >= :t",
		ExpressionAttributeValues: {
			":e": eventId,
			":t": threshold
		},
		ScanIndexForward: true
	});
	const res = await docClient.send(cmd);
	return res.Items || [];
}
