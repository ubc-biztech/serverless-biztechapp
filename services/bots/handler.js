import {
  openPingShortcut, submitPingShortcut
} from "./helpers.js";

const ack = {
  statusCode: 200,
  body: "",
};

// router
export const shortcutHandler = async (event, ctx, callback) => {
  let body;

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

  if (!body || !body.type) {
    console.error("Invalid request body", body);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Invalid request body",
      }),
    };
  }

  // url verification
  if (body.type === "url_verification") {
    return {
      statusCode: 200,
      body: JSON.stringify({
        challenge: body.challenge
      }),
    };
  }

  // ping shortcut
  if (body.type === "message_action" && body.callback_id === "ping") {
    queueMicrotask(() => openPingShortcut(body));
    return ack;
  }

  if (body.type === "view_submission" && body.view.callback_id === "ping_modal_submit") {
    queueMicrotask(() => submitPingShortcut(body));
    return ack;
  }

  return ack;
};
