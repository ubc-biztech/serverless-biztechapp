import {
  getProjectBoard,
  openPingShortcut,
  slackApi,
  sendIssueReminders as sendIssueReminders,
  submitPingShortcut,
  summarizeRecentMessages
} from "./helpers.js";

const ack = {
  statusCode: 200,
  body: ""
};

const processedEventIds = new Set();

// router
export const shortcutHandler = async (event, ctx, callback) => {
  let body;

  if (event.headers["X-Slack-Retry-Num"]) {
    callback(null, {
      statusCode: 200,
      body: ""
    });
    return;
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
    callback(null, {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: "Generating summary..."
      })
    });

    summarizeRecentMessages(body);
    return;
  }

  if (
    body.type === "event_callback" &&
    body.event &&
    body.event.type === "app_mention"
  ) {
    callback(null, ack);

    const event = body.event;
    const BOT_USER_ID = process.env.BOT_USER_ID;

    if (event.user === BOT_USER_ID) {
      // Bot is the author, ignoring to avoid loops
      return;
    }

    if (processedEventIds.has(body.event_id)) {
      return;
    }
    processedEventIds.add(body.event_id);

    if (processedEventIds.size > 1000) {
      // remove oldest key
      const [first] = processedEventIds;
      processedEventIds.delete(first);
    }

    const wantsSummary = /summarize/i.test(event.text);
    if (!wantsSummary) return;

    const opts = {
      channel_id: event.channel,
      thread_ts: event.thread_ts,
      response_url: null
    };

    await slackApi("POST", "reactions.add", {
      channel: event.channel,
      name: "hourglass",
      timestamp: event.ts
    }).catch(() => {});

    await summarizeRecentMessages(opts);
    return;
  }

  if (!body || !body.type) {
    console.error("Invalid request body", body);
    callback(null, {
      statusCode: 400,
      body: JSON.stringify({
        error: "Invalid request body"
      })
    });
    return;
  }

  // url verification
  if (body.type === "url_verification") {
    callback(null, {
      statusCode: 200,
      body: JSON.stringify({
        challenge: body.challenge
      })
    });
    return;
  }

  // ping shortcut
  if (body.type === "message_action" && body.callback_id === "ping") {
    callback(null, ack);
    openPingShortcut(body);
    return;
  }

  if (
    body.type === "message_action" &&
    body.callback_id === "summarize_thread"
  ) {
    callback(null, ack);
    await summarizeRecentMessages({
      channel_id: body.channel.id,
      thread_ts: body.message.thread_ts || body.message_ts, // handle both
      response_url: body.response_url
    });
    return;
  }

  if (
    body.type === "view_submission" &&
    body.view.callback_id === "ping_modal_submit"
  ) {
    callback(null, ack);
    submitPingShortcut(body);
    return;
  }

  callback(null, ack);
};

export const slackGithubReminder = async (event, ctx, callback) => {
  const projectBoard = await getProjectBoard();
  sendIssueReminders(projectBoard);
  callback(null);
};
