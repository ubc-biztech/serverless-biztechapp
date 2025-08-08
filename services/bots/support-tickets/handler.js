import db from "../../../lib/db.js";
import handlerHelpers from "../../../lib/handlerHelpers.js";
import { DiscordRequest } from "../helpersDiscord.js";
import { SUPPORT_TICKETS_TABLE } from "../../../constants/tables.js";
import { v4 as uuidv4 } from "uuid";

export const TICKET_STATUS = {
  OPEN: "open",
  IN_PROGRESS: "in_progress", 
  RESOLVED: "resolved",
  CLOSED: "closed"
};

export const createTicket = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);
    
    handlerHelpers.checkPayloadProps(data, {
      user_id: {
        required: true,
        type: "string"
      },
      message: {
        required: true,
        type: "string"
      },
      discord_id: {
        required: true,
        type: "string"
      },
      username: {
        required: true,
        type: "string"
      }
    });

    const { user_id, message, discord_id, username } = data;
    
    const existingTickets = await db.query(SUPPORT_TICKETS_TABLE, null, {
      expression: "user_id = :user_id AND #status = :status",
      expressionValues: { ":user_id": user_id, ":status": TICKET_STATUS.OPEN },
      expressionNames: { "#status": "status" }
    });

    if (existingTickets.length > 0) {
      return callback(null, handlerHelpers.createResponse(409, {
        message: "User already has an open ticket",
        ticket_id: existingTickets[0].ticket_id
      }));
    }

    const ticket_id = uuidv4();
    const now = new Date().toISOString();
    
    const ticket = {
      ticket_id,
      user_id,
      discord_id,
      username,
      message,
      status: TICKET_STATUS.OPEN,
      created: now,
      last_updated: now,
      responses: []
    };

    await db.put(ticket, SUPPORT_TICKETS_TABLE);

    await notifyExecsChannel(ticket);

    return callback(null, handlerHelpers.createResponse(201, {
      message: "Support ticket created successfully",
      ticket_id,
      ticket
    }));

  } catch (error) {
    console.error("Error creating ticket:", error);
    return callback(null, handlerHelpers.createResponse(500, {
      message: "Failed to create support ticket",
      error: error.message
    }));
  }
};

export const getTickets = async (event, ctx, callback) => {
  try {
    const { status } = event.queryStringParameters || {};
    
    let tickets;
    if (status && Object.values(TICKET_STATUS).includes(status)) {
      tickets = await db.query(SUPPORT_TICKETS_TABLE, null, {
        expression: "#status = :status",
        expressionValues: { ":status": status },
        expressionNames: { "#status": "status" }
      });
    } else {
      tickets = await db.scan(SUPPORT_TICKETS_TABLE);
    }

    tickets.sort((a, b) => new Date(b.created) - new Date(a.created));

    return callback(null, handlerHelpers.createResponse(200, {
      tickets,
      count: tickets.length
    }));

  } catch (error) {
    console.error("Error getting tickets:", error);
    return callback(null, handlerHelpers.createResponse(500, {
      message: "Failed to get tickets",
      error: error.message
    }));
  }
};

export const getTicket = async (event, ctx, callback) => {
  try {
    const { ticket_id } = event.pathParameters;
    
    if (!ticket_id) {
      return callback(null, handlerHelpers.createResponse(400, {
        message: "Ticket ID is required"
      }));
    }

    const ticket = await db.getOne(ticket_id, SUPPORT_TICKETS_TABLE);
    
    if (!ticket) {
      return callback(null, handlerHelpers.createResponse(404, {
        message: "Ticket not found"
      }));
    }

    return callback(null, handlerHelpers.createResponse(200, {
      ticket
    }));

  } catch (error) {
    console.error("Error getting ticket:", error);
    return callback(null, handlerHelpers.createResponse(500, {
      message: "Failed to get ticket",
      error: error.message
    }));
  }
};

export const addResponse = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);
    
    handlerHelpers.checkPayloadProps(data, {
      ticket_id: {
        required: true,
        type: "string"
      },
      response: {
        required: true,
        type: "string"
      },
      responder_id: {
        required: true,
        type: "string"
      },
      responder_name: {
        required: true,
        type: "string"
      },
      is_exec: {
        required: true,
        type: "boolean"
      }
    });

    const { ticket_id, response, responder_id, responder_name, is_exec } = data;

    const ticket = await db.getOne(ticket_id, SUPPORT_TICKETS_TABLE);
    
    if (!ticket) {
      return callback(null, handlerHelpers.createResponse(404, {
        message: "Ticket not found"
      }));
    }

    if (ticket.status === TICKET_STATUS.RESOLVED || ticket.status === TICKET_STATUS.CLOSED) {
      return callback(null, handlerHelpers.createResponse(400, {
        message: "Cannot add response to resolved/closed ticket"
      }));
    }

    const newResponse = {
      id: uuidv4(),
      message: response,
      responder_id,
      responder_name,
      is_exec,
      timestamp: new Date().toISOString()
    };

    const updatedTicket = {
      ...ticket,
      responses: [...(ticket.responses || []), newResponse],
      last_updated: new Date().toISOString(),
      status: is_exec ? TICKET_STATUS.IN_PROGRESS : ticket.status
    };

    await db.updateDB(ticket_id, updatedTicket, SUPPORT_TICKETS_TABLE);

    if (is_exec) {
      await sendResponseToUser(ticket, newResponse);
    }

    return callback(null, handlerHelpers.createResponse(200, {
      message: "Response added successfully",
      response: newResponse
    }));

  } catch (error) {
    console.error("Error adding response:", error);
    return callback(null, handlerHelpers.createResponse(500, {
      message: "Failed to add response",
      error: error.message
    }));
  }
};

