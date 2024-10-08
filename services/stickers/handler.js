import {
  checkPayloadProps,
  deleteConnection,
  fetchState,
  getSticker,
  notifyAdmins,
  notifyVoters,
  sendMessage,
  updateSocket,
  updateSticker
} from "./helpers";
import db from "../../lib/db";
import {
  STICKERS_TABLE,
  SCORE_TABLE,
  SOCKETS_TABLE
} from "../../constants/tables";
import { DeleteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";

/**
 * Connection handler
 *
 * Persists connection in DB, if not synced, by default connection will be set
 * to voter role
 *
 */
export const connectHandler = async (event, ctx, callback) => {
  const connectionID = event.requestContext.connectionId;
  const obj = {
    connectionID,
    role: "voter",
    userID: ""
  };

  db.put(obj, SOCKETS_TABLE, true);

  return {
    statusCode: 200,
    body: "Connected."
  };
};

/**
 * Disconnect handler
 *
 * Cleans up socket table upon graceful disconnect
 */
export const disconnectHandler = async (event, ctx, callback) => {
  const connectionID = event.requestContext.connectionId;
  await deleteConnection(connectionID);
  return {
    statusCode: 200,
    message: "Disconnected"
  };
};

/**
 * Sync action handler
 * The event.body REQUIRES the following properties:
 * `{
 *     id: string
 * }`
 *
 *    to sync connection to admin role and state, set id = "admin"
 */
export const syncHandler = async (event, ctx, callback) => {
  const body = JSON.parse(event.body);
  if (!body.hasOwnProperty("id")) {
    const errMessage = checkPayloadProps(body, {
      id: {
        required: true,
        type: "string"
      }
    });
    await sendMessage(event, errMessage);
    return errMessage;
  }

  let state = await fetchState();
  const { isVoting, teamName } = state.Item;

  if (body.id === "admin") {
    updateSocket(
      {
        role: "admin"
      },
      event.requestContext.connectionId
    );

    let stickers = [];
    try {
      const command = new QueryCommand({
        ExpressionAttributeValues: {
          ":v_team": teamName
        },
        ExpressionAttributeNames: {
          "#cnt": "count",
          "#lmt": "limit"
        },
        KeyConditionExpression: "teamName = :v_team",
        ProjectionExpression: "stickerName, #cnt, #lmt",
        TableName: STICKERS_TABLE
      });
      const response = await docClient.send(command);
      stickers = response.Items;
    } catch (error) {
      db.dynamoErrorResponse(error);
      await sendMessage(event, {
        status: "502",
        message: "Internal server error"
      });
    }

    await sendMessage(event, {
      isVoting,
      teamName,
      stickers
    });
    return {
      statusCode: 200
    };
  }

  if (!isVoting) {
    await sendMessage(event, {
      isVoting,
      teamName,
      stickers: []
    });
    return {
      statusCode: 200
    };
  }

  let stickers;
  try {
    const command = new QueryCommand({
      IndexName: "userID",

      ExpressionAttributeValues: {
        ":v_id": body.id
      },
      ExpressionAttributeNames: {
        "#cnt": "count",
        "#lmt": "limit"
      },
      KeyConditionExpression: "userID = :v_id",
      ProjectionExpression: "stickerName, #cnt, #lmt",
      TableName: STICKERS_TABLE
    });
    const response = await docClient.send(command);
    stickers = {
      stickers: response.Items,
      count: response.Count
    };
  } catch (error) {
    db.dynamoErrorResponse(error);
    await sendMessage(event, {
      status: "502",
      message: "Internal server error"
    });
  }

  await sendMessage(event, {
    status: 200,
    isVoting,
    stickers
  });
  return {
    statusCode: 200
  };
};

/**
 * Admin action handler
 * The event.body REQUIRES following properties:
 * `{
 *     event: "start" | "end" | "changeTeam"
 * }`
 *
 *    if changeTeam is used as the action, then a team property must
 *    be provided as part of the message body
 */
export const adminHandler = async (event, ctx, callback) => {
  const body = JSON.parse(event.body);
  if (!body.hasOwnProperty("event")) {
    const errMessage = checkPayloadProps(body, {
      event: {
        required: true,
        type: "string"
      }
    });
    await sendMessage(event, errMessage);
    return errMessage;
  }
  const action = body.event;

  if (action === "changeTeam" && !body.hasOwnProperty("team")) {
    const errMessage = checkPayloadProps(body, {
      team: {
        required: true,
        type: "string"
      }
    });

    await sendMessage(event, errMessage);
    return errMessage;
  }

  try {
    let payload;
    switch (action) {
      case "start": {
        payload = updateSocket(
          {
            isVoting: true
          },
          "STATE"
        );
        await notifyAdmins(payload, event);
        await notifyVoters(payload, event);
        return {
          statusCode: 200
        };
      }

      case "end": {
        payload = updateSocket(
          {
            isVoting: false
          },
          "STATE"
        );
        await notifyAdmins(payload, event);
        await notifyVoters(payload, event);
        return {
          statusCode: 200
        };
      }

      case "changeTeam": {
        payload = updateSocket(
          {
            teamName: body.team
          },
          "STATE"
        );
        await notifyAdmins(payload, event);
        await notifyVoters(payload, event);
        return {
          statusCode: 200
        };
      }

      default: {
        await sendMessage(event, {
          status: "400",
          message: "unrecognized event type"
        });
        return {
          statusCode: 400
        };
      }
    }
  } catch (error) {
    console.error(error);
    await sendMessage(event, {
      status: "500",
      message: "Internal Server Error"
    });
    return {
      statusCode: 500
    };
  }
};

/**
 * Sticker action handler
 * The event.body REQUIRES following properties:
 * @param event
 * `{
 *     event: {
 *        body: {
 *          id: string,
 *          stickerName: string
 *        }
 *    }
 * }`
 *
 *
 */
export const stickerHandler = async (event, ctx, callback) => {
  let state = await fetchState();
  const { teamName, isVoting } = state.Item;

  if (!isVoting) {
    sendMessage(event, { status: 400, message: "voting is not open" });
    return {
      status: 400
    };
  }

  const body = JSON.parse(event.body);
  if (!body.hasOwnProperty("id") || !body.hasOwnProperty("stickerName")) {
    const errMessage = checkPayloadProps(body, {
      id: {
        required: true,
        type: "string"
      },
      stickerName: {
        required: true,
        type: "string"
      }
    });
    await sendMessage(event, errMessage);
    return errMessage;
  }
  const { id, stickerName } = body;

  let isGoldenInDB;
  if (stickerName === "golden") {
    try {
      const command = new QueryCommand({
        IndexName: "stickerName",
        ExpressionAttributeValues: {
          ":sname": "golden",
          ":uid": id
        },
        KeyConditionExpression: "stickerName = :sname",
        FilterExpression: "userID = :uid",
        ProjectionExpression: "stickerName, userID",
        TableName:
          STICKERS_TABLE +
          (process.env.NODE_ENV !== "local" ? process.env.NODE_ENV : "")
      });
      const response = await docClient.send(command);
      isGoldenInDB = response.Items.length > 0;
    } catch (error) {
      db.dynamoErrorResponse(error);
    }

    if (isGoldenInDB) {
      sendMessage(event, {
        status: 400,
        message: "Already submitted golden sticker."
      });
      return { status: 400, message: "golden sticker already exists" };
    }
  }

  let sticker = await getSticker(teamName, stickerName, id);

  if (!sticker) {
    let limit = -1;
    if (body.hasOwnProperty("limit")) {
      limit = body.limit;
    }
    try {
      db.put(
        {
          teamName,
          [`userID#stickerName`]: id + "#" + stickerName,
          count: 1,
          limit,
          stickerName,
          userID: id
        },
        STICKERS_TABLE,
        true
      );
    } catch (error) {
      console.error(error);
      sendMessage(event, { status: 500, message: "Failed to create sticker" });
      return {
        status: 500,
        message: "Failed to create sticker"
      };
    }

    sendMessage(event, {
      status: 200,
      message: stickerName + " was created for user " + id,
      data: {
        teamName,
        count: 1,
        limit,
        stickerName,
        userID: id
      }
    });

    notifyAdmins(
      {
        status: 200,
        action: "sticker",
        data: {
          teamName,
          count: 1,
          limit,
          stickerName,
          userID: id
        }
      },
      event
    );
    return {
      status: 200,
      message: stickerName + " sticker created successfully"
    };
  }

  if (sticker.count < sticker.limit || sticker.limit === -1) {
    sticker.count++;
    await updateSticker({ count: sticker.count }, teamName, id, stickerName);
  } else {
    sendMessage(event, {
      status: 400,
      message: "Used up all " + sticker.limit + " stickers"
    });
    return {
      status: 400
    };
  }

  notifyAdmins(
    {
      teamName,
      count: 1,
      limit: sticker.limit,
      stickerName,
      userID: id
    },
    event
  );

  sendMessage(event, { status: 200, data: sticker });
  return {
    status: 200
  };

  // logic to update sticker
};

export const scoreHandler = async (event, ctx, callback) => {};

/**
 * Default action handler
 *
 * Returns status 400 error for unrecognized action
 */
export const defaultHandler = async (event, ctx, callback) => {
  try {
    await sendMessage(event, {
      status: 400,
      message: "unknown action"
    });
  } catch (error) {
    console.error(error);
    callback(null, error);
    return null;
  }
  return {
    statusCode: 200
  };
};
