import { QUESTS_TABLE, USERS_TABLE } from "../../constants/tables.js";
import db from "../../lib/db.js";
import handlerHelpers from "../../lib/handlerHelpers";
import type { APIGatewayEvent, LambdaCallback, LambdaContext } from "../../lib/types";
import { QUEST_DEFS } from "./constants.js";
import { applyQuestEvent, initStoredQuest, parseEvents } from "./helper.js";

async function getEmailFromProfileId(profileId: string): Promise<string | null> {
  try {
    const results = await db.query(USERS_TABLE, "profileID-index", {
      expression: "#profileID = :profileID",
      expressionNames: {
        "#profileID": "profileID",
      },
      expressionValues: {
        ":profileID": profileId,
      },
    });

    if (results && results.length > 0) {
      return results[0].id as string;
    }
    return null;
  } catch (err: unknown) {
    console.error(`Error looking up email for profileId ${profileId}:`, err);
    return null;
  }
}

async function updateUserQuestProgress(
  userID: string,
  event_id: string,
  year: string,
  questEvents: ReturnType<typeof parseEvents>,
  timestamp: number,
  connectionProfileId: string | null = null,
): Promise<{
  success: boolean;
  quests?: Record<string, unknown>;
  alreadyConnected?: boolean;
  error?: string;
}> {
  const eventKey = `${event_id}#${year}`;

  let userItem: Record<string, unknown> | null;
  try {
    userItem = await db.getOne(userID, QUESTS_TABLE, {
      "eventID#year": eventKey,
    });
  } catch (err: unknown) {
    console.error(`Could not read user data for ${userID}:`, err);
    return {
      success: false,
      error: "DB read failed",
    };
  }

  const connectedProfiles =
    ((userItem && userItem.connectedProfiles) as string[]) || [];

  if (
    connectionProfileId &&
    connectedProfiles.includes(connectionProfileId.toLowerCase())
  ) {
    console.log(
      `User ${userID} already connected with ${connectionProfileId}, skipping (idempotent)`,
    );
    return {
      success: true,
      quests: ((userItem && userItem.quests) as Record<string, unknown>) || {},
      alreadyConnected: true,
    };
  }

  const questsMap = ((userItem && userItem.quests) as Record<string, unknown>) || {};

  const nextQuestsMap = Object.values(QUEST_DEFS).reduce(
    (acc, def) => {
      const event = questEvents?.find((e) => e.questId === def.id);
      const current = acc[def.id] as Record<string, unknown> | undefined;
      const now = timestamp;

      if (!current) {
        const initialized = initStoredQuest(def, now);
        if (!event) {
          return {
            ...acc,
            [def.id]: initialized,
          };
        }
      }

      if (!event) return acc;

      const updated = applyQuestEvent(def, current, event, now);

      return {
        ...acc,
        [def.id]: updated,
      };
    },
    questsMap,
  );

  const nextConnectedProfiles = connectionProfileId
    ? [...connectedProfiles, connectionProfileId.toLowerCase()]
    : connectedProfiles;

  const itemToWrite = {
    id: userID,
    "eventID#year": eventKey,
    quests: nextQuestsMap,
    connectedProfiles: nextConnectedProfiles,
  };

  try {
    await db.put(itemToWrite, QUESTS_TABLE, !userItem);
    return {
      success: true,
      quests: nextQuestsMap,
    };
  } catch (err: unknown) {
    const errObj = err as {
      code?: string;
      body?: string;
    };
    const isConditionalCheckFailed =
      errObj.code === "ConditionalCheckFailedException" ||
      (errObj.body &&
        errObj.body.includes &&
        errObj.body.includes("ConditionalCheckFailed"));

    if (isConditionalCheckFailed) {
      console.log(`Race condition detected for ${userID}, retrying...`);
      try {
        await db.put(itemToWrite, QUESTS_TABLE, !!userItem);
        return {
          success: true,
          quests: nextQuestsMap,
        };
      } catch (retryErr: unknown) {
        console.error(`Retry failed for ${userID}:`, retryErr);
        return {
          success: false,
          error: "DB write failed after retry",
        };
      }
    }

    console.error(`Error updating quest progress for ${userID}:`, err);
    return {
      success: false,
      error: "DB write failed",
    };
  }
}