export const updateTicketStatus = async (event, ctx, callback) => {
  try {
    const data = JSON.parse(event.body);
    
    handlerHelpers.checkPayloadProps(data, {
      ticket_id: {
        required: true,
        type: "string"
      },
      status: {
        required: true,
        type: "string"
      },
      exec_id: {
        required: true,
        type: "string"
      },
      exec_name: {
        required: true,
        type: "string"
      }
    });

    const { ticket_id, status, exec_id, exec_name } = data;

    if (!Object.values(TICKET_STATUS).includes(status)) {
      return callback(null, handlerHelpers.createResponse(400, {
        message: "Invalid status"
      }));
    }

    const ticket = await db.getOne(ticket_id, SUPPORT_TICKETS_TABLE);
    
    if (!ticket) {
      return callback(null, handlerHelpers.createResponse(404, {
        message: "Ticket not found"
      }));
    }

    const updatedTicket = {
      ...ticket,
      status,
      last_updated: new Date().toISOString()
    };

    await db.updateDB(ticket_id, updatedTicket, SUPPORT_TICKETS_TABLE);

    await sendStatusUpdateToUser(ticket, status, exec_name);

    return callback(null, handlerHelpers.createResponse(200, {
      message: "Ticket status updated successfully",
      status
    }));

  } catch (error) {
    console.error("Error updating ticket status:", error);
    return callback(null, handlerHelpers.createResponse(500, {
      message: "Failed to update ticket status",
      error: error.message
    }));
  }
};

export const getUserTickets = async (event, ctx, callback) => {
  try {
    const { user_id } = event.pathParameters;
    
    if (!user_id) {
      return callback(null, handlerHelpers.createResponse(400, {
        message: "User ID is required"
      }));
    }

    const tickets = await db.query(SUPPORT_TICKETS_TABLE, null, {
      expression: "user_id = :user_id",
      expressionValues: { ":user_id": user_id }
    });

    tickets.sort((a, b) => new Date(b.created) - new Date(a.created));

    return callback(null, handlerHelpers.createResponse(200, {
      tickets,
      count: tickets.length
    }));

  } catch (error) {
    console.error("Error getting user tickets:", error);
    return callback(null, handlerHelpers.createResponse(500, {
      message: "Failed to get user tickets",
      error: error.message
    }));
  }
};

export async function notifyExecsChannel(ticket) {
  try {
    const execChannelId = process.env.SUPPORT_TICKETS_EXEC_CHANNEL_ID;
    if (!execChannelId) {
      console.warn("SUPPORT_TICKETS_EXEC_CHANNEL_ID not configured");
      return;
    }

    const embed = {
      title: "🆕 New Support Ticket",
      color: 0x00ff00,
      fields: [
        {
          name: "Ticket ID",
          value: ticket.ticket_id,
          inline: true
        },
        {
          name: "User",
          value: `${ticket.username} (${ticket.discord_id})`,
          inline: true
        },
        {
          name: "Status",
          value: ticket.status.toUpperCase(),
          inline: true
        },
        {
          name: "Message",
          value: ticket.message.length > 1024 ? 
            ticket.message.substring(0, 1021) + "..." : 
            ticket.message
        }
      ],
      timestamp: ticket.created
    };

    await DiscordRequest(`channels/${execChannelId}/messages`, {
      method: "POST",
      body: {
        embeds: [embed]
      }
    });
  } catch (error) {
    console.error("Error notifying execs channel:", error);
  }
}

export async function sendResponseToUser(ticket, response) {
  try {
    const embed = {
      title: "📬 Response to Your Support Ticket",
      color: 0x0099ff,
      fields: [
        {
          name: "Ticket ID",
          value: ticket.ticket_id,
          inline: true
        },
        {
          name: "Responded by",
          value: response.responder_name,
          inline: true
        },
        {
          name: "Response",
          value: response.message.length > 1024 ? 
            response.message.substring(0, 1021) + "..." : 
            response.message
        }
      ],
      timestamp: response.timestamp
    };

    await DiscordRequest(`users/@me/channels`, {
      method: "POST",
      body: {
        recipient_id: ticket.discord_id
      }
    }).then(async (channel) => {
      await DiscordRequest(`channels/${channel.id}/messages`, {
        method: "POST",
        body: {
          embeds: [embed]
        }
      });
    });
  } catch (error) {
    console.error("Error sending response to user:", error);
  }
}

export async function sendStatusUpdateToUser(ticket, status, execName) {
  try {
    const statusEmoji = {
      [TICKET_STATUS.OPEN]: "🟡",
      [TICKET_STATUS.IN_PROGRESS]: "🔵", 
      [TICKET_STATUS.RESOLVED]: "🟢",
      [TICKET_STATUS.CLOSED]: "⚫"
    };

    const embed = {
      title: "📋 Ticket Status Update",
      color: status === TICKET_STATUS.RESOLVED ? 0x00ff00 : 0x0099ff,
      fields: [
        {
          name: "Ticket ID",
          value: ticket.ticket_id,
          inline: true
        },
        {
          name: "New Status",
          value: `${statusEmoji[status]} ${status.toUpperCase()}`,
          inline: true
        },
        {
          name: "Updated by",
          value: execName,
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    };

    await DiscordRequest(`users/@me/channels`, {
      method: "POST",
      body: {
        recipient_id: ticket.discord_id
      }
    }).then(async (channel) => {
      await DiscordRequest(`channels/${channel.id}/messages`, {
        method: "POST",
        body: {
          embeds: [embed]
        }
      });
    });
  } catch (error) {
    console.error("Error sending status update to user:", error);
  }
}
