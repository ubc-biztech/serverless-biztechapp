import {
  checkPayloadProps,
  createResponse,
  deleteConnection,
  fetchSocketRoomIDForConnection,
  fetchState,
  getSticker,
  notifyAdmins,
  notifyVoters,
  sendMessage,
  syncAdmin,
  syncUser,
  updateSocket,
  updateSticker,
  fetchSocket
} from "./helpers";
import db from "../../lib/db";
import {
  STICKERS_TABLE,
  SCORE_TABLE,
  SOCKETS_TABLE
} from "../../constants/tables";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";
import {
  ACTION_TYPES,
  ADMIN_EVENTS,
  ADMIN_ROLE,
  STATE_KEY,
  STICKER_TYPE_GOLDEN,
  VOTER_ROLE
} from "./constants";

/**
 * Connection handler
 *
 * Persists connection in DB, if not synced, by default connection will be set
 * to voter role
 *
 */
export const connectHandler = async (event, ctx, callback) => {
  const connectionID = event.requestContext.connectionId;

  let roomID = "";
  if (event.queryStringParameters && event.queryStringParameters.roomID) {
    roomID = event.queryStringParameters.roomID;
  }

  if (!(await fetchSocket(roomID))) {
    return {
      statusCode: 404,
      body: "roomID not found."
    };
  }

  const obj = {
    connectionID,
    role: VOTER_ROLE,
    roomID
  };

  await db.put(obj, SOCKETS_TABLE, true);

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
 * The event proudcer must provide the roomID to sync to the correct roomState
 *
 * The event.body REQUIRES the following properties:
 * `{
 *     id: string
 * }`
 *
 *    to sync connection to admin role and state, set id = ADMIN_ROLE
 */
export const syncHandler = async (event, ctx, callback) => {
  let test = "nothing changed";
  if (event.queryStringParameters && event.queryStringParameters.roomID) {
    test = event.queryStringParameters.roomID;
  }
  console.log(test);
  const body = JSON.parse(event.body);
  if (!body.hasOwnProperty("id") || !body.hasOwnProperty("roomID")) {
    const errMessage = checkPayloadProps(body, {
      id: {
        required: true,
        type: "string"
      },
      roomID: {
        required: true,
        type: "string"
      }
    });
    await sendMessage(event, errMessage);
    return errMessage;
  }

  const roomID = body.roomID;
  let state = await fetchState(roomID);
  const { isVoting, teamName } = state.Item;

  // sync admin that is specific to that room
  if (body.id === ADMIN_ROLE) {
    return await syncAdmin(event, teamName, isVoting);
  }

  if (!isVoting) {
    await sendMessage(event, {
      status: 200,
      action: ACTION_TYPES.sync,
      data: {
        isVoting,
        teamName,
        stickers: []
      }
    });
    return {
      statusCode: 200
    };
  }

  let stickers = await syncUser(body, event);

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
 *     event: "start" | "end" | "changeTeam",
 *     roomID: string
 * }`
 *
 *    if changeTeam is used as the action, then a team property must
 *    be provided as part of the message body
 */
export const adminHandler = async (event, ctx, callback) => {
  const body = JSON.parse(event.body);
  if (!body.hasOwnProperty("event") || !body.hasOwnProperty("roomID")) {
    const errMessage = checkPayloadProps(body, {
      event: {
        required: true,
        type: "string"
      },
      roomID: {
        required: true,
        type: "string"
      }
    });
    await sendMessage(event, errMessage);
    return errMessage;
  }
  const action = body.event;
  const roomID = body.roomID;

  if (action === ACTION_TYPES.changeTeam && !body.hasOwnProperty("team")) {
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
      case ADMIN_EVENTS.start: {
        let state = {
          isVoting: true
        };
        payload = await updateSocket(state, roomID);
        await notifyAdmins(state, ACTION_TYPES.state, event, roomID);
        await notifyVoters(state, ACTION_TYPES.state, event, roomID);
        return {
          statusCode: 200
        };
      }

      case ADMIN_EVENTS.end: {
        let state = {
          isVoting: false
        };
        payload = await updateSocket(state, roomID);
        await notifyAdmins(state, ACTION_TYPES.state, event, roomID);
        await notifyVoters(state, ACTION_TYPES.state, event, roomID);
        return {
          statusCode: 200
        };
      }

      case ADMIN_EVENTS.changeTeam: {
        let state = {
          teamName: body.team
        };
        payload = await updateSocket(state, roomID);
        await notifyAdmins(state, ACTION_TYPES.state, event, roomID);
        await notifyVoters(state, ACTION_TYPES.state, event, roomID);
        return {
          statusCode: 200
        };
      }

      default: {
        await sendMessage(event, {
          status: "400",
          action: ACTION_TYPES.error,
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
      action: ACTION_TYPES.error,
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
  const body = JSON.parse(event.body);
  if (
    !body.hasOwnProperty("id") ||
    !body.hasOwnProperty("stickerName") ||
    !body.hasOwnProperty("roomID")
  ) {
    const errMessage = checkPayloadProps(body, {
      id: {
        required: true,
        type: "string"
      },
      stickerName: {
        required: true,
        type: "string"
      },
      roomID: {
        required: true,
        type: "string"
      }
    });
    await sendMessage(event, errMessage);
    return errMessage;
  }

  const { id, stickerName, roomID } = body;
  let state = await fetchState(roomID);
  const { teamName, isVoting } = state.Item;

  if (!isVoting) {
    await sendMessage(event, {
      status: 400,
      action: ACTION_TYPES.error,
      message: "voting is not open"
    });
    return {
      status: 400
    };
  }

  let isGoldenInDB;
  if (stickerName === STICKER_TYPE_GOLDEN) {
    try {
      const command = new QueryCommand({
        IndexName: "stickerName",
        ExpressionAttributeValues: {
          ":sname": STICKER_TYPE_GOLDEN,
          ":uid": id
        },
        KeyConditionExpression: "stickerName = :sname",
        FilterExpression: "userID = :uid",
        ProjectionExpression: "stickerName, userID",
        TableName: STICKERS_TABLE + (process.env.ENVIRONMENT || "")
      });
      const response = await docClient.send(command);
      isGoldenInDB = response.Items.length > 0;
    } catch (error) {
      let errResponse = db.dynamoErrorResponse(error);
      console.error(errResponse);
    }

    if (isGoldenInDB) {
      await sendMessage(event, {
        status: 400,
        action: ACTION_TYPES.error,
        message: "Already submitted golden sticker."
      });
      return {
        status: 400,
        message: "Golden sticker already exists"
      };
    }
  }

  let sticker = await getSticker(teamName, stickerName, id);

  if (!sticker) {
    let limit = -1;
    if (body.hasOwnProperty("limit")) {
      limit = body.limit;
    }

    try {
      await db.put(
        {
          teamName,
          ["userID#stickerName"]: id + "#" + stickerName,
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
      await sendMessage(event, {
        status: 500,
        action: ACTION_TYPES.error,
        message: "Failed to create sticker"
      });
      return {
        status: 500,
        message: "Failed to create sticker"
      };
    }

    await sendMessage(event, {
      status: 200,
      action: ACTION_TYPES.sticker,
      message: stickerName + " was created for user " + id,
      data: {
        teamName,
        count: 1,
        limit,
        stickerName,
        userID: id
      }
    });

    await notifyAdmins(
      {
        teamName,
        count: 1,
        limit,
        stickerName,
        userID: id
      },
      ACTION_TYPES.sticker,
      event,
      roomID
    );
    return {
      status: 200,
      message: stickerName + " sticker created successfully"
    };
  }

  if (sticker.count < sticker.limit || sticker.limit === -1) {
    sticker.count++;
    await updateSticker(
      {
        count: sticker.count
      },
      teamName,
      id,
      stickerName
    );
  } else {
    await sendMessage(event, {
      status: 400,
      action: ACTION_TYPES.error,
      message: "Used up all " + sticker.limit + " stickers"
    });
    return {
      status: 400
    };
  }

  await notifyAdmins(
    {
      teamName,
      count: sticker.count,
      limit: sticker.limit,
      stickerName,
      userID: id
    },
    ACTION_TYPES.sticker,
    event,
    roomID
  );

  await sendMessage(event, {
    status: 200,
    action: ACTION_TYPES.sticker,
    data: sticker
  });
  return {
    status: 200
  };
};

/**
 * Score handler
 * simply puts scores for every team into DB
 * The event.body REQUIRES following properties:
 * @param event
 * `{
 *     event: {
 *        body: {
 *          id: string,
 *          score: Object, // use whatever type you would like in the frontend
 *        }
 *    }
 * }`
 *
 *
 */
export const scoreHandler = async (event, ctx, callback) => {
  const body = JSON.parse(event.body);
  if (
    !body.hasOwnProperty("id") ||
    !body.hasOwnProperty("score") ||
    !body.hasOwnProperty("roomID")
  ) {
    const errMessage = checkPayloadProps(body, {
      id: {
        required: true,
        type: "string"
      },
      score: {
        required: true,
        type: "object"
      },
      roomID: {
        required: true,
        type: "string"
      }
    });
    await sendMessage(event, errMessage);
    return errMessage;
  }

  const { id, score, roomID } = body;

  let state = await fetchState(roomID);
  const { teamName } = state.Item;

  try {
    await db.put(
      {
        teamName,
        userID: id,
        score
      },
      SCORE_TABLE,
      true
    );
  } catch (error) {
    console.error(error.message);
    await sendMessage(event, {
      status: 500,
      message: "Failed to store score"
    });
  }

  await sendMessage(event, {
    status: 200,
    action: ACTION_TYPES.score,
    message: "Stored score"
  });
  return {
    status: 200,
    action: ACTION_TYPES.score,
    message: "Stored score"
  };
};

/**
 * Default action handler
 *
 * Returns status 400 error for unrecognized action
 */
export const defaultHandler = async (event, ctx, callback) => {
  try {
    await sendMessage(event, {
      status: 400,
      action: ACTION_TYPES.error,
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

/**
 * Endpoint to return all scores
 *
 */
export const getScores = async (event, ctx, callback) => {
  let res;
  try {
    res = await db.scan(SCORE_TABLE);
  } catch (error) {
    console.error(error);
    res = createResponse(500, {
      message: "failed to fetch scores"
    });
    callback(null, res);
    return res;
  }
  res = createResponse(200, {
    message: "Scores",
    response: res
  });
  callback(null, res);
  return res;
};
