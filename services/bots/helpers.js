const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

const groups = {
  "@leads": [
    "grace",
    "pauline",
    "ethanx",
    "kevin",
    "john",
    "dhrishty",
    "mikayla",
    "lillian",
    "lucas"
  ],
  "@internal": [
    "mikayla",
    "erping",
    "ashley"
  ],
  "@experiences": [
    "pauline",
    "angela",
    "gautham",
    "jack",
    "allison",
    "danielz",
    "danielt",
    "chris"
  ],
  "@partnerships": [
    "john",
    "rohan",
    "darius",
    "jimmy",
    "keon",
    "karens",
    "angelaf"
  ],
  "@mmd": [
    "dhrishty",
    "riana",
    "emilyl",
    "stephanie",
    "ali",
    "yumin",
    "indy",
    "chelsea",
    "julianna"
  ],
  "@devs": [
    "kevin",
    "jay",
    "ethan",
    "benny",
    "kevinh",
    "isaac",
    "aurora",
    "alexg"
  ],
  "@data": [
    "ethanx",
    "hiro",
    "elena",
    "janaye"
  ]
};

async function slackApi(method, endpoint, body) {
  try {
    console.log("Token Slice:", SLACK_BOT_TOKEN.slice(0, 5), "...");
    const res = await fetch(`https://slack.com/api/${endpoint}`, {
      method,
      headers: {
        "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: body ? JSON.stringify(body) : undefined,
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

  const groupOptions = Object.keys(groups).map(group => ({
    text: {
      type: "plain_text",
      text: group,
      emoji: true,
    },
    value: group,
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
            text: "Ping Group",
          },
          submit: {
            type: "plain_text",
            text: "Send",
          },
          close: {
            type: "plain_text",
            text: "Cancel",
          },
          private_metadata: JSON.stringify({
            channel_id: body.channel.id,
            message_ts: body.message_ts,
            user_id: body.user.id,
          }),
          blocks: [
            {
              type: "input",
              block_id: "group_select",
              label: {
                type: "plain_text",
                text: "Select a group",
              },
              element: {
                type: "static_select",
                action_id: "selected_group",
                placeholder: {
                  type: "plain_text",
                  text: "Choose a group",
                },
                options: groupOptions,
              },
            },
          ],
        },
      });
  } catch (error) {
    console.error("Error opening modal:", error);
  }
}

export async function submitPingShortcut(body) {
  console.log("Submitting ping shortcut modal", body);
  if (body.type !== "view_submission" || body.view.callback_id !== "ping_modal_submit") {
    console.error("Invalid modal submission:", body);
    return;
  }
  try {
    // parse data from modal submission
    const metadata = JSON.parse(body.view.private_metadata);
    const group = body.view.state.values.group_select.selected_group.selected_option.value;
    const user = metadata.user_id;
    const channel = metadata.channel_id;
    const message_ts = metadata.message_ts;

    const members = groups[group] || [];

    const mentions = members.map(id => `<@${id}>`).join(" ");
    const message = `🔔 <@${user}> pinged *${group}*: ${mentions}`;

    // attempt to ping in thread
    await slackApi("POST", "chat.postMessage", {
      channel,
      thread_ts: message_ts,
      text: message,
    });
  } catch (error) {
    console.error("Error sending message:", error);
  }
}
