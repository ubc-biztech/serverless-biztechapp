// services/btx/helpers.js

import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
  TransactWriteCommand
} from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApi } from "@aws-sdk/client-apigatewaymanagementapi";
import { randomUUID } from "crypto";

import docClient from "../../lib/docClient";
import handlerHelpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import { TEAMS_TABLE } from "../../constants/tables";
import {
  DEFAULT_EVENT_ID,
  INITIAL_CASH_BALANCE,
  MIN_PRICE,
  DEFAULT_BASE_PRICE,
  PRICE_SENSITIVITY_PER_SHARE,
  SEED_TO_PRICE_FACTOR,
  PHASE_BUMP_PRESETS,
  DRIFT_ENABLED,
  DRIFT_MAX_PCT_PER_TICK,
  DRIFT_MEAN_REVERSION,
  TRANSACTION_FEE_BPS,
  EXECUTION_NOISE_MAX_PCT,
  EQUILIBRIUM_SENSITIVITY_FACTOR
} from "./constants";

//  Table names

const BTX_PROJECTS_TABLE = `bizBtxProjects${process.env.ENVIRONMENT || ""}`;
const BTX_ACCOUNTS_TABLE = `bizBtxAccounts${process.env.ENVIRONMENT || ""}`;
const BTX_HOLDINGS_TABLE = `bizBtxHoldings${process.env.ENVIRONMENT || ""}`;
const BTX_TRADES_TABLE = `bizBtxTrades${process.env.ENVIRONMENT || ""}`;
const BTX_SOCKETS_TABLE = `bizBtxSockets${process.env.ENVIRONMENT || ""}`;
const BTX_PRICES_TABLE = `bizBtxPrices${process.env.ENVIRONMENT || ""}`;

const WS_ENDPOINT = process.env.WS_API_ENDPOINT;

//  Utility helpers

export function roundPrice(value) {
  return Math.round(value * 100) / 100;
}

export function clampPrice(value) {
  return Math.max(MIN_PRICE, roundPrice(value));
}

export function applyExecutionNoise(endPrice) {
  const maxPct = EXECUTION_NOISE_MAX_PCT || 0;
  if (!maxPct || maxPct <= 0) {
    return clampPrice(endPrice);
  }

  const u = Math.random() * 2 - 1;

  const factor = 1 + u * maxPct;
  const noisy = endPrice * factor;

  return clampPrice(noisy);
}

// WebSocket helpers

export function wsClient() {
  const isOffline = process.env.IS_OFFLINE === "true";

  const endpoint = isOffline
    ? "http://localhost:3005" // serverless-offline websocket endpoint
    : WS_ENDPOINT;

  if (!endpoint) {
    console.warn("[BTX] WS endpoint not configured; websocket disabled");
    return null;
  }

  return new ApiGatewayManagementApi({
    endpoint
  });
}

export async function saveSocketConnection({ connectionId, eventId, userId }) {
  const cmd = new PutCommand({
    TableName: BTX_SOCKETS_TABLE,
    Item: {
      connectionId,
      eventId,
      userId,
      connectedAt: Date.now()
    }
  });
  await docClient.send(cmd);
}

export async function removeSocketConnection({ connectionId }) {
  const cmd = new DeleteCommand({
    TableName: BTX_SOCKETS_TABLE,
    Key: { connectionId }
  });
  await docClient.send(cmd);
}

export async function listConnectionsByEvent(eventId) {
  const cmd = new QueryCommand({
    TableName: BTX_SOCKETS_TABLE,
    IndexName: "byEvent",
    KeyConditionExpression: "eventId = :e",
    ExpressionAttributeValues: {
      ":e": eventId
    }
  });
  const res = await docClient.send(cmd);
  return res.Items || [];
}

export async function postToConnection(connectionId, payload) {
  const api = wsClient();
  if (!api) return;
  try {
    await api.postToConnection({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(payload))
    });
  } catch (err) {
    const status =
      err?.statusCode ||
      err?.$metadata?.httpStatusCode ||
      err?.$response?.statusCode;

    if (status === 410) {
      console.warn("[BTX] stale websocket connection, removing", {
        connectionId
      });
      try {
        await removeSocketConnection({ connectionId });
      } catch (cleanupErr) {
        console.error(
          "[BTX] failed to remove stale websocket connection",
          cleanupErr
        );
      }
      return;
    }

    console.error("[BTX] postToConnection error", err);
  }
}

