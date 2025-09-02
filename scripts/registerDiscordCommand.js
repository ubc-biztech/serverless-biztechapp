import fetch from "node-fetch";

const setting = "LIST"; // one of: LIST, LOCAL, GLOBAL

const APP_ID = process.env.DISCORD_APPLICATION_ID;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = "1388652277178302576";

const command = {
  name: "verify",
  description: "Start the verification process",
  type: 1
};

switch (setting) {
  case "LIST":
    listCommands();
    break;
  case "LOCAL":
    fetch(
      `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${DISCORD_TOKEN}`
        },
        body: JSON.stringify(command)
      }
    );
    break;
  case "GLOBAL":
    fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${DISCORD_TOKEN}`
      },
      body: JSON.stringify(command)
    });
    break;
  default:
    throw new Error("Invalid setting");
}

async function listCommands() {
  const res = await fetch(
    `https://discord.com/api/v10/applications/${APP_ID}/commands`,
    {
      method: "GET",
      headers: {
        Authorization: `Bot ${DISCORD_TOKEN}`
      }
    }
  );

  const commands = await res.json();
  console.log("Registered commands:");
  console.log(JSON.stringify(commands, null, 2));
}
