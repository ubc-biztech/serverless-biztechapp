import { BLUEPRINT_OPENSEARCH_TEST_INDEX } from "../../constants/indexes";
import {
  CONNECTIONS_TABLE,
  MEMBERS2026_TABLE,
  PROFILES_TABLE,
  QRS_TABLE,
  QUESTS_TABLE
} from "../../constants/tables";
import db from "../../lib/db";
import docClient from "../../lib/docClient";
import handlerHelpers from "../../lib/handlerHelpers";
import helpers from "../../lib/handlerHelpers";
import search from "../../lib/search";
import {
  TYPES
} from "../profiles/constants";
import {
  CURRENT_EVENT
} from "./constants";
import {
  handleBooth,
  handleConnection,
  handleWorkshop,
  saveSocketConnection,
  removeSocketConnection,
  fetchRecentConnections
} from "./helpers";
import {
  QueryCommand
} from "@aws-sdk/lib-dynamodb";

const CONNECTION = "CONNECTION";
const WORK = "WORKSHOP";
const BOOTH = "BOOTH";

export const recommend = async (event, ctx, callback) =>  {
  try {
    const data = JSON.parse(event.body);
    helpers.checkPayloadProps(data, {
      query: {
        required: true,
        type: "string"
      },
      topK: {
        required: false,
        type: "number"
      }
    });
    const result = await search.retrieveTopK({
      indexName: BLUEPRINT_OPENSEARCH_TEST_INDEX, // TODO: change to staging / prod  
      queryText: data.query,
      topK: data.topK || 10,
    });
    return helpers.createResponse(200, result);
  } catch (err) {
    return helpers.createResponse(500, {
      message: "Internal server error"
    });
  }
};

export const postInteraction = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    const data = JSON.parse(event.body);

    try {
      helpers.checkPayloadProps(data, {
        eventType: {
          required: true
        },
        eventParam: {
          required: true
        }
      });
    } catch (error) {
      callback(null, error);
      return null;
    }

    const timestamp = new Date().getTime();
    const {
      eventType, eventParam
    } = data;

    let response;

    switch (eventType) {
    case CONNECTION:
      response = await handleConnection(userID, eventParam, timestamp);
      break;

    case WORK:
      response = await handleWorkshop(userID, eventParam, timestamp);
      break;

    case BOOTH:
      response = await handleBooth(userID, eventParam, timestamp);
      break;

    default:
      throw handlerHelpers.createResponse(400, {
        message: "interactionType argument does not match known case"
      });
    }

    callback(null, response);
  } catch (err) {
    console.error(err);
    callback(null, err);
    return err;
  }

  return null;
};

export const checkConnection = async (event, ctx, callback) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.id ||
      typeof event.pathParameters.id !== "string"
    )
      throw helpers.missingIdQueryResponse("profile ID in request path");

    const connectionID = event.pathParameters.id;
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();
    const memberData = await db.getOne(userID, MEMBERS2026_TABLE);

    if (!memberData)
      return helpers.createResponse(200, {
        message: `No profile associated with ${userID}`,
        connected: false
      });

    const {
      profileID
    } = memberData;

    if (connectionID == profileID)
      return helpers.createResponse(400, {
        message: "cannot be connected to yourself",
        connected: false
      });

    const result = await db.getOneCustom({
      TableName: PROFILES_TABLE + (process.env.ENVIRONMENT || ""),
      Key: {
        compositeID: `${TYPES.PROFILE}#${profileID}`,
        type: `${TYPES.CONNECTION}#${connectionID}`
      }
    });

    return helpers.createResponse(200, {
      connected: !!result
    });
  } catch (error) {
    console.error(error);
    return helpers.createResponse(502, {
      message: "internal server error, contact a biztech exec"
    });
  }
};

export const getAllConnections = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();

    const memberData = await db.getOne(userID, MEMBERS2026_TABLE);

    const {
      profileID
    } = memberData;

    const result = await db.query(PROFILES_TABLE, null, {
      expression:
        "compositeID = :compositeID AND  begins_with(#type, :typePrefix)",
      expressionValues: {
        ":compositeID": `PROFILE#${profileID}`,
        ":typePrefix": `${TYPES.CONNECTION}#`
      },
      expressionNames: {
        "#type": "type"
      }
    });

    const data = result.sort((a, b) => {
      return b.createdAt - a.createdAt;
    });

    const response = handlerHelpers.createResponse(200, {
      message: `all connections for ${userID}`,
      data
    });

    callback(null, response);
  } catch (err) {
    console.error(err);
    throw handlerHelpers.createResponse(500, {
      message: "Internal server error"
    });
  }

  return null;
};

export const getAllQuests = async (event, ctx, callback) => {
  try {
    const userID = event.requestContext.authorizer.claims.email.toLowerCase();

    const command = new QueryCommand({
      ExpressionAttributeValues: {
        ":uid": userID
      },
      KeyConditionExpression: "userID = :uid",
      TableName: QUESTS_TABLE + (process.env.ENVIRONMENT || "")
    });
    const result = await docClient.send(command);

    const response = handlerHelpers.createResponse(200, {
      message: `all quests for ${userID}`,
      data: result.Items
    });

    callback(null, response);
  } catch (err) {
    console.error(err);
    throw handlerHelpers.createResponse(500, {
      message: "Internal server error"
    });
  }

  return null;
};

export const getWallSnapshot = async (event) => {
  try {
    const qs = event.queryStringParameters || {
    };
    console.log("[WALL] snapshot request", qs);

    const eventId = qs.eventId || "DEFAULT";
    const sinceSec = Number(qs.sinceSec || "300");

    const items = await fetchRecentConnections({
      eventId,
      sinceMs: sinceSec * 1000
    });

    const nodeMap = new Map();
    const links = [];

    for (const it of items) {
      const {
        from, to, createdAt
      } = it;

      if (from?.id)
        nodeMap.set(from.id, {
          id: from.id,
          name: from.name ?? "",
          avatar: from.avatar
        });
      if (to?.id)
        nodeMap.set(to.id, {
          id: to.id,
          name: to.name ?? "",
          avatar: to.avatar
        });

      if (from?.id && to?.id) {
        links.push({
          source: from.id,
          target: to.id,
          createdAt
        });
      }
    }

    const nodes = Array.from(nodeMap.values());
    console.log("[WALL] snapshot response", {
      nodes: nodes.length,
      links: links.length
    });

    return helpers.createResponse(200, {
      nodes,
      links
    });
  } catch (err) {
    console.error(err);
    return helpers.createResponse(500, {
      message: "wall snapshot error"
    });
  }
};

// WebSocket connect
export const wsConnect = async (event) => {
  try {
    console.log("[WS] $connect", event.requestContext?.connectionId);
    const connectionId = event.requestContext.connectionId;

    await saveSocketConnection({
      connectionId,
      eventId: "__unset__",
      userId: "__anon__"
    });
    return {
      statusCode: 200,
      body: "connected"
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: "connect failed"
    };
  }
};

// WebSocket disconnect
export const wsDisconnect = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    await removeSocketConnection({
      connectionId
    });
    return {
      statusCode: 200,
      body: "disconnected"
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: "disconnect failed"
    };
  }
};

export const wsSubscribe = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body || "{}");
    console.log("[WS] subscribe", {
      connectionId,
      body
    });
    const eventId = body.eventId || "DEFAULT";
    const userId = body.userId || "__anon__";

    await saveSocketConnection({
      connectionId,
      eventId,
      userId
    });
    return {
      statusCode: 200,
      body: "subscribed"
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: "subscribe failed"
    };
  }
};