//  Price history helpers

export async function recordPriceHistory({
  projectId,
  eventId,
  price,
  source
}) {
  if (!projectId || price == null) return;

  const now = Date.now();

  const item = {
    projectId,
    ts: now,
    price: roundPrice(Number(price)),
    eventId: eventId || DEFAULT_EVENT_ID,
    source: source || "UNKNOWN"
  };

  const cmd = new PutCommand({
    TableName: BTX_PRICES_TABLE,
    Item: item
  });

  try {
    await docClient.send(cmd);
  } catch (err) {
    console.error("[BTX] recordPriceHistory error", err);
  }

  return item;
}

export async function getPriceHistoryForProject(
  projectId,
  { limit = 500, sinceTs } = {}
) {
  if (!projectId) return [];

  let KeyConditionExpression = "projectId = :p";
  const ExpressionAttributeValues = { ":p": projectId };

  if (sinceTs != null) {
    KeyConditionExpression += " AND ts >= :since";
    ExpressionAttributeValues[":since"] = sinceTs;
  }

  const cmd = new QueryCommand({
    TableName: BTX_PRICES_TABLE,
    KeyConditionExpression,
    ExpressionAttributeValues,
    ScanIndexForward: true, // oldest -> newest
    Limit: limit
  });

  const res = await docClient.send(cmd);
  return res.Items || [];
}

// Broadcast with price history

export async function broadcastPriceUpdate(project, source = "UNKNOWN") {
  try {
    const eventId = project.eventId || DEFAULT_EVENT_ID;
    const subs = await listConnectionsByEvent(eventId);

    const price = Number(
      project.currentPrice || project.basePrice || DEFAULT_BASE_PRICE
    );
    const netShares = Number(project.netShares || 0);
    const marketCap = price * Math.max(Math.abs(netShares), 1);

    await recordPriceHistory({
      projectId: project.projectId,
      eventId,
      price,
      source
    });

    const payload = {
      type: "priceUpdate",
      eventId,
      projectId: project.projectId,
      ticker: project.ticker,
      name: project.name,
      // price + mechanics
      currentPrice: project.currentPrice,
      basePrice: project.basePrice,
      netShares: project.netShares,
      seedAmount: project.seedAmount,
      // activity
      totalVolume: project.totalVolume,
      totalTrades: project.totalTrades,
      totalBuyShares: project.totalBuyShares,
      totalSellShares: project.totalSellShares,
      marketCap,
      source,
      // timing
      updatedAt: project.updatedAt
    };

    await Promise.all(
      subs.map((s) => postToConnection(s.connectionId, payload))
    );
  } catch (err) {
    console.error("[BTX] broadcastPriceUpdate error", err);
  }
}

//  Random drift (random walk + mean reversion)

