import nacl from "tweetnacl";
import fetch from "node-fetch";
import { 
  InteractionResponseType, 
} from "discord-interactions";

export async function DiscordRequest(endpoint, options) {
  const url = "https://discord.com/api/v10/" + endpoint;
  if (options.body) options.body = JSON.stringify(options.body);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      "Content-Type": "application/json; charset=UTF-8",
      "User-Agent":
        "DiscordBot (https://github.com/discord/discord-example-app, 1.0.0)"
    },
    ...options
  });

  if (!res.ok) {
    const data = await res.json();
    console.log(res.status);
    throw new Error(JSON.stringify(data));
  }

  return res;
}

export function verifyRequestSignature(req) {
  let isValid = false;
  const signature = req.headers["X-Signature-Ed25519"];
  const timestamp = req.headers["X-Signature-Timestamp"];
  const body = req.body;

  if (!signature || !timestamp) {
    console.error("Missing signature or timestamp in request headers");
    return false
  }

  isValid = nacl.sign.detached.verify(
    Buffer.from(timestamp + body),
    Buffer.from(signature, "hex"),
    Buffer.from(process.env.DISCORD_PUBLIC_KEY, "hex")
  );

  return isValid;
}

// Handles application commands and routes them to the appropriate handler
// handlers should return a response object with statusCode and body
export function applicationCommandRouter(name, body) {
  const { member } = body;
  switch (name) {
    case "verify":
      return handleVerifyCommand(member);

    default:
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `Unknown command: /${data.name}`,
            flags: 64
          }
        })
      };
  }
}

// handles /verify slash command
function handleVerifyCommand(member) {
  const discordUserId = member?.user?.id

  console.log("User initiating verify:", discordUserId);

  const idpLoginUrl = `https://app.ubcbiztech.com/login?discordId=${discordUserId}`;

  // guard against use outside of a server
  if (!discordUserId) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "❌ This command can only be used in a server.",
          flags: 64
        }
      })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "🔐 Click below to verify your account.",
        flags: 64,
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: "Login with the UBC BizTech web app",
                url: idpLoginUrl
              }
            ]
          }
        ]
      }
    })
  };
}
