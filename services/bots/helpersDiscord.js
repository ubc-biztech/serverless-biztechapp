import nacl from "tweetnacl";
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
  let isValid = false;
  const signature = req.headers["X-Signature-Ed25519"];
  const timestamp = req.headers["X-Signature-Timestamp"];
  const body = req.body;

  if (!signature || !timestamp) {
    console.error("Missing signature or timestamp in request headers");
    return false
  }

  try {
    isValid = nacl.sign.detached.verify(
      Buffer.from(timestamp + body),
      Buffer.from(signature, "hex"),
      Buffer.from(process.env.DISCORD_PUBLIC_KEY, "hex")
    );
  } catch (error) {
    console.error("Error verifying signature:", error);
    return false;
  }

  return isValid;
}