export async function maybeApplyRandomDrift(project) {
  if (!DRIFT_ENABLED) return project;

  const now = Date.now();
  const lastTs = Number(
    project.randomDriftAt || project.updatedAt || project.createdAt || now
  );
  const elapsedMs = Math.max(0, now - lastTs);

  const MIN_INTERVAL_MS = 3000;
  if (elapsedMs < MIN_INTERVAL_MS) {
    return project;
  }

  const basePrice = Number(project.basePrice || DEFAULT_BASE_PRICE);
  const netShares = Number(project.netShares || 0);

  const equilibriumPrice = clampPrice(
    basePrice +
      netShares * PRICE_SENSITIVITY_PER_SHARE * EQUILIBRIUM_SENSITIVITY_FACTOR
  );

  let price = Number(project.currentPrice || equilibriumPrice);
  if (!Number.isFinite(price) || price <= 0) price = equilibriumPrice;

  const elapsedSeconds = elapsedMs / 1000;

  // Mean reversion toward equilibrium, not basePrice
  const distance = price - equilibriumPrice;
  const meanReversionFactor = Math.min(
    1,
    DRIFT_MEAN_REVERSION * elapsedSeconds
  );
  const meanReversionMove = -distance * meanReversionFactor;

  // Random noise around equilibrium
  const maxPct = DRIFT_MAX_PCT_PER_TICK * Math.sqrt(elapsedSeconds);
  const rnd = (Math.random() * 2 - 1) * maxPct;
  const randomMove = price * rnd;

  let newPrice = clampPrice(price + meanReversionMove + randomMove);

  if (newPrice === price) {
    const stampCmd = new UpdateCommand({
      TableName: BTX_PROJECTS_TABLE,
      Key: { projectId: project.projectId },
      UpdateExpression: "SET randomDriftAt = :now",
      ExpressionAttributeValues: { ":now": now },
      ReturnValues: "ALL_NEW"
    });
    const stampRes = await docClient.send(stampCmd);
    return stampRes.Attributes || project;
  }

  const cmd = new UpdateCommand({
    TableName: BTX_PROJECTS_TABLE,
    Key: { projectId: project.projectId },
    UpdateExpression:
      "SET currentPrice = :cp, updatedAt = :now, randomDriftAt = :now",
    ExpressionAttributeValues: {
      ":cp": newPrice,
      ":now": now
    },
    ReturnValues: "ALL_NEW"
  });

  const res = await docClient.send(cmd);
  const updated = res.Attributes || {
    ...project,
    currentPrice: newPrice,
    updatedAt: now,
    randomDriftAt: now
  };

  broadcastPriceUpdate(updated, "DRIFT").catch((err) =>
    console.error("[BTX] broadcast error (drift)", err)
  );

  return updated;
}

export async function applyRandomDriftToProjects(projects) {
  if (!DRIFT_ENABLED) return projects;
  if (!projects || !projects.length) return projects;

  const updated = await Promise.all(
    projects.map((p) => maybeApplyRandomDrift(p))
  );
  return updated;
}

// BTX helpers

export async function getProject(projectId) {
  const cmd = new GetCommand({
    TableName: BTX_PROJECTS_TABLE,
    Key: { projectId }
  });
  const res = await docClient.send(cmd);
  return res.Item || null;
}

export async function getProjectOrThrow(projectId) {
  const project = await getProject(projectId);
  if (!project) {
    throw handlerHelpers.notFoundResponse("BTX project", projectId);
  }
  if (project.isActive === false) {
    throw handlerHelpers.createResponse(400, {
      message: "Project is inactive in BTX"
    });
  }
  return project;
}

export function computeBasePriceFromSeed(seedAmount) {
  const seed = Number(seedAmount || 0);
  const base = DEFAULT_BASE_PRICE + seed * SEED_TO_PRICE_FACTOR;
  return clampPrice(base);
}

export function applyPriceFromNetShares(project, netSharesDelta) {
  const currentNetShares = Number(project.netShares || 0);
  const newNetShares = currentNetShares + netSharesDelta;

  const startPrice = Number(
    project.currentPrice || project.basePrice || DEFAULT_BASE_PRICE
  );

  const rawPrice = startPrice + netSharesDelta * PRICE_SENSITIVITY_PER_SHARE;
  const currentPrice = clampPrice(rawPrice);

  return {
    newNetShares,
    currentPrice
  };
}

// Ensure a BTX account exists for a user
export async function ensureAccount(userId) {
  const cmd = new GetCommand({
    TableName: BTX_ACCOUNTS_TABLE,
    Key: { userId }
  });
  const res = await docClient.send(cmd);
  if (res.Item) return res.Item;

  const now = Date.now();
  const newAccount = {
    userId,
    cashBalance: INITIAL_CASH_BALANCE,
    initialBalance: INITIAL_CASH_BALANCE,
    createdAt: now,
    updatedAt: now
  };

  const putCmd = new PutCommand({
    TableName: BTX_ACCOUNTS_TABLE,
    Item: newAccount,
    ConditionExpression: "attribute_not_exists(userId)"
  });

  try {
    await docClient.send(putCmd);
    return newAccount;
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      // someone else created it; read again
      const res2 = await docClient.send(cmd);
      return res2.Item;
    }
    throw err;
  }
}

export async function getHolding(userId, projectId) {
  const cmd = new GetCommand({
    TableName: BTX_HOLDINGS_TABLE,
    Key: {
      userId,
      projectId
    }
  });
  const res = await docClient.send(cmd);
  return res.Item || null;
}

