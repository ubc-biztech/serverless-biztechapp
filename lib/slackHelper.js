/**
 * Shared Slack Web API client, alongside snsHelper as a cross-service notification client.
 *
 * slackApi never throws — it logs and returns undefined on a bad token, a non-ok Slack
 * response, or a network error — so callers can await it from inside a request path
 * without a Slack outage failing the request.
 */

/** Reads SLACK_BOT_TOKEN, tolerating stray quotes/whitespace from CI secret plumbing. */
export function getSlackBotToken() {
  const cleaned = String(process.env.SLACK_BOT_TOKEN || "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (!cleaned) return "";
  // Extract a valid Slack token and ignore accidental extra text/characters.
  const tokenMatch = cleaned.match(/xox[baprs]-[A-Za-z0-9-]+/);
  const token = tokenMatch ? tokenMatch[0] : "";
  if (!token) return "";
  if (/[^\x20-\x7E]/.test(token)) return "";
  return token;
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

/** No-ops when the channel is unset so local dev and tests run without a workspace. */
export async function postSlackMessage({ channel, text, blocks }) {
  if (!channel) return;
  return slackApi("POST", "chat.postMessage", { channel, text, blocks });
}
