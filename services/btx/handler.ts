import helpers from "../../lib/handlerHelpers";
import { protect, Access } from "../../lib/auth";
import type { APIGatewayResponse } from "../../lib/types";

import {
  BtxError,
  configuredEvent,
  eventEndsAtMs,
  getEventConfig,
  projectIdFromPath,
  removeSocketConnection,
  saveSocketConnection
} from "./helpers";
import { applyGrant, getQuote, startSeeding } from "./market";
import { stockPriceCents, seedStatus } from "./pricing";
import {
  getPortfolioForUser,
  getRecentTrades,
  getTraderLeaderboard
} from "./repos/accounts";
import { getPriceHistory, listProjectsForEvent } from "./repos/projects";
import {
  accountTrades,
  enqueueMarketCommand,
  getTrade,
  submitTrade
} from "./trades";

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

export const getProjects = protect(Access.PUBLIC, async () => {
  try {
    const eventId = configuredEvent();
    return helpers.createResponse(200, {
      message: `BTX projects for ${eventId}`,
      data: await listProjectsForEvent()
    });
  } catch (err) {
    return clientError(err, "BTX getProjects failed");
  }
});

export const getMarketSnapshot = protect(Access.PUBLIC, async () => {
  try {
    const eventId = configuredEvent();
    const serverTime = Date.now();
    const [projects, config] = await Promise.all([
      listProjectsForEvent(),
      getEventConfig()
    ]);

    const rows = projects
      .map((p) => {
        const status = seedStatus(p, config.ipoAt, serverTime);
        const priceCents = stockPriceCents(p, config.ipoAt);
        const netShares = p.netShares;
        return {
          ...p,
          seedStatus: status,
          currentPriceCents: priceCents,
          asOf: serverTime,
          marketCapCents: priceCents * netShares
        };
      })
      .sort((a, b) => b.marketCapCents - a.marketCapCents);

    return helpers.createResponse(200, {
      message: `BTX snapshot for ${eventId}`,
      data: {
        eventId,
        serverTime,
        phase: config.phase === "PRE_IPO" ? "SEED" : config.phase,
        live: config.phase === "LIVE",
        ipoAt: config.ipoAt,
        lastReset: config.lastReset,
        eventEndsAt: eventEndsAtMs(),
        projects: rows
      }
    });
  } catch (err) {
    return clientError(err, "BTX snapshot failed");
  }
});

export const getPortfolio = protect(Access.USER, async (event) => {
  try {
    return helpers.createResponse(200, {
      message: "BTX portfolio",
      data: await getPortfolioForUser(event.auth!.email)
    });
  } catch (err) {
    return clientError(err, "BTX portfolio failed");
  }
});

export const getRecentTradesHandler = protect(Access.PUBLIC, async (event) => {
  try {
    const projectId = event.queryStringParameters?.projectId;
    if (!projectId) {
      return helpers.createResponse(400, { message: "Missing projectId" });
    }
    const limit = Number(event.queryStringParameters?.limit || 20);
    const page = await getRecentTrades(
      projectId,
      limit,
      event.queryStringParameters?.cursor
    );
    return helpers.createResponse(200, {
      message: `Trades for ${projectId}`,
      data: page.items,
      nextCursor: page.nextCursor
    });
  } catch (err) {
    return clientError(err, "BTX trades failed");
  }
});

export const getPriceHistoryHandler = protect(Access.PUBLIC, async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    if (!qs.projectId) {
      return helpers.createResponse(400, { message: "Missing projectId" });
    }
    const page = await getPriceHistory(
      qs.projectId,
      Number(qs.limit || 500),
      qs.prevPageKey
    );
    return helpers.createResponse(200, {
      message: `Price history for ${qs.projectId}`,
      data: page.items,
      nextPageKey: page.nextPageKey
    });
  } catch (err) {
    return clientError(err, "BTX price history failed");
  }
});

export const getLeaderboard = protect(Access.USER, async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    return helpers.createResponse(200, {
      message: "BTX leaderboard",
      data: await getTraderLeaderboard(
        event.auth!.email,
        Number(qs.limitTop || 5),
        Number(qs.limitBottom || 5)
      )
    });
  } catch (err) {
    return clientError(err, "BTX leaderboard failed");
  }
});

export const getQuoteHandler = protect(Access.USER, async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const projectId = qs.projectId || "";
    if (!projectId) throw new BtxError(400, "Missing projectId");
    return helpers.createResponse(200, {
      message: "BTX quote",
      data: await getQuote({
        projectId,
        side: qs.side as "BUY" | "SELL",
        shares: Number(qs.shares),
        userId: event.auth!.email
      })
    });
  } catch (err) {
    return clientError(err, "BTX quote failed");
  }
});