export function computeHoldingAfterBuy(holding, sharesToBuy, cost) {
  const existingShares = holding ? Number(holding.shares || 0) : 0;
  const existingAvgPrice = holding ? Number(holding.avgPrice || 0) : 0;

  const newShares = existingShares + sharesToBuy;
  const totalCost = existingShares * existingAvgPrice + cost;
  const newAvgPrice = newShares > 0 ? totalCost / newShares : 0;

  return {
    newShares,
    newAvgPrice: roundPrice(newAvgPrice)
  };
}

export function computeHoldingAfterSell(holding, sharesToSell) {
  const existingShares = holding ? Number(holding.shares || 0) : 0;
  if (sharesToSell > existingShares) {
    throw handlerHelpers.createResponse(400, {
      message: "Insufficient shares to sell"
    });
  }
  const newShares = existingShares - sharesToSell;
  return { newShares };
}

// Execute a BUY or SELL trade atomically

export async function executeTrade({ userId, projectId, side, shares }) {
  const now = Date.now();
  const cleanSide = side === "SELL" ? "SELL" : "BUY";
  const sharesNum = Number(shares);
  if (!Number.isFinite(sharesNum) || sharesNum <= 0) {
    throw handlerHelpers.createResponse(400, {
      message: "Shares must be a positive number"
    });
  }

  const [project, account] = await Promise.all([
    getProjectOrThrow(projectId),
    ensureAccount(userId)
  ]);
  const holding = await getHolding(userId, projectId);

  // Use *displayed* price as the starting point
  const startPrice = Number(
    project.currentPrice || project.basePrice || DEFAULT_BASE_PRICE
  );
  const cashBalance = Number(account.cashBalance || 0);

  if (!Number.isFinite(startPrice) || startPrice <= 0) {
    throw handlerHelpers.createResponse(400, {
      message: "Invalid project price"
    });
  }

  //  Price impact + execution price
  const netSharesDelta = cleanSide === "BUY" ? sharesNum : -sharesNum;

  // Linear bonding curve: end price relative to start price
  const { currentPrice: deterministicEndPrice } = applyPriceFromNetShares(
    project,
    netSharesDelta
  );

  // newPriceRaw is already rounded + clamped via clampPrice
  const endPrice = applyExecutionNoise(deterministicEndPrice);

  // Execute at average of before & after price
  const executionPrice = roundPrice((startPrice + endPrice) / 2);

  // Transaction fee (fuck the audience)
  const feeFactor =
    TRANSACTION_FEE_BPS && TRANSACTION_FEE_BPS > 0
      ? TRANSACTION_FEE_BPS / 10000
      : 0;

  let cashDelta = 0;
  let buyDelta = 0;
  let sellDelta = 0;
  let cost = 0;
  let revenue = 0;

  if (cleanSide === "BUY") {
    // cost = executionPrice * shares * (1 + fee)
    cost = roundPrice(executionPrice * sharesNum * (1 + (feeFactor || 0)));

    if (cashBalance < cost) {
      throw handlerHelpers.createResponse(400, {
        message: "Insufficient BTX cash balance"
      });
    }

    cashDelta = -cost;
    buyDelta = sharesNum;
  } else {
    // SELL
    const { newShares } = computeHoldingAfterSell(holding, sharesNum); // throws if broke ass

    // revenue = executionPrice * shares * (1 - fee)
    revenue = roundPrice(executionPrice * sharesNum * (1 - (feeFactor || 0)));
    cashDelta = revenue;
    sellDelta = sharesNum;
  }

  const tradeId = `ts#${now}#${randomUUID()}`;

  //  New holding state
  let holdingPutOrUpdate = null;
  let holdingDelete = null;

  if (cleanSide === "BUY") {
    const { newShares, newAvgPrice } = computeHoldingAfterBuy(
      holding,
      sharesNum,
      cost
    );
    holdingPutOrUpdate = {
      TableName: BTX_HOLDINGS_TABLE,
      Item: {
        userId,
        projectId,
        shares: newShares,
        avgPrice: newAvgPrice,
        createdAt: holding?.createdAt || now,
        updatedAt: now
      }
    };
  } else {
    const { newShares } = computeHoldingAfterSell(holding, sharesNum);
    if (newShares === 0) {
      holdingDelete = {
        TableName: BTX_HOLDINGS_TABLE,
        Key: {
          userId,
          projectId
        }
      };
    } else {
      holdingPutOrUpdate = {
        TableName: BTX_HOLDINGS_TABLE,
        Item: {
          userId,
          projectId,
          shares: newShares,
          avgPrice: holding.avgPrice,
          createdAt: holding.createdAt,
          updatedAt: now
        }
      };
    }
  }

  const tradeItem = {
    projectId,
    tradeId,
    userId,
    eventId: project.eventId || DEFAULT_EVENT_ID,
    side: cleanSide,
    shares: sharesNum,
    price: executionPrice,
    cashDelta,
    createdAt: now
  };

  const projectUpdate = {
    TableName: BTX_PROJECTS_TABLE,
    Key: { projectId },
    UpdateExpression:
      "SET currentPrice = :cp, basePrice = if_not_exists(basePrice, :bp), netShares = if_not_exists(netShares, :zero) + :nsd, totalBuyShares = if_not_exists(totalBuyShares, :zero) + :bd, totalSellShares = if_not_exists(totalSellShares, :zero) + :sd, totalTrades = if_not_exists(totalTrades, :zero) + :one, totalVolume = if_not_exists(totalVolume, :zero) + :vol, updatedAt = :now",
    ExpressionAttributeValues: {
      ":cp": endPrice,
      ":bp": project.basePrice || DEFAULT_BASE_PRICE,
      ":zero": 0,
      ":nsd": netSharesDelta,
      ":bd": buyDelta,
      ":sd": sellDelta,
      ":one": 1,
      ":vol": sharesNum,
      ":now": now
    },
    ReturnValues: "ALL_NEW"
  };

  const accountUpdate = {
    TableName: BTX_ACCOUNTS_TABLE,
    Key: { userId },
    UpdateExpression:
      "SET cashBalance = if_not_exists(cashBalance, :start) + :delta, initialBalance = if_not_exists(initialBalance, :start), updatedAt = :now",
    ExpressionAttributeValues: {
      ":start": INITIAL_CASH_BALANCE,
      ":delta": cashDelta,
      ":now": now
    },
    ReturnValues: "ALL_NEW"
  };

  const isOffline = process.env.IS_OFFLINE === "true";

  if (isOffline) {
    console.log("[BTX] executeTrade OFFLINE path", {
      userId,
      projectId,
      side: cleanSide,
      shares: sharesNum
    });

    const projRes = await docClient.send(new UpdateCommand(projectUpdate));
    const updatedProject = projRes.Attributes;

    const acctRes = await docClient.send(new UpdateCommand(accountUpdate));
    const updatedAccount = acctRes.Attributes;

    if (holdingPutOrUpdate) {
      await docClient.send(new PutCommand(holdingPutOrUpdate));
    }
    if (holdingDelete) {
      await docClient.send(new DeleteCommand(holdingDelete));
    }

    await docClient.send(
      new PutCommand({
        TableName: BTX_TRADES_TABLE,
        Item: tradeItem
      })
    );

    broadcastPriceUpdate(updatedProject, "TRADE").catch((err) =>
      console.error("[BTX] broadcast error", err)
    );

    return {
      trade: tradeItem,
      project: updatedProject,
      account: updatedAccount
    };
  }

  const transactItems = [
    { Update: projectUpdate },
    { Update: accountUpdate },
    {
      Put: {
        TableName: BTX_TRADES_TABLE,
        Item: tradeItem
      }
    }
  ];

  if (holdingPutOrUpdate) {
    transactItems.push({ Put: holdingPutOrUpdate });
  }
  if (holdingDelete) {
    transactItems.push({ Delete: holdingDelete });
  }

  const tx = new TransactWriteCommand({
    TransactItems: transactItems
  });

  await docClient.send(tx);

  const [updatedProjectRes, updatedAccountRes] = await Promise.all([
    docClient.send(
      new GetCommand({
        TableName: BTX_PROJECTS_TABLE,
        Key: { projectId }
      })
    ),
    docClient.send(
      new GetCommand({
        TableName: BTX_ACCOUNTS_TABLE,
        Key: { userId }
      })
    )
  ]);

  const updatedProject = updatedProjectRes.Item;
  const updatedAccount = updatedAccountRes.Item;

  broadcastPriceUpdate(updatedProject, "TRADE").catch((err) =>
    console.error("[BTX] broadcast error", err)
  );

  return {
    trade: tradeItem,
    project: updatedProject,
    account: updatedAccount
  };
}

