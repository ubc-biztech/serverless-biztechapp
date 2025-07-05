import { InteractionResponseType, InteractionType } from "discord-interactions";
import handlerHelpers from "../../lib/handlerHelpers.js";
import { DiscordRequest, verifyRequestSignature } from "./helpersDiscord.js";

const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

export const interactions = (event, ctx, callback) => {
  const body = JSON.parse(event.body);

  if (!verifyRequestSignature(event)) {
    console.error("Invalid request signature");
    return callback(null, {
      statusCode: 401,
      body: JSON.stringify({ error: "Invalid request signature" })
    });
  }

  handlerHelpers.checkPayloadProps(body, {
    id: {
      required: false
    },
    type: {
      required: true,
      type: "number"
    },
    data: {
      required: false
    }
  });

  const { id, type, data } = body;

  if (type === InteractionType.PING) {
    console.log("Received PING interaction");
    return callback(null, {
      statusCode: 200,
      body: JSON.stringify({ type: InteractionResponseType.PONG })
    });
  }

  //stub
};

export const webhook = (event, ctx, callback) => {
  //stub
};
