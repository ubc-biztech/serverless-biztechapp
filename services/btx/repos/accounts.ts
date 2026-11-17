import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../../lib/docClient";
import { KICKSTART_INITIAL_CASH } from "../constants";
import {
  accountId,
  configuredEvent,
  getEventConfig,
  roundMoney
} from "../helpers";
import { stockPrice } from "../pricing";
import { EVENT_ACCOUNTS_TABLE, HOLDINGS_TABLE, TRADES_TABLE } from "./tables";
import { getProject, listProjectsForEvent } from "./projects";
import type { BtxEventAccount, BtxHolding } from "../types";
import { TradeStatus } from "../types";
import { eligibleRegistration } from "../eligibility";

export async function ensureAccount(userId: string) {
  await eligibleRegistration(userId);
  const eventId = configuredEvent();
  const key = { userId, eventId };
  const get = new GetCommand({
    TableName: EVENT_ACCOUNTS_TABLE,
    Key: key,
    ConsistentRead: true
  });
  const existing = await docClient.send(get);
  if (existing.Item) return existing.Item as BtxEventAccount;

  const now = Date.now();
  const account: BtxEventAccount = {
    userId,
    eventId,
    cashBalance: KICKSTART_INITIAL_CASH,
    totalAllocated: KICKSTART_INITIAL_CASH,
    version: 1,
    createdAt: now,
    updatedAt: now
  };

  await docClient.send(
    new PutCommand({
      TableName: EVENT_ACCOUNTS_TABLE,
      Item: account,
      ConditionExpression:
        "attribute_not_exists(userId) AND attribute_not_exists(eventId)"
    })
  );
  return account;
}

export async function getPortfolioForUser(userId: string) {
  const [account, holdingRows, config] = await Promise.all([
    ensureAccount(userId),
    docClient
      .send(
        new QueryCommand({
          TableName: HOLDINGS_TABLE,
          KeyConditionExpression: "userId = :u",
          ExpressionAttributeValues: { ":u": userId }
        })
      )
      .then(({ Items }) => (Items ?? []) as BtxHolding[]),
    getEventConfig()
  ]);
  const now = Date.now();
  const eventId = configuredEvent();
  let equity = 0;
  const holdings = [];

  for (const h of holdingRows) {
    if (!h.projectId.startsWith(`${eventId}:`)) continue;
    const project = await getProject(h.projectId);
    if (project.eventId !== eventId) continue;
    const price = stockPrice(project, config.ipoAt);
    const shares = Number(h.shares || 0);
    const marketValue = roundMoney(price * shares);
    const costBasis = Number(h.costBasis ?? 0);
    equity = roundMoney(equity + marketValue);
    holdings.push({
      projectId: h.projectId,
      ticker: project.ticker,
      name: project.name,
      shares,
      costBasis: roundMoney(costBasis),
      currentPrice: price,
      marketValue,
      pnl: roundMoney(marketValue - costBasis)
    });
  }

  const cash = roundMoney(account.cashBalance);
  const { Items: trades = [] } = await docClient.send(
    new QueryCommand({
      TableName: TRADES_TABLE,
      IndexName: "byAccount",
      KeyConditionExpression: "accountId = :account",
      ExpressionAttributeValues: { ":account": accountId(eventId, userId) }
    })
  );
  const realizedPnl = roundMoney(
    trades
      .filter((t) => !t.status || t.status === TradeStatus.FILLED)
      .reduce((sum, t) => sum + Number(t.realizedPnl ?? 0), 0)
  );
  const unrealizedPnl = roundMoney(holdings.reduce((sum, h) => sum + h.pnl, 0));
  
  return {
    account,
    holdings,
    totalEquityValue: equity,
    totalPortfolioValue: roundMoney(cash + equity),
    totalAllocated: account.totalAllocated,
    realizedPnl,
    unrealizedPnl,
    totalPnl: roundMoney(cash + equity - account.totalAllocated),
    serverTime: now,
    live: config.ipoAt != null
  };
}

export async function getRecentTrades(
  projectId: string,
  limit = 20,
  cursor?: string
) {
  await getProject(projectId);
  const start = cursor ? JSON.parse(cursor) : undefined;
  const res = await docClient.send(
    new QueryCommand({
      TableName: TRADES_TABLE,
      KeyConditionExpression: "projectId = :p",
      ExpressionAttributeValues: {
        ":p": projectId,
        ":filled": TradeStatus.FILLED
      },
      FilterExpression: "attribute_not_exists(#status) OR #status = :filled",
      ExpressionAttributeNames: { "#status": "status" },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: start
    })
  );
  return {
    items: (res.Items ?? []).map((tr) => ({
      tradeId: tr.tradeId,
      side: tr.side,
      shares: tr.shares,
      price: tr.price,
      createdAt: tr.createdAt
    })),
    nextCursor: res.LastEvaluatedKey
      ? JSON.stringify(res.LastEvaluatedKey)
      : null
  };
}

export async function getTraderLeaderboard(limitTop = 5, limitBottom = 5) {
  const eventId = configuredEvent();
  const [projects, config, accounts] = await Promise.all([
    listProjectsForEvent(),
    getEventConfig(),
    docClient.send(
      new QueryCommand({
        TableName: EVENT_ACCOUNTS_TABLE,
        IndexName: "byEvent",
        KeyConditionExpression: "eventId = :e",
        ExpressionAttributeValues: { ":e": eventId }
      })
    )
  ]);
  const now = Date.now();
  const prices = new Map(
    projects.map((p) => [p.projectId, stockPrice(p, config.ipoAt)])
  );
  const equity = new Map<string, number>();

  for (const p of projects) {
    const price = prices.get(p.projectId)!;
    const { Items: rows = [] } = await docClient.send(
      new QueryCommand({
        TableName: HOLDINGS_TABLE,
        IndexName: "byProject",
        KeyConditionExpression: "projectId = :p",
        ExpressionAttributeValues: { ":p": p.projectId }
      })
    );
    for (const h of rows) {
      const uid = h.userId as string;
      if (!uid) continue;
      equity.set(
        uid,
        roundMoney((equity.get(uid) || 0) + price * Number(h.shares || 0))
      );
    }
  }

  const ranked = ((accounts.Items ?? []) as BtxEventAccount[])
    .map((a) => ({
      displayName: "Participant",
      totalPnl: roundMoney(
        a.cashBalance + (equity.get(a.userId) || 0) - a.totalAllocated
      )
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl);

  return {
    traders: ranked.length,
    top: ranked.slice(0, limitTop).map((r, i) => ({ rank: i + 1, ...r })),
    bottom: ranked
      .slice(-limitBottom)
      .reverse()
      .map((r, i) => ({ rank: ranked.length - i, ...r })),
    serverTime: now,
    live: config.ipoAt != null
  };
}