// Create or update a BTX project
export async function createOrUpdateProject({
  projectId,
  eventId,
  ticker,
  name,
  description,
  seedAmount = 0
}) {
  const now = Date.now();
  const event = eventId || DEFAULT_EVENT_ID;
  const seed = Number(seedAmount || 0);

  const basePrice = computeBasePriceFromSeed(seed);
  const currentPrice = basePrice;

  let finalName = name;
  if (!finalName && projectId) {
    try {
      const teamItem = await db.getOne(projectId, TEAMS_TABLE);
      if (teamItem && teamItem.teamName) {
        finalName = teamItem.teamName;
      }
    } catch (err) {
      console.warn("[BTX] unable to hydrate name from TEAMS", err);
    }
  }

  const item = {
    projectId,
    eventId: event,
    ticker,
    name: finalName || ticker || projectId,
    description: description || "",
    basePrice,
    currentPrice,
    netShares: 0,
    totalBuyShares: 0,
    totalSellShares: 0,
    totalTrades: 0,
    totalVolume: 0,
    seedAmount: seed,
    isActive: true,
    createdAt: now,
    updatedAt: now
  };

  const cmd = new PutCommand({
    TableName: BTX_PROJECTS_TABLE,
    Item: item
  });

  await docClient.send(cmd);

  // record initial price for this project so charts have an inception point
  try {
    await recordPriceHistory({
      projectId,
      eventId: event,
      price: currentPrice,
      source: "PROJECT_CREATE"
    });
  } catch (err) {
    console.error("[BTX] failed to record initial price history", err);
  }

  return item;
}

