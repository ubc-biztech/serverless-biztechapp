import {
  answerDocsQuestion,
  getProjectBoard,
  openPingShortcut,
  runLeaderboardCommand,
  runScoreCommand,
  slackApi,
  sendIssueReminders as sendIssueReminders,
  submitPingShortcut,
  summarizeRecentMessages
} from "./helpersSlack.js";
import {
  InvokeCommand,
  LambdaClient
} from "@aws-sdk/client-lambda";

import {
  ack
} from "./constants.js";

const processedEventIds = new Set();
const lambdaClient = new LambdaClient({});

async function enqueueSlackTask(task, payload) {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;

  // Local/non-Lambda fallback keeps behavior working in local scripts.
  if (!functionName) {
    if (task === "summarize") {
      await summarizeRecentMessages(payload);
      return;
    }
    if (task === "docs_answer") {
      await answerDocsQuestion(payload);
      return;
    }
    throw new Error(`Unsupported local task: ${task}`);
  }

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(
        JSON.stringify({
          internalTask: task,
          payload
        }),
        "utf8"
      )
    })
  );
}

async function enqueueSummarizeJob(body) {
  await enqueueSlackTask("summarize", {
    channel_id: body.channel_id,
    thread_ts: body.thread_ts || null,
    response_url: body.response_url || null
  });
}

async function enqueueDocsAnswerJob(event) {
  await enqueueSlackTask("docs_answer", {
    channel_id: event.channel,
    thread_ts: event.thread_ts || event.ts,
    response_url: null,
    question: String(event.text || "").replace(/<@[^>]+>/g, "").trim()
  });
}

async function enqueueThreadSummarizeJob(body) {
  await enqueueSlackTask("summarize", {
    channel_id: body.channel.id,
    thread_ts: body.message.thread_ts || body.message_ts,
    response_url: body.response_url
  });
}

// router
export const shortcutHandler = async (event, ctx, callback) => {
  if (event?.internalTask === "summarize") {
    await summarizeRecentMessages(event.payload || {});
    return;
  }
  if (event?.internalTask === "docs_answer") {
    await answerDocsQuestion(event.payload || {});
    return ack;
  }

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
    try {
      await enqueueSummarizeJob(body);
    } catch (error) {
      console.error("Failed to enqueue summarize job:", error);
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          response_type: "ephemeral",
          text: "Could not start summary. Please try again."
        })
      };
    }

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

  if (body.command === "/score") {
    const response = await runScoreCommand(body);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(response)
    };
  }

  if (body.command === "/leaderboard") {
    const response = await runLeaderboardCommand();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(response)
    };
  }

  if (
    body.type === "event_callback" &&
    body.event &&
    body.event.type === "app_mention"
  ) {
    const event = body.event;
    const BOT_USER_ID = process.env.SLACK_BOT_USER_ID;

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

    await enqueueDocsAnswerJob(event);
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
    await enqueueThreadSummarizeJob(body);
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
