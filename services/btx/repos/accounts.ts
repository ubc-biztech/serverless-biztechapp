import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../../lib/docClient";
import { KICKSTART_INITIAL_CASH_CENTS } from "../constants";
import {
  accountId,
  configuredEvent,
  getEventConfig
} from "../helpers";
import { stockPriceCents } from "../pricing";
import {
  EVENT_ACCOUNTS_TABLE,
  HOLDINGS_TABLE,
  REGISTRATIONS_TABLE,
  TRADES_TABLE
} from "./tables";
import { getProject, listProjectsForEvent } from "./projects";
import type { BtxEventAccount, BtxHolding, BtxTrade, LeaderboardEntry } from "../types";
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
    cashBalanceCents: KICKSTART_INITIAL_CASH_CENTS,
    totalAllocatedCents: KICKSTART_INITIAL_CASH_CENTS,
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
      .then(({ Items }) => (Items || []) as BtxHolding[]),
    getEventConfig()
  ]);
  const now = Date.now();
  const eventId = configuredEvent();
  let equityCents = 0;
  let unrealizedPnlCents = 0;
  const holdings = [];

  for (const h of holdingRows) {
    if (!h.projectId.startsWith(`${eventId}:`)) continue;
    const project = await getProject(h.projectId);
    if (project.eventId !== eventId) continue;
    const priceCents = stockPriceCents(project, config.ipoAt);
    const shares = Number(h.shares || 0);
    const marketValueCents = priceCents * shares;
    const costBasisCents = h.costBasisCents;
    const pnlCents = marketValueCents - costBasisCents;
    equityCents += marketValueCents;
    unrealizedPnlCents += pnlCents;
    holdings.push({
      projectId: h.projectId,
      ticker: project.ticker,
      name: project.name,
      shares,
      costBasisCents,
      currentPriceCents: priceCents,
      marketValueCents,
      pnlCents
    });
  }

  const { cashBalanceCents, totalAllocatedCents } = account;
  const { Items: trades = [] } = await docClient.send(
    new QueryCommand({
      TableName: TRADES_TABLE,
      IndexName: "byAccount",
      KeyConditionExpression: "accountId = :account",
      ExpressionAttributeValues: { ":account": accountId(eventId, userId) }
    })
  );
  const realizedPnlCents = (trades as BtxTrade[])
    .filter((t) => !t.status || t.status === TradeStatus.FILLED)
    .reduce((sum, t) => sum + (t.realizedPnlCents ?? 0), 0);

  return {
    account,
    holdings,
    totalEquityValueCents: equityCents,
    totalPortfolioValueCents: cashBalanceCents + equityCents,
    totalAllocatedCents,
    realizedPnlCents,
    unrealizedPnlCents,
    totalPnlCents: cashBalanceCents + equityCents - totalAllocatedCents,
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
    items: (res.Items || []).map((tr) => ({
      tradeId: tr.tradeId,
      side: tr.side,
      shares: tr.shares,
      priceCents: tr.priceCents,
      createdAt: tr.createdAt
    })),
    nextCursor: res.LastEvaluatedKey
      ? JSON.stringify(res.LastEvaluatedKey)
      : null
  };
}

async function leaderboardDisplayName(userId: string, eventId: string) {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: REGISTRATIONS_TABLE,
      Key: { id: userId, "eventID;year": eventId },
      ProjectionExpression: "basicInformation.fname, basicInformation.lname"
    })
  );
  const { fname, lname } = Item?.basicInformation ?? {};
  return [fname, lname].join(" ").trim() || "Participant";
}

export async function getTraderLeaderboard(viewerId: string | undefined, limitTop = 5, limitBottom = 5) {
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
    projects.map((p) => [p.projectId, stockPriceCents(p, config.ipoAt)])
  );
  const equity = new Map<string, number>();

  for (const p of projects) {
    const priceCents = prices.get(p.projectId)!;
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
        (equity.get(uid) || 0) + priceCents * Number(h.shares || 0)
      );
    }
  }

  const ranked = ((accounts.Items || []) as BtxEventAccount[])
    .map((a) => ({
      userId: a.userId,
      totalPnlCents: a.cashBalanceCents + (equity.get(a.userId) || 0) - a.totalAllocatedCents
    }))
    .sort((a, b) => b.totalPnlCents - a.totalPnlCents || a.userId.localeCompare(b.userId));
  const rows: LeaderboardEntry[] = ranked.map(({ totalPnlCents }, index) => ({
    index,
    rank: index + 1,
    displayName: "Participant",
    totalPnlCents
  }));
  const top = rows.slice(0, limitTop);
  const bottom = limitBottom > 0 ? rows.slice(-limitBottom).reverse() : [];
  const own = rows[ranked.findIndex(({ userId }) => userId === viewerId)] ?? null;
  const visibleRows = new Set([...top, ...bottom]);
  if (own) visibleRows.add(own);
  await Promise.all(Array.from(visibleRows, async (row) => {
    row.displayName = await leaderboardDisplayName(ranked[row.index].userId, eventId);
  }));

  return {
    traders: rows.length,
    top,
    bottom,
    own,
    serverTime: now,
    live: config.ipoAt != null
  };
}