// Update project seed impact
export async function applySeedUpdate({ projectId, seedDelta, seedAbsolute }) {
  const project = await getProjectOrThrow(projectId);
  const now = Date.now();

  const currentSeed = Number(project.seedAmount || 0);
  const newSeed =
    seedAbsolute != null
      ? Number(seedAbsolute)
      : currentSeed + Number(seedDelta || 0);

  const newBasePrice = computeBasePriceFromSeed(newSeed);
  const newCurrentPrice = Math.max(
    newBasePrice,
    Number(project.currentPrice || newBasePrice)
  );

  const cmd = new UpdateCommand({
    TableName: BTX_PROJECTS_TABLE,
    Key: { projectId },
    UpdateExpression:
      "SET seedAmount = :seed, basePrice = :bp, currentPrice = :cp, updatedAt = :now",
    ExpressionAttributeValues: {
      ":seed": newSeed,
      ":bp": newBasePrice,
      ":cp": newCurrentPrice,
      ":now": now
    },
    ReturnValues: "ALL_NEW"
  });

  const res = await docClient.send(cmd);
  const updated = res.Attributes;

  broadcastPriceUpdate(updated, "SEED_UPDATE").catch((err) =>
    console.error("[BTX] broadcast error", err)
  );

  return updated;
}

// Apply phase bump incase something happens real-world wise
export async function applyPhaseBump({
  projectId,
  bumpType,
  multiplier,
  delta
}) {
  const project = await getProjectOrThrow(projectId);
  const now = Date.now();

  const current = Number(
    project.currentPrice || project.basePrice || DEFAULT_BASE_PRICE
  );

  let newPrice = current;

  if (bumpType && PHASE_BUMP_PRESETS[bumpType]) {
    const pct = PHASE_BUMP_PRESETS[bumpType];
    newPrice = current * (1 + pct);
  } else if (bumpType === "MULTIPLY" && multiplier != null) {
    newPrice = current * Number(multiplier);
  } else if (bumpType === "ADD" && delta != null) {
    newPrice = current + Number(delta);
  } else {
    throw handlerHelpers.createResponse(400, {
      message: "Unknown bumpType or missing parameters"
    });
  }

  newPrice = clampPrice(newPrice);

  const cmd = new UpdateCommand({
    TableName: BTX_PROJECTS_TABLE,
    Key: { projectId },
    UpdateExpression: "SET currentPrice = :cp, updatedAt = :now",
    ExpressionAttributeValues: {
      ":cp": newPrice,
      ":now": now
    },
    ReturnValues: "ALL_NEW"
  });

  const res = await docClient.send(cmd);
  const updated = res.Attributes;

  broadcastPriceUpdate(updated, "PHASE_BUMP").catch((err) =>
    console.error("[BTX] broadcast error", err)
  );

  return updated;
}