export const postStartSeeding = protect(Access.USER, async (event) => {
  try {
    const projectId = projectIdFromPath(event.pathParameters?.projectId);
    if (!projectId) {
      throw new BtxError(400, "Missing projectId", {
        code: "VALIDATION_ERROR"
      });
    }
    return helpers.createResponse(200, {
      message: "Seed window started",
      data: await startSeeding(event.auth!.email, projectId)
    });
  } catch (err) {
    return clientError(err, "BTX start seeding failed");
  }
});

export const postIpo = protect(Access.ADMIN, async () => {
  try {
    const config = await getEventConfig();
    if (config.phase === "IPO_RESETTING") throw new BtxError(409, "IPO reset is in progress.");
    await enqueueMarketCommand({ type: "IPO", previousIpoAt: config.previousIpoAt });
    return helpers.createResponse(202, {
      message: "BTX IPO queued"
    });
  } catch (err) {
    return clientError(err, "BTX IPO failed");
  }
});

export const postResetIpo = protect(Access.ADMIN, async (event) => {
  try {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      throw new BtxError(400, "Expected a JSON body containing ipoAt.");
    }
    if (!Number.isSafeInteger(body?.ipoAt) || body.ipoAt <= 0) {
      throw new BtxError(400, "Provide the current ipoAt in epoch milliseconds.");
    }
    const config = await getEventConfig();
    if (config.ipoAt !== body.ipoAt || (config.phase !== "LIVE" && config.phase !== "IPO_RESETTING")) {
      throw new BtxError(409, "The requested IPO is no longer live.");
    }
    await enqueueMarketCommand({ type: "RESET_IPO", ipoAt: body.ipoAt });
    return helpers.createResponse(202, { message: "BTX IPO reset queued", data: { ipoAt: body.ipoAt } });
  } catch (err) {
    return clientError(err, "BTX IPO reset failed");
  }
});

export const postGrant = protect(Access.ADMIN, async (event) => {
  try {
    const b = JSON.parse(event.body!);
    return helpers.createResponse(200, {
      message: "Grant applied",
      data: await applyGrant({
        requestId: b.requestId,
        amountCents: b.amountCents,
        targetEmails: b.targets
      })
    });
  } catch (err) {
    return clientError(err, "BTX grant failed");
  }
});

export const postBuy = protect(Access.USER, async (event) => {
  try {
    const trade = await submitTrade(
      event.auth!.email,
      "BUY",
      JSON.parse(event.body!)
    );
    return helpers.createResponse(202, {
      message: trade.status,
      data: trade
    });
  } catch (error) {
    return clientError(error, "BTX buy failed");
  }
});

export const postSell = protect(Access.USER, async (event) => {
  try {
    const trade = await submitTrade(
      event.auth!.email,
      "SELL",
      JSON.parse(event.body!)
    );
    return helpers.createResponse(202, {
      message: trade.status,
      data: trade
    });
  } catch (error) {
    return clientError(error, "BTX sell failed");
  }
});

export const getTradeStatus = protect(Access.USER, async (event) => {
  try {
    const trade = await getTrade(
      event.pathParameters!.projectId!,
      event.pathParameters!.tradeId!
    );
    if (!trade) throw new BtxError(404, "Trade not found");
    if (trade.userId !== event.auth!.email && !event.auth!.isAdmin)
      throw new BtxError(403, "Trade belongs to another participant");
    return helpers.createResponse(200, { message: "BTX trade", data: trade });
  } catch (error) {
    return clientError(error, "BTX trade status failed");
  }
});

export const getAccountTrades = protect(Access.USER, async (event) => {
  try {
    const page = await accountTrades(
      event.auth!.email,
      Number(event.queryStringParameters?.limit || 50),
      event.queryStringParameters?.prevPageKey
    );
    return helpers.createResponse(200, {
      message: "BTX account trades",
      data: page.items,
      nextPageKey: page.nextPageKey
    });
  } catch (error) {
    return clientError(error, "BTX account history failed");
  }
});

export const wsConnect = async (event: any) => {
  try {
    const connectionId = event.requestContext.connectionId;
    await saveSocketConnection({
      connectionId,
      eventId: configuredEvent(),
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
    const eventId = configuredEvent();
    const userId = body.userId || "__anon__";

    await saveSocketConnection({ connectionId, eventId, userId });
    return { statusCode: 200, body: "subscribed" };
  } catch (err) {
    console.error("[BTX] wsSubscribe error", err);
    return { statusCode: 500, body: "subscribe failed" };
  }
};