export const updateQuest = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.event_id ||
      !event.pathParameters.year
    ) {
      console.log(event.pathParameters);
      return handlerHelpers.createResponse(400, {
        message: "missing path parameters",
      });
    }

    const { event_id, year } = event.pathParameters;

    const userID =
      event.requestContext.authorizer?.claims?.email?.toLowerCase() as string;
    const body = JSON.parse(event.body as string) as Record<string, unknown>;

    try {
      handlerHelpers.checkPayloadProps(body, {
        type: {
          required: true,
          type: "string",
        },
        argument: {
          required: true,
          type: "object",
        },
      });

      if (body.type !== "connection" && body.type !== "company") {
        return handlerHelpers.createResponse(400, {
          message: `Invalid type: '${body.type}'. Valid types: 'connection', 'company'`,
        });
      }

      if (body.type === "company" && typeof body.argument !== "string") {
        return handlerHelpers.createResponse(400, {
          message: "For 'company' type, argument must be a company name string",
        });
      }
    } catch (err) {
      return err;
    }

    const timestamp = Date.now();
    const questEvents = parseEvents(body);

    if (!questEvents) {
      return handlerHelpers.createResponse(400, {
        message: "Failed to parse quest event",
      });
    }

    const targetProfileId =
      body.argument &&
      typeof body.argument === "object" &&
      (body.argument as Record<string, unknown>).profileId;
    const isConnectionEvent = body.type === "connection";

    const userAResult = await updateUserQuestProgress(
      userID,
      event_id,
      year,
      questEvents,
      timestamp,
      isConnectionEvent ? (targetProfileId as string) : null,
    );

    if (!userAResult.success) {
      return handlerHelpers.createResponse(500, {
        message: userAResult.error || "Internal server error",
      });
    }

    const isBidirectional = !(
      body.argument &&
      typeof body.argument === "object" &&
      (body.argument as Record<string, unknown>).bidirectional === false
    );

    if (
      isConnectionEvent &&
      isBidirectional &&
      targetProfileId &&
      !userAResult.alreadyConnected
    ) {
      const userBEmail = await getEmailFromProfileId(targetProfileId as string);

      if (userBEmail) {
        const userBEmailLower = userBEmail.toLowerCase();

        if (userBEmailLower !== userID) {
          let userAProfileId: string | null = null;
          try {
            const userAMember = await db.getOne(userID, USERS_TABLE);
            userAProfileId =
              userA && (userA.profileID as string | undefined)
                ? (userA.profileID as string)
                : null;
          } catch (_e: unknown) {
            console.warn(`Could not get profileId for ${userID}`);
          }

          const userBResult = await updateUserQuestProgress(
            userBEmailLower,
            event_id,
            year,
            questEvents,
            timestamp,
            userAProfileId,
          );

          if (!userBResult.success) {
            console.error(
              `Failed to update bi-directional quest for ${targetProfileId} (${userBEmail}): ${userBResult.error}`,
            );
          }
        }
      } else {
        console.warn(`Could not find email for profileId: ${targetProfileId}`);
      }
    }

    return handlerHelpers.createResponse(200, {
      quests: userAResult.quests,
      alreadyConnected: userAResult.alreadyConnected || false,
    });
  } catch (err: unknown) {
    console.error("Unhandled error in updateQuest:", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error",
    });
  }
};

export const getQuest = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.event_id ||
      !event.pathParameters.year
    ) {
      return handlerHelpers.createResponse(400, {
        message: "missing path parameters",
      });
    }

    const { event_id, year } = event.pathParameters;
    const userID =
      event.requestContext.authorizer?.claims?.email?.toLowerCase() as string;

    let userItem = await db.getOne(userID, QUESTS_TABLE, {
      "eventID#year": `${event_id}#${year}`,
    });

    if (userItem) {
      return handlerHelpers.createResponse(200, {
        quests: userItem.quests || {},
      });
    }

    const newQuests = Object.entries(QUEST_DEFS).reduce(
      (acc, [id, def]) => {
        acc[id] = initStoredQuest(def, Date.now());
        return acc;
      },
      {} as Record<string, unknown>,
    );

    try {
      await db.put(
        {
          id: userID,
          "eventID#year": `${event_id}#${year}`,
          quests: newQuests,
        },
        QUESTS_TABLE,
        true,
      );

      return handlerHelpers.createResponse(200, { quests: newQuests });
    } catch (err: unknown) {
      const errObj = err as { code?: string };
      if (errObj.code !== "ConditionalCheckFailedException") {
        console.error(err);
        return handlerHelpers.createResponse(500, {
          message: "Internal server error",
        });
      }
    }

    userItem = await db.getOne(userID, QUESTS_TABLE, {
      "eventID#year": `${event_id}#${year}`,
    });
    return handlerHelpers.createResponse(200, {
      quests: (userItem && userItem.quests) || {},
    });
  } catch (err: unknown) {
    console.error(err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error",
    });
  }
};