// List projects for an event
export async function listProjectsForEvent(eventId) {
  const ev = eventId || DEFAULT_EVENT_ID;

  const cmd = new QueryCommand({
    TableName: BTX_PROJECTS_TABLE,
    IndexName: "byEvent",
    KeyConditionExpression: "eventId = :e",
    ExpressionAttributeValues: {
      ":e": ev
    }
  });

  try {
    const res = await docClient.send(cmd);
    const items = res.Items || [];
    return items;
  } catch (err) {
    // fallback: scan if GSI isn't there yet in dev
    console.warn("[BTX] byEvent index missing? falling back to Scan", err);
    const scanCmd = new QueryCommand({
      TableName: BTX_PROJECTS_TABLE,
      KeyConditionExpression: "projectId <> :x",
      ExpressionAttributeValues: {
        ":x": "___never___"
      }
    });
    const res2 = await docClient.send(scanCmd);
    const items2 = (res2.Items || []).filter((p) => p.eventId === ev);
    return items2;
  }
}

// Portfolio for a user
export async function getPortfolioForUser(userId, eventId) {
  const [account, holdingsRes] = await Promise.all([
    ensureAccount(userId),
    docClient.send(
      new QueryCommand({
        TableName: BTX_HOLDINGS_TABLE,
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: {
          ":u": userId
        }
      })
    )
  ]);

  const holdings = holdingsRes.Items || [];
  if (!holdings.length) {
    return {
      account,
      totalEquityValue: 0,
      totalPortfolioValue: account.cashBalance,
      holdings: []
    };
  }

  // Fetch projects for all holdings
  const uniqueProjectIds = Array.from(
    new Set(holdings.map((h) => h.projectId))
  );

  const projects = await Promise.all(
    uniqueProjectIds.map(async (pid) => {
      const cmd = new GetCommand({
        TableName: BTX_PROJECTS_TABLE,
        Key: { projectId: pid }
      });
      const res = await docClient.send(cmd);
      return res.Item;
    })
  );

  const projectMap = new Map();
  for (const p of projects) {
    if (!p) continue;
    if (eventId && p.eventId !== eventId) continue;
    projectMap.set(p.projectId, p);
  }

  let totalEquityValue = 0;

  const enriched = holdings
    .map((h) => {
      const project = projectMap.get(h.projectId);
      if (!project) return null;
      const currentPrice = Number(
        project.currentPrice || project.basePrice || DEFAULT_BASE_PRICE
      );
      const shares = Number(h.shares || 0);
      const marketValue = roundPrice(currentPrice * shares);
      totalEquityValue += marketValue;

      return {
        projectId: h.projectId,
        ticker: project.ticker,
        name: project.name,
        shares,
        avgPrice: h.avgPrice,
        currentPrice,
        marketValue,
        pnl: roundPrice(
          marketValue - shares * Number(h.avgPrice || currentPrice)
        )
      };
    })
    .filter(Boolean);

  const totalPortfolioValue = roundPrice(
    totalEquityValue + Number(account.cashBalance || 0)
  );

  return {
    account,
    totalEquityValue: roundPrice(totalEquityValue),
    totalPortfolioValue,
    holdings: enriched
  };
}

// Recent trades for a project
export async function getRecentTrades(projectId, limit = 20) {
  const cmd = new QueryCommand({
    TableName: BTX_TRADES_TABLE,
    KeyConditionExpression: "projectId = :p",
    ExpressionAttributeValues: {
      ":p": projectId
    },
    ScanIndexForward: false,
    Limit: limit
  });
  const res = await docClient.send(cmd);
  return res.Items || [];
}
