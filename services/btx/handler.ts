// services/btx/handler.ts
// PR1: foundation routes only. Market reads → PR2; async trades/WS auth → PR3.

import helpers from "../../lib/handlerHelpers";
import { protect, Access } from "../../lib/auth";
import type { APIGatewayResponse } from "../../lib/types";

import {
  BtxError,
  saveSocketConnection,
  removeSocketConnection,
  listProjectsForEvent
} from "./helpers";

/** Map expected domain failures; anything else is a 500. */
const clientError = (error: unknown, fallback: string): APIGatewayResponse => {
  if (error instanceof BtxError) {
    return helpers.createResponse(error.statusCode, {
      message: error.message,
      ...(error.data ? { data: error.data } : {})
    });
  }
  console.error(error);
  return helpers.createResponse(500, { message: fallback });
};

/** Company listings for the configured KickStart event. */
export const getProjects = protect(Access.PUBLIC, async () => {
  try {
    const eventId = process.env.KICKSTART_EVENT_KEY!;
    const projects = await listProjectsForEvent();

    return helpers.createResponse(200, {
      message: `BTX projects for event ${eventId}`,
      data: projects
    });
  } catch (err) {
    return clientError(err, "Internal server error (BTX getProjects)");
  }
});

/**
 * Read-only market snapshot. GET never mutates prices.
 * Seed/IPO fields and scheduled noise land in later PRs.
 */
export const getMarketSnapshot = protect(Access.PUBLIC, async () => {
  try {
    const eventId = process.env.KICKSTART_EVENT_KEY!;
    const serverTime = Date.now();
    const projects = await listProjectsForEvent();

    const enriched = projects.map((p) => {
      const price = Number(p.currentPrice || p.basePrice || 0);
      const netShares = Number(p.netShares || 0);
      const marketCap = price * Math.max(Math.abs(netShares), 1);
      return {
        ...p,
        marketCap
      };
    });

    enriched.sort((a, b) => b.marketCap - a.marketCap);

    return helpers.createResponse(200, {
      message: `BTX market snapshot for ${eventId}`,
      data: {
        eventId,
        serverTime,
        projects: enriched
      }
    });
  } catch (err) {
    return clientError(err, "Internal server error (BTX snapshot)");
  }
});

export const wsConnect = async (event: any) => {
  try {
    const connectionId = event.requestContext.connectionId;
    await saveSocketConnection({
      connectionId,
      eventId: process.env.KICKSTART_EVENT_KEY!,
      userId: "__anon__"
    });
    return { statusCode: 200, body: "connected" };
  } catch (err) {
    console.error("[BTX] wsConnect error", err);
    return { statusCode: 500, body: "connect failed" };
  }
};

export const wsDisconnect = async (event: any) => {
  try {
    const connectionId = event.requestContext.connectionId;
    await removeSocketConnection({ connectionId });
    return { statusCode: 200, body: "disconnected" };
  } catch (err) {
    console.error("[BTX] wsDisconnect error", err);
    return { statusCode: 500, body: "disconnect failed" };
  }
};

export const wsSubscribe = async (event: any) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body || "{}");
    const eventId = process.env.KICKSTART_EVENT_KEY!;
    // PR3 authenticates $connect and ignores client-supplied userId.
    const userId = body.userId || "__anon__";

    await saveSocketConnection({
      connectionId,
      eventId,
      userId
    });

    return { statusCode: 200, body: "subscribed" };
  } catch (err) {
    console.error("[BTX] wsSubscribe error", err);
    return { statusCode: 500, body: "subscribe failed" };
  }
};
