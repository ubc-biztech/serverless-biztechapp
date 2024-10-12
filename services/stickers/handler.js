import {
  checkPayloadProps,
  createResponse,
  deleteConnection,
  fetchState,
  getSticker,
  notifyAdmins,
  notifyVoters,
  sendMessage,
  syncAdmin,
  syncUser,
  updateSocket,
  updateSticker
} from "./helpers";
import db from "../../lib/db";
import {
  STICKERS_TABLE,
  SCORE_TABLE,
  SOCKETS_TABLE
} from "../../constants/tables";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
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
    return await syncAdmin(event, teamName, isVoting);
  }

  if (!isVoting) {
    await sendMessage(event, {
      status: 200,
      action: "sync",
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
        let state = {
          isVoting: true
        };
        payload = updateSocket(state, "STATE");
        await notifyAdmins(state, "state", event);
        await notifyVoters(state, "state", event);
        return {
          statusCode: 200
        };
      }

      case "end": {
        let state = {
          isVoting: false
        };
        payload = updateSocket(state, "STATE");
        await notifyAdmins(state, "state", event);
        await notifyVoters(state, "state", event);
        return {
          statusCode: 200
        };
      }

      case "changeTeam": {
        let state = {
          teamName: body.team
        };
        payload = updateSocket(state, "STATE");
        await notifyAdmins(state, "state", event);
        await notifyVoters(state, "state", event);
        return {
          statusCode: 200
        };
      }

      default: {
        await sendMessage(event, {
          status: "400",
          action: "error",
          message: "unrecognized event type"
        });
        return {
          statusCode: 400
        };
      }
    }
  } catch (error) {
    console.log(error);
    await sendMessage(event, {
      status: "500",
      action: "error",
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
    sendMessage(event, {
      status: 400,
      action: "error",
      message: "voting is not open"
    });
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
        TableName: STICKERS_TABLE + (process.env.ENVIRONMENT || "")
      });
      const response = await docClient.send(command);
      isGoldenInDB = response.Items.length > 0;
    } catch (error) {
      db.dynamoErrorResponse(error);
    }

    if (isGoldenInDB) {
      sendMessage(event, {
        status: 400,
        action: "error",
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
      db.put(
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
      console.log(error);
      sendMessage(event, {
        status: 500,
        action: "error",
        message: "Failed to create sticker"
      });
      return {
        status: 500,
        message: "Failed to create sticker"
      };
    }

    sendMessage(event, {
      status: 200,
      action: "sticker",
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
        data: {
          teamName,
          count: 1,
          limit,
          stickerName,
          userID: id
        }
      },
      "sticker",
      event
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
    sendMessage(event, {
      status: 400,
      action: "error",
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
    "sticker",
    event
  );

  sendMessage(event, {
    status: 200,
    action: "sticker",
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
  let state = await fetchState();
  const { teamName } = state.Item;

  const body = JSON.parse(event.body);
  if (!body.hasOwnProperty("id") || !body.hasOwnProperty("score")) {
    const errMessage = checkPayloadProps(body, {
      id: {
        required: true,
        type: "string"
      },
      score: {
        required: true,
        type: "object"
      }
    });
    await sendMessage(event, errMessage);
    return errMessage;
  }

  const { id, score } = body;

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
    console.log(error.message);
    sendMessage(event, {
      status: 500,
      message: "Failed to store score"
    });
  }

  sendMessage(event, {
    status: 200,
    action: "score",
    message: "Stored score"
  });
  return {
    status: 200,
    action: "score",
    message: "Stored score successfully"
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
      action: "fail",
      message: "unknown action"
    });
  } catch (error) {
    console.log(error);
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
