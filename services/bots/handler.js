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
    callback(null, {
      statusCode: 400,
      body: JSON.stringify({
        error: "Invalid request body",
      }),
    });
    return;
  }

  // url verification
  if (body.type === "url_verification") {
    callback(null, 
      {statusCode: 200, 
        body: JSON.stringify({
          challenge: body.challenge
        })})
    return;
  }

  // ping shortcut
  if (body.type === "message_action" && body.callback_id === "ping") {
    callback(null, ack)
    openPingShortcut(body);
    return;
  }

  if (body.type === "view_submission" && body.view.callback_id === "ping_modal_submit") {
    callback(null, ack)
    openPingShortcut(body);
    return;
  }

  callback(null, ack)
};
