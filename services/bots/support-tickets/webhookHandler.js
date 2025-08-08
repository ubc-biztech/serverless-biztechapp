import { createTicket } from "./handler.js";
import { DiscordRequest, verifyRequestSignature } from "../helpersDiscord.js";

export const processSupportChannelMessage = async (event, ctx, callback) => {
  try {
    if (!verifyRequestSignature(event)) {
      console.error("Invalid webhook signature");
      return callback(null, {
        statusCode: 401,
        body: JSON.stringify({
          error: "Invalid webhook signature"
        })
      });
    }

    const body = JSON.parse(event.body);
    
    if (body.t !== 'MESSAGE_CREATE') {
      return callback(null, {
        statusCode: 200,
        body: JSON.stringify({ message: "Ignored non-message event" })
      });
    }

    const message = body.d;
    
    const supportChannelId = process.env.SUPPORT_TICKETS_CHANNEL_ID;
    if (message.channel_id !== supportChannelId) {
      return callback(null, {
        statusCode: 200,
        body: JSON.stringify({ message: "Not from support channel" })
      });
    }

    if (message.author.bot) {
      return callback(null, {
        statusCode: 200,
        body: JSON.stringify({ message: "Ignored bot message" })
      });
    }

    const discordId = message.author.id;
    const username = message.author.username;
    const content = message.content;

    if (content.startsWith('/')) {
      return processCommand(message, callback);
    }

    const ticketData = {
      user_id: discordId,
      message: content,
      discord_id: discordId,
      username: username
    };

    const mockEvent = {
      body: JSON.stringify(ticketData)
    };

    const result = await createTicket(mockEvent, ctx, callback);

    await sendTicketConfirmation(message.channel_id, ticketData);

    return callback(null, {
      statusCode: 200,
      body: JSON.stringify({
        message: "Support ticket created successfully",
        ticket_id: result.ticket_id
      })
    });

  } catch (error) {
    console.error("Error processing support channel message:", error);
    return callback(null, {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to process message"
      })
    });
  }
};

async function processCommand(message, callback) {
  const content = message.content;
  const args = content.slice(1).trim().split(' ');
  const command = args[0].toLowerCase();

  switch (command) {
    case 'help':
      return await sendHelpMessage(message.channel_id, callback);
    
    case 'status':
      return await sendStatusMessage(message.channel_id, callback);
    
    default:
      return callback(null, {
        statusCode: 200,
        body: JSON.stringify({
          message: "Unknown command"
        })
      });
  }
}

async function sendHelpMessage(channelId, callback) {
  try {
    const embed = {
      title: "🎫 Support Ticket System Help",
      color: 0x0099ff,
      description: "Here's how to use the support ticket system:",
      fields: [
        {
          name: "Creating a Ticket",
          value: "Simply send a message in this channel describing your issue. One ticket per user at a time.",
          inline: false
        },
        {
          name: "Available Commands",
          value: "• `/help` - Show this help message\n• `/status` - Check your ticket status",
          inline: false
        },
        {
          name: "What Happens Next",
          value: "Your ticket will be reviewed by our team. You'll receive updates via DM.",
          inline: false
        }
      ]
    };

    await DiscordRequest(`channels/${channelId}/messages`, {
      method: "POST",
      body: {
        embeds: [embed]
      }
    });

    return callback(null, {
      statusCode: 200,
      body: JSON.stringify({ message: "Help message sent" })
    });
  } catch (error) {
    console.error("Error sending help message:", error);
    return callback(null, {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to send help message" })
    });
  }
}

async function sendStatusMessage(channelId, callback) {
  try {
    const embed = {
      title: "📊 Support Ticket Status",
      color: 0x00ff00,
      description: "To check your ticket status, please use the `/support` command in any channel or check your DMs for updates.",
      fields: [
        {
          name: "Need Help?",
          value: "Use `/help` to see available commands and how the system works.",
          inline: false
        }
      ]
    };

    await DiscordRequest(`channels/${channelId}/messages`, {
      method: "POST",
      body: {
        embeds: [embed]
      }
    });

    return callback(null, {
      statusCode: 200,
      body: JSON.stringify({ message: "Status message sent" })
    });
  } catch (error) {
    console.error("Error sending status message:", error);
    return callback(null, {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to send status message" })
    });
  }
}

async function sendTicketConfirmation(channelId, ticketData) {
  try {
    const embed = {
      title: "✅ Support Ticket Created",
      color: 0x00ff00,
      description: "Your support ticket has been created successfully!",
      fields: [
        {
          name: "Next Steps",
          value: "Our team will review your ticket and respond via DM. Please be patient.",
          inline: false
        },
        {
          name: "Reminder",
          value: "You can only have one open ticket at a time. Please wait for a response before creating a new ticket.",
          inline: false
        }
      ],
      timestamp: new Date().toISOString()
    };

    await DiscordRequest(`channels/${channelId}/messages`, {
      method: "POST",
      body: {
        embeds: [embed]
      }
    });
  } catch (error) {
    console.error("Error sending ticket confirmation:", error);
  }
}
