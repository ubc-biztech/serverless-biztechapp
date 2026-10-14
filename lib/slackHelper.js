/** Shared Slack Web API client. slackApi never throws — it logs and returns undefined. */

// Called inline in request paths, so fail fast rather than hold the handler open.
const SLACK_TIMEOUT_MS = 3000;

/** Reads SLACK_BOT_TOKEN, trimming stray quotes/whitespace from CI plumbing. */
export function getSlackBotToken() {
  return String(process.env.SLACK_BOT_TOKEN || "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

export async function slackApi(method, endpoint, body) {
  const SLACK_BOT_TOKEN = getSlackBotToken();
  if (!SLACK_BOT_TOKEN) {
    console.error("SLACK_BOT_TOKEN is missing or invalid.");
    return;
  }
  try {
    const res = await fetch(`https://slack.com/api/${endpoint}`, {
      method,
      headers: {
        "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS)
    });

    // 5xx responses are HTML, so res.json() would throw and mask the real cause.
    if (!res.ok) {
      console.error(
        `Slack HTTP error on ${endpoint}: ${res.status} ${res.statusText}`
      );
      return;
    }

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

/** No-ops when the channel is unset so local dev and tests run without a workspace. */
export async function postSlackMessage({ channel, text, blocks }) {
  if (!channel) return;
  return slackApi("POST", "chat.postMessage", { channel, text, blocks });
}
