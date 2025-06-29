import { verifyKey } from "discord-interactions";
import fetch from "node-fetch";

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
  console.log(JSON.stringify(req));
  const signature = req.headers["X-Signature-Ed25519"];
  const timestamp = req.headers["X-Signature-Timestamp"];
  const body = req.body;

  if (!signature || !timestamp) {
    console.error("Missing signature or timestamp in request headers");
    return false
  }
  console.log("body", body);
  console.log("public key", process.env.DISCORD_PUBLIC_KEY);
  console.log("signature", signature);
  console.log("timestamp", timestamp);

  const isValid = verifyKey(
    body,
    signature,
    timestamp,
    process.env.DISCORD_PUBLIC_KEY
  );

  return isValid;
}