export const getQuestsByEvent = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    if (
      !event.pathParameters ||
      !event.pathParameters.event_id ||
      !event.pathParameters.year
    ) {
      return handlerHelpers.createResponse(400, {
        message: "missing path parameters",
      });
    }

    const userID =
      event.requestContext.authorizer?.claims?.email?.toLowerCase() as string;
    if (!userID.endsWith("@ubcbiztech.com")) {
      return handlerHelpers.createResponse(401, { message: "Unauthorized" });
    }

    const { event_id, year } = event.pathParameters;
    const eventKey = `${event_id}#${year}`;

    const items = await db.scan(
      QUESTS_TABLE,
      {
        FilterExpression: "#eventquery = :eventKey",
        ExpressionAttributeNames: {
          "#eventquery": "eventID#year",
        },
        ExpressionAttributeValues: {
          ":eventKey": eventKey,
        },
      },
      "event-query",
    );

    const quests = items.map((item) => ({
      userId: item.id,
      quests: item.quests || {},
    }));

    return handlerHelpers.createResponse(200, {
      quests,
    });
  } catch (err: unknown) {
    console.error(err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error",
    });
  }
};

async function resolveEmailFromProfileId(
  profileId: string,
): Promise<string | null> {
  if (!profileId) return null;

  try {
    const results = await db.query(USERS_TABLE, "profileID-index", {
      expression: "#profileID = :profileID",
      expressionNames: {
        "#profileID": "profileID",
      },
      expressionValues: {
        ":profileID": profileId,
      },
    });

    if (results && results.length > 0 && results[0]?.id) {
      return String(results[0].id).toLowerCase();
    }
  } catch (err: unknown) {
    console.error(`resolveEmailFromProfileId failed for ${profileId}:`, err);
  }

  return null;
}

export const getQuestKiosk = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => {
  try {
    const p = event.pathParameters || {};
    const event_id = p.event_id;
    const year = p.year;
    const profileId = p.profileId;

    if (!event_id || !year || !profileId) {
      return handlerHelpers.createResponse(400, {
        message: "missing path parameters",
      });
    }

    const eventKey = `${event_id}#${year}`;

    const email = await resolveEmailFromProfileId(profileId);

    if (email) {
      const byEmail = await db.getOne(email, QUESTS_TABLE, {
        "eventID#year": eventKey,
      });
      if (byEmail?.quests) {
        return handlerHelpers.createResponse(200, {
          quests: byEmail.quests || {},
          resolvedUser: "email",
          resolvedEmail: email,
        });
      }
    }

    const byProfileId = await db.getOne(profileId, QUESTS_TABLE, {
      "eventID#year": eventKey,
    });
    if (byProfileId?.quests) {
      return handlerHelpers.createResponse(200, {
        quests: byProfileId.quests || {},
        resolvedUser: "profileId",
      });
    }

    const newQuests = Object.entries(QUEST_DEFS).reduce(
      (acc, [id, def]) => {
        acc[id] = initStoredQuest(def, Date.now());
        return acc;
      },
      {} as Record<string, unknown>,
    );

    const writeId = email || profileId;

    await db.put(
      {
        id: writeId,
        "eventID#year": eventKey,
        quests: newQuests,
      },
      QUESTS_TABLE,
      true,
    );

    return handlerHelpers.createResponse(200, {
      quests: newQuests,
      resolvedUser: email ? "initialized-email" : "initialized-profileId",
      resolvedEmail: email || null,
    });
  } catch (err: unknown) {
    console.error("getQuestKiosk error:", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error",
    });
  }
};
