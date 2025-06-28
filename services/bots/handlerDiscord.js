import { InteractionResponseType, InteractionType } from "discord-interactions";
import handlerHelpers from "../../lib/handlerHelpers";
import { DiscordRequest } from "./helpersDiscord";

const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

export const interactions = (event, ctx, callback) => {
  const body = JSON.parse(event.body);
  handlerHelpers.checkPayloadProps(body, {
    id: {
      required: true
    },
    type: {
      required: true,
      type: "string"
    },
    data: {
      required: true
    }
  });

  const { id, type, data } = body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  //stub
};

export const webhook = (event, ctx, callback) => {
  //stub
};
