// services/btx/handler.js

import handlerHelpers from "../../lib/handlerHelpers";
import helpersLib from "../../lib/handlerHelpers";

import { DEFAULT_EVENT_ID } from "./constants";

import {
  saveSocketConnection,
  removeSocketConnection,
  executeTrade,
  createOrUpdateProject,
  applySeedUpdate,
  applyPhaseBump,
  listProjectsForEvent,
  getPortfolioForUser,
  getRecentTrades,
  isAdminUser,
  applyRandomDriftToProjects,
  getPriceHistoryForProject
} from "./helpers";

const helpers = helpersLib;

// HTTP handlers

export const getProjects = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const eventId = qs.eventId || DEFAULT_EVENT_ID;

    const projects = await listProjectsForEvent(eventId);

    return handlerHelpers.createResponse(200, {
      message: `BTX projects for event ${eventId}`,
      data: projects
    });
  } catch (err) {
    console.error("[BTX] getProjects error", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error (BTX getProjects)"
    });
  }
};

export const getMarketSnapshot = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const eventId = qs.eventId || DEFAULT_EVENT_ID;

    let projects = await listProjectsForEvent(eventId);

    // Apply a small random walk / mean-reverting drift
    projects = await applyRandomDriftToProjects(projects);

    console.log("[BTX] snapshot projects", projects.length);

    const enriched = projects.map((p) => {
      const price = Number(p.currentPrice || p.basePrice || 0);
      const volume = Number(p.totalVolume || 0);
      const netShares = Number(p.netShares || 0);
      const marketCap = price * Math.max(Math.abs(netShares), 1);
      return {
        ...p,
        marketCap
      };
    });

    enriched.sort((a, b) => b.marketCap - a.marketCap);

    return handlerHelpers.createResponse(200, {
      message: `BTX market snapshot for ${eventId}`,
      data: {
        projects: enriched
      }
    });
  } catch (err) {
    console.error("[BTX] getMarketSnapshot error", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error (BTX snapshot)"
    });
  }
};

export const postBuy = async (event) => {
  try {
    const isOffline = process.env.IS_OFFLINE === "true";

    let userId;
    if (isOffline) {
      userId = "local-user@btx";
    } else {
      const claims = event.requestContext?.authorizer?.claims;
      const email = claims?.email;
      if (!email) {
        return handlerHelpers.createResponse(401, {
          message: "Not authenticated for BTX buy"
        });
      }
      userId = email.toLowerCase();
    }

    const body = JSON.parse(event.body || "{}");

    try {
      helpers.checkPayloadProps(body, {
        projectId: { required: true },
        shares: { required: true }
      });
    } catch (error) {
      return error;
    }

    const { projectId, shares } = body;

    const result = await executeTrade({
      userId,
      projectId,
      side: "BUY",
      shares
    });

    return handlerHelpers.createResponse(200, {
      message: "BTX BUY executed",
      data: result
    });
  } catch (err) {
    console.error("[BTX] postBuy error", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error (BTX buy)"
    });
  }
};

export const postSell = async (event) => {
  try {
    const isOffline = process.env.IS_OFFLINE === "true";

    let userId;
    if (isOffline) {
      userId = "local-user@btx";
    } else {
      const claims = event.requestContext?.authorizer?.claims;
      const email = claims?.email;
      if (!email) {
        return handlerHelpers.createResponse(401, {
          message: "Not authenticated for BTX sell"
        });
      }
      userId = email.toLowerCase();
    }

    const body = JSON.parse(event.body || "{}");

    try {
      helpers.checkPayloadProps(body, {
        projectId: { required: true },
        shares: { required: true }
      });
    } catch (error) {
      return error;
    }

    const { projectId, shares } = body;

    const result = await executeTrade({
      userId,
      projectId,
      side: "SELL",
      shares
    });

    return handlerHelpers.createResponse(200, {
      message: "BTX SELL executed",
      data: result
    });
  } catch (err) {
    console.error("[BTX] postSell error", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error (BTX sell)"
    });
  }
};

export const getPortfolio = async (event) => {
  try {
    const isOffline = process.env.IS_OFFLINE === "true";

    let userId;
    if (isOffline) {
      userId = "local-user@btx";
    } else {
      const claims = event.requestContext?.authorizer?.claims;
      const email = claims?.email;
      if (!email) {
        return handlerHelpers.createResponse(401, {
          message: "Not authenticated for BTX portfolio"
        });
      }
      userId = email.toLowerCase();
    }

    const qs = event.queryStringParameters || {};
    const eventId = qs.eventId || DEFAULT_EVENT_ID;

    const portfolio = await getPortfolioForUser(userId, eventId);

    return handlerHelpers.createResponse(200, {
      message: "BTX portfolio",
      data: portfolio
    });
  } catch (err) {
    console.error("[BTX] getPortfolio error", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error (BTX portfolio)"
    });
  }
};

export const getRecentTradesHandler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    if (!qs.projectId) {
      return handlerHelpers.createResponse(400, {
        message: "Missing projectId"
      });
    }
    const projectId = qs.projectId;
    const limit = qs.limit ? Number(qs.limit) : 20;

    const trades = await getRecentTrades(projectId, limit);

    return handlerHelpers.createResponse(200, {
      message: `Recent trades for ${projectId}`,
      data: trades
    });
  } catch (err) {
    console.error("[BTX] getRecentTrades error", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error (BTX trades)"
    });
  }
};

