import {
  answerDocsQuestion,
  getProjectBoard,
  openPingShortcut,
  slackApi,
  sendIssueReminders as sendIssueReminders,
  submitPingShortcut,
  summarizeRecentMessages
} from "./helpersSlack.js";

import {
  ack
} from "./constants.js";

const processedEventIds = new Set();

// router
export const shortcutHandler = async (event, ctx, callback) => {
  let body;

  if (event.headers["X-Slack-Retry-Num"]) {
    return {
      statusCode: 200,
      body: ""
    };
  }

  if (event.headers["Content-Type"] === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams(event.body);
    const payload = params.get("payload");
    if (payload) {
      body = JSON.parse(payload);
    } else {
      body = Object.fromEntries(params);
    }
  } else {
    body = JSON.parse(event.body);
  }

  if (body.command === "/summarize") {
    summarizeRecentMessages(body);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: "Generating summary..."
      })
    };
  }

  if (
    body.type === "event_callback" &&
    body.event &&
    body.event.type === "app_mention"
  ) {
    const event = body.event;
    const BOT_USER_ID = process.env.BOT_USER_ID;

    if (event.user === BOT_USER_ID) {
      // Bot is the author, ignoring to avoid loops
      return ack;
    }

    if (processedEventIds.has(body.event_id)) {
      return ack;
    }
    processedEventIds.add(body.event_id);

    if (processedEventIds.size > 1000) {
      // remove oldest key
      const [first] = processedEventIds;
      processedEventIds.delete(first);
    }

    const wantsSummary = /summarize/i.test(event.text);
    const question = String(event.text || "").replace(/<@[^>]+>/g, "").trim();

    await slackApi("POST", "reactions.add", {
      channel: event.channel,
      name: "hourglass",
      timestamp: event.ts
    }).catch(() => {});

    if (wantsSummary) {
      await summarizeRecentMessages({
        channel_id: event.channel,
        thread_ts: event.thread_ts,
        response_url: null
      });
      return ack;
    }

    await answerDocsQuestion({
      channel_id: event.channel,
      thread_ts: event.thread_ts || event.ts,
      response_url: null,
      question
    });
    return ack;
  }

  if (!body || !body.type) {
    console.error("Invalid request body", body);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Invalid request body"
      })
    };
  }

  // url verification
  if (body.type === "url_verification") {
    return {
      statusCode: 200,
      body: JSON.stringify({
        challenge: body.challenge
      })
    };
  }

  // ping shortcut
  if (body.type === "message_action" && body.callback_id === "ping") {
    await openPingShortcut(body);
    return ack;
  }

  if (
    body.type === "message_action" &&
    body.callback_id === "summarize_thread"
  ) {
    await summarizeRecentMessages({
      channel_id: body.channel.id,
      thread_ts: body.message.thread_ts || body.message_ts, // handle both
      response_url: body.response_url
    });
    return ack;
  }

  if (
    body.type === "view_submission" &&
    body.view.callback_id === "ping_modal_submit"
  ) {
    await submitPingShortcut(body);
    return ack;
  }

  return ack;
};

export const slackGithubReminder = async (event, ctx, callback) => {
  const projectBoard = await getProjectBoard();
  sendIssueReminders(projectBoard);
  return ack;
};
