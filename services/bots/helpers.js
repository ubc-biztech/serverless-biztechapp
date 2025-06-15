import { groups, query } from "./constants.js";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";

export async function slackApi(method, endpoint, body) {
  const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
  try {
    console.log(
      "Token Slice:",
      SLACK_BOT_TOKEN ? "Token exists" : "token doesnt exist"
    );
    const res = await fetch(`https://slack.com/api/${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("Slack API Error occurred:", JSON.stringify(data));
      return;
    }
    return data;
  } catch (error) {
    console.error("Failed to call Slack API:", error);
  }
}

export async function openPingShortcut(body) {
  console.log("Opening ping shortcut modal", body);
  if (body.type !== "message_action" || body.callback_id !== "ping") {
    console.error("Invalid shortcut call:", body);
    return;
  }

  const groupOptions = Object.keys(groups).map((group) => ({
    text: {
      type: "plain_text",
      text: group,
      emoji: true
    },
    value: group
  }));

  // trigger modal
  try {
    await slackApi("POST", "views.open", {
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "ping_modal_submit",
        title: {
          type: "plain_text",
          text: "Ping Group"
        },
        submit: {
          type: "plain_text",
          text: "Send"
        },
        close: {
          type: "plain_text",
          text: "Cancel"
        },
        private_metadata: JSON.stringify({
          channel_id: body.channel.id,
          message_ts: body.message_ts,
          user_id: body.user.id
        }),
        blocks: [
          {
            type: "input",
            block_id: "group_select",
            label: {
              type: "plain_text",
              text: "Select a group"
            },
            element: {
              type: "static_select",
              action_id: "selected_group",
              placeholder: {
                type: "plain_text",
                text: "Choose a group"
              },
              options: groupOptions
            }
          }
        ]
      }
    });
  } catch (error) {
    console.error("Error opening modal:", error);
  }
}

export async function submitPingShortcut(body) {
  console.log("Submitting ping shortcut modal", body);
  if (
    body.type !== "view_submission" ||
    body.view.callback_id !== "ping_modal_submit"
  ) {
    console.error("Invalid modal submission:", body);
    return;
  }
  try {
    // parse data from modal submission
    const metadata = JSON.parse(body.view.private_metadata);
    const group =
      body.view.state.values.group_select.selected_group.selected_option.value;
    const user = metadata.user_id;
    const channel = metadata.channel_id;
    const message_ts = metadata.message_ts;

    const members = groups[group] || [];

    const mentions = members.map((id) => `<@${id}>`).join(" ");
    const message = `🔔 <@${user}> pinged *${group}*: ${mentions}`;

    // attempt to ping in thread
    await slackApi("POST", "chat.postMessage", {
      channel,
      thread_ts: message_ts,
      text: message
    });
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

export async function summarizeRecentMessages(opts) {
  const { channel_id, thread_ts, response_url } = opts;
  const BOT_USER_ID = process.env.BOT_USER_ID;

  const messages = thread_ts
    ? await fetchThreadMessages(channel_id, thread_ts)
    : await fetchRecentMessages(channel_id);
  if (!messages || messages.length === 0) {
    await respondToSlack(
      response_url,
      "Couldn’t find any recent messages to summarize."
    );
    return;
  }

  const cleaned = messages.filter(
    (m) => m.text && !m.text.includes(`<@${BOT_USER_ID}>`)
  );

  const ordered = thread_ts ? cleaned : cleaned.reverse();

  const textBlob = ordered
    .map((m) => `• ${m.user ? `<@${m.user}>` : "Bot"}: ${m.text}`)
    .join("\n");

  const summary = await getSummaryFromOpenAI(textBlob);

  const reply = `📌 *Here’s your summary of the last ${messages.length} messages:*\n${summary}`;
  if (thread_ts) {
    await slackApi("POST", "chat.postMessage", {
      channel: channel_id,
      thread_ts,
      text: reply
    });
  } else {
    await respondToSlack(response_url, reply);
  }
}

export async function fetchRecentMessages(channel) {
  const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
  try {
    const res = await fetch(
      `https://slack.com/api/conversations.history?channel=${channel}&limit=100`,
      {
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`
        }
      }
    );
    const data = await res.json();
    if (!data.ok) {
      console.error("Failed to fetch messages:", data);
      return [];
    }
    // Filter out bot replies and empty text
    return data.messages.filter((m) => m.text && !m.subtype);
  } catch (err) {
    console.error("Error fetching channel history:", err);
    return [];
  }
}

export async function getSummaryFromOpenAI(text) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are a professional and helpful assistant. Summarize the following Slack thread in 5–10 concise bullet points. Include all messages—updates, decisions, casual banter, jokes, and side conversations—but do not describe who asked for a summary, or the overall tone. Just summarize what was actually said. Combine related messages from the same person. Keep each bullet short and expressive. Format as plain text, one bullet per point. When referring to people (in any scenario), keep their Slack mention (<@UXXXX>) exactly as written; never replace with the word “User”. Do not mention the bot (<@U08PQLSUEBD>) at all, even if it appears in the thread. The only exception is when users are explicitly discussing the bot’s development, functionality, or behaviour—in those cases, refer to it only as “the bot,” never by name or Slack mention. Do not summarize the bot’s responses, commands, or actions. You are neutral and professional—except when Isaac is mentioned, in which case you are mildly but irrationally very judgmental."
          },
          {
            role: "user",
            content: text
          }
        ]
      })
    });

    const data = await response.json();

    console.log("OpenAI raw response:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return `OpenAI error: ${
        data.error && data.error.message ? data.error.message : "Unknown error"
      }`;
    }

    const summary =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    return summary || "No summary returned.";
  } catch (err) {
    console.error("OpenAI call failed:", err);
    return "Exception calling OpenAI.";
  }
}

async function respondToSlack(response_url, message) {
  await fetch(response_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      response_type: "in_channel",
      text: message
    })
  });
}

export async function fetchThreadMessages(channel, thread_ts) {
  const result = await slackApi(
    "GET",
    `conversations.replies?channel=${channel}&ts=${thread_ts}&limit=100`
  );
  if (!result || !result.messages) {
    return [];
  }
  return result.messages.filter((m) => m.text && !m.subtype);
}

async function getGithubToken() {
  const GH_PRIVATE_KEY = process.env.GH_PRIVATE_KEY;
  const GH_CLIENT_ID = process.env.GH_CLIENT_ID;

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iat: now - 60,
    exp: now + 10 * 60,
    iss: GH_CLIENT_ID
  };

  const token = jwt.sign(payload, GH_PRIVATE_KEY, { algorithm: "RS256" });

  const authResponse = await fetch(
    `https://api.github.com/app/installations/71407901/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }
  );

  const auth = await authResponse.json();
  return auth.token;
}

export async function getProjectBoard() {
  let projects;

  try {
    const token = await getGithubToken();
    console.log(token);

    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        query
      })
    });
    projects = await response.json();
    console.log(JSON.stringify(projects, 2));
  } catch (error) {
    console.error(error);
  }

  return projects;
}