export const getPriceHistory = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const projectId = qs.projectId;
    if (!projectId) {
      return handlerHelpers.createResponse(400, {
        message: "Missing projectId"
      });
    }

    const limit = qs.limit ? Number(qs.limit) : 500;
    const sinceTs = qs.since ? Number(qs.since) : undefined;

    const history = await getPriceHistoryForProject(projectId, {
      limit,
      sinceTs
    });

    return handlerHelpers.createResponse(200, {
      message: `BTX price history for ${projectId}`,
      data: history
    });
  } catch (err) {
    console.error("[BTX] getPriceHistory error", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error (BTX price history)"
    });
  }
};

export const postAdminProject = async (event, ctx, callback) => {
  console.log("[BTX admin] postAdminProject START", {
    httpMethod: event.httpMethod,
    path: event.path,
    query: event.queryStringParameters,
    rawBody: event.body,
    isOffline: process.env.IS_OFFLINE
  });

  try {
    const isOffline = process.env.IS_OFFLINE === "true";

    let userId = "local-admin@btx";
    if (!isOffline) {
      const claims = event.requestContext?.authorizer?.claims;
      userId = claims?.email?.toLowerCase();
      if (!userId || !isAdminUser(userId)) {
        const resp = handlerHelpers.createResponse(403, {
          message: "Not authorized for BTX admin"
        });
        if (callback) {
          callback(null, resp);
          return null;
        }
        return resp;
      }
    }

    const qs = event.queryStringParameters || {};
    let body = {};

    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch (e) {
        console.warn(
          "[BTX admin] invalid JSON body, falling back to query params",
          e
        );
        body = qs;
      }
    } else {
      body = qs;
    }

    console.log("[BTX admin] resolved body:", body);

    try {
      helpers.checkPayloadProps(body, {
        projectId: { required: true },
        ticker: { required: true }
      });
    } catch (error) {
      console.warn("[BTX admin] payload validation error:", error);
      if (callback) {
        callback(null, error);
        return null;
      }
      return error;
    }

    const { projectId, eventId, ticker, name, description, seedAmount } = body;

    const project = await createOrUpdateProject({
      projectId,
      eventId,
      ticker,
      name,
      description,
      seedAmount
    });

    const response = handlerHelpers.createResponse(200, {
      message: "BTX project created/updated",
      data: project
    });

    console.log("[BTX admin] SUCCESS", response);

    if (callback) {
      callback(null, response);
      return null;
    }
    return response;
  } catch (err) {
    console.error("[BTX admin] postAdminProject error", err);
    const resp = handlerHelpers.createResponse(500, {
      message: "Internal server error (BTX admin project)"
    });
    if (callback) {
      callback(null, resp);
      return null;
    }
    return resp;
  }
};

export const postAdminSeedUpdate = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");

    try {
      helpers.checkPayloadProps(body, {
        projectId: { required: true }
      });
    } catch (error) {
      return error;
    }

    const { projectId, seedDelta, seedAbsolute } = body;

    const updated = await applySeedUpdate({
      projectId,
      seedDelta,
      seedAbsolute
    });

    return handlerHelpers.createResponse(200, {
      message: "BTX seed updated",
      data: updated
    });
  } catch (err) {
    console.error("[BTX] postAdminSeedUpdate error", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error (BTX seed update)"
    });
  }
};

export const postAdminPhaseBump = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");

    try {
      helpers.checkPayloadProps(body, {
        projectId: { required: true },
        bumpType: { required: true }
      });
    } catch (error) {
      return error;
    }

    const { projectId, bumpType, multiplier, delta } = body;

    const updated = await applyPhaseBump({
      projectId,
      bumpType,
      multiplier,
      delta
    });

    return handlerHelpers.createResponse(200, {
      message: "BTX phase bump applied",
      data: updated
    });
  } catch (err) {
    console.error("[BTX] postAdminPhaseBump error", err);
    return handlerHelpers.createResponse(500, {
      message: "Internal server error (BTX phase bump)"
    });
  }
};

// WebSocket handlers

export const wsConnect = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    await saveSocketConnection({
      connectionId,
      eventId: DEFAULT_EVENT_ID,
      userId: "__anon__"
    });
    return {
      statusCode: 200,
      body: "connected"
    };
  } catch (err) {
    console.error("[BTX] wsConnect error", err);
    return {
      statusCode: 500,
      body: "connect failed"
    };
  }
};

export const wsDisconnect = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    await removeSocketConnection({ connectionId });
    return {
      statusCode: 200,
      body: "disconnected"
    };
  } catch (err) {
    console.error("[BTX] wsDisconnect error", err);
    return {
      statusCode: 500,
      body: "disconnect failed"
    };
  }
};

export const wsSubscribe = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body || "{}");
    const eventId = body.eventId || DEFAULT_EVENT_ID;
    const userId = body.userId || "__anon__";

    await saveSocketConnection({
      connectionId,
      eventId,
      userId
    });

    return {
      statusCode: 200,
      body: "subscribed"
    };
  } catch (err) {
    console.error("[BTX] wsSubscribe error", err);
    return {
      statusCode: 500,
      body: "subscribe failed"
    };
  }
};

export const ping = async () => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    ok: true,
    ts: Date.now()
  })
